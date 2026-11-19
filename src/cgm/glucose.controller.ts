import { BadRequestException, Body, Controller, Get, Logger, NotFoundException, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, FindOptionsWhere, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { GlucoseMeasurement, Sensor } from '../database/entities';
import { BulkSyncDto, MeasurementDto } from './cgm.dto';
import { GlucoseGateway } from '../realtime/glucose.gateway';
import { normalizeSql } from '../common/sql-helper';
import { WorkersService } from '../workers/workers.service';
import { asBool, evaluateGlucoseAlert, pickDominantAlert } from './glucose-alerts';

@Controller('api/Glucose')
export class GlucoseController {
  private readonly log = new Logger(GlucoseController.name);
  constructor(
    @InjectRepository(GlucoseMeasurement) private readonly readings: Repository<GlucoseMeasurement>,
    @InjectRepository(Sensor) private readonly sensors: Repository<Sensor>,
    private readonly db: DataSource,
    private readonly gateway: GlucoseGateway,
    private readonly workers: WorkersService,
  ) { }
  private q(sql: string, params?: unknown[]) { return this.db.query(normalizeSql(sql, this.db), params); }
  private async createAlertWithRecipients(userId: number, sensorId: number, hit: { type: string; title: string; severity: string }, value: number, time: Date) {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const query = (sql: string, params?: unknown[]) => runner.query(normalizeSql(sql, this.db), params);
    try {
      await query(this.db.options.type === 'mssql' ? 'SELECT Id FROM Users WITH (UPDLOCK,HOLDLOCK) WHERE Id=?' : 'SELECT Id FROM Users WHERE Id=? FOR UPDATE', [userId]);
      const recent = await query('SELECT Id FROM Alerts WHERE UserId=? AND AlertType=? AND AlertTime>=? AND AlertTime<=? ORDER BY AlertTime DESC', [userId, hit.type, new Date(time.getTime() - 15 * 60_000), time]);
      if (recent.length) { await runner.commitTransaction(); return; }
      const isMssql = this.db.options.type === 'mssql';
      const insertSql = isMssql
        ? 'INSERT INTO Alerts(UserId,SensorId,AlertType,Title,Message,GlucoseValue,GlucoseUnit,Severity,IsRead,AlertTime,CreatedAt) OUTPUT INSERTED.Id VALUES(?,?,?,?,?,?,?,?,0,?,GETUTCDATE())'
        : 'INSERT INTO Alerts(UserId,SensorId,AlertType,Title,Message,GlucoseValue,GlucoseUnit,Severity,IsRead,AlertTime,CreatedAt) VALUES(?,?,?,?,?,?,?,?,0,?,UTC_TIMESTAMP())';
      const result = await query(insertSql, [userId, sensorId, hit.type, hit.title, `${hit.title}: ${value} mg/dL`, value, 'mg/dL', hit.severity, time]);
      const alertId = Number(isMssql ? result?.[0]?.Id ?? result?.[0]?.id : result?.insertId);
      if (!Number.isSafeInteger(alertId) || alertId <= 0) throw new Error('Alert insertion failed to return a valid alert ID.');
      const recipients = await query('SELECT DISTINCT UserId FROM FamilyMembers WHERE FamilyId IN (SELECT Id FROM Families WHERE OwnerUserId=? UNION SELECT FamilyId FROM FamilyMembers WHERE UserId=? AND Status="Active") AND Status="Active" AND ReceiveAlerts=1', [userId, userId]);
      const targetUserIds = [userId, ...recipients.map((r: Record<string, number>) => r.UserId ?? r.userId)];
      for (const uid of [...new Set(targetUserIds)]) await query('INSERT INTO AlertRecipients(AlertId,UserId,IsRead,CreatedAt) VALUES(?,?,0,UTC_TIMESTAMP())', [alertId, uid]);
      await query('INSERT INTO AlertQueue(AlertId,Status,RetryCount,CreatedAt) VALUES(?,"Pending",0,UTC_TIMESTAMP())', [alertId]);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
  private async notify(userId: number, sensorId: number, value: number, time: Date) {
    try {
      const profiles = await this.q(
        'SELECT TargetLow, TargetHigh, UrgentLowThreshold, UrgentHighThreshold, BedTime, WakeTime, NightLowThreshold, NightAlertsEnabled, PushNotificationsEnabled, CriticalGlucoseAlertsEnabled FROM PatientProfile WHERE UserId=?',
        [userId],
      );
      const p = profiles[0] || {};
      const hit = evaluateGlucoseAlert({
        value,
        time,
        targetLow: Number(p.TargetLow ?? 90.0),
        targetHigh: Number(p.TargetHigh ?? 130.0),
        urgentLow: Number(p.UrgentLowThreshold ?? 55.0),
        urgentHigh: Number(p.UrgentHighThreshold ?? 250.0),
        bedTime: p.BedTime || '22:00',
        wakeTime: p.WakeTime || '07:00',
        nightLow: Number(p.NightLowThreshold ?? 70.0),
        nightAlertsEnabled: asBool(p.NightAlertsEnabled, true),
        criticalAlertsEnabled: asBool(p.CriticalGlucoseAlertsEnabled, true),
      });

      if (hit) {
        await this.createAlertWithRecipients(userId, sensorId, hit, value, time);
      }
      const families = await this.q('SELECT Id FROM Families WHERE OwnerUserId=? UNION SELECT FamilyId Id FROM FamilyMembers WHERE UserId=? AND Status="Active"', [userId, userId]);
      this.gateway.publish(families.map((x: Record<string, number>) => x.Id ?? x.id), { userId, glucoseValue: value, measurementTime: time });
    } catch (err) {
      this.log.warn(`Glucose alert evaluation failed for user ${userId}: ${err instanceof Error ? err.message : err}`);
    }
  }
  private async notifyInserted(userId: number, sensorId: number, rows: Array<{ value: number; time: Date }>) {
    if (!rows.length) return;
    const profiles = await this.q(
      'SELECT TargetLow, TargetHigh, UrgentLowThreshold, UrgentHighThreshold, BedTime, WakeTime, NightLowThreshold, NightAlertsEnabled, CriticalGlucoseAlertsEnabled FROM PatientProfile WHERE UserId=?',
      [userId],
    );
    const p = profiles[0] || {};
    const hits = rows
      .map((row) => {
        const hit = evaluateGlucoseAlert({
          value: row.value,
          time: row.time,
          targetLow: Number(p.TargetLow ?? 90.0),
          targetHigh: Number(p.TargetHigh ?? 130.0),
          urgentLow: Number(p.UrgentLowThreshold ?? 55.0),
          urgentHigh: Number(p.UrgentHighThreshold ?? 250.0),
          bedTime: p.BedTime || '22:00',
          wakeTime: p.WakeTime || '07:00',
          nightLow: Number(p.NightLowThreshold ?? 70.0),
          nightAlertsEnabled: asBool(p.NightAlertsEnabled, true),
          criticalAlertsEnabled: asBool(p.CriticalGlucoseAlertsEnabled, true),
        });
        return hit ? { ...hit, value: row.value, time: row.time } : null;
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const dominant = pickDominantAlert(hits);
    const latest = rows.reduce((best, row) => (row.time > best.time ? row : best), rows[0]);
    if (dominant) {
      await this.notify(userId, sensorId, dominant.value, dominant.time);
    } else {
      await this.notify(userId, sensorId, latest.value, latest.time);
    }
  }
  private validate(s: Sensor, d: MeasurementDto) { const time = new Date(d.measurementTime); if (!s.isActive || ['Expired', 'Stopped'].includes(s.status)) return 'The sensor session is not active.'; if (!s.activatedAt || time < s.activatedAt) return 'Warm-up measurements cannot be uploaded as glucose readings.'; if (s.expiresAt && time > s.expiresAt) return 'The measurement occurred after the sensor expired.'; if (time > new Date(Date.now() + 300_000)) return 'The measurement timestamp is in the future.'; return null; }
  private entity(userId: number, s: Sensor, d: MeasurementDto) { return this.readings.create({ userId, sensorId: s.id, deviceId: s.deviceId, sequenceNumber: d.sequenceNumber ?? null, glucoseValue: String(d.glucoseValue), measurementTime: new Date(d.measurementTime), batteryVoltageMv: d.batteryVoltageMv ?? null, deviceTemperatureC: d.deviceTemperatureC == null ? null : String(d.deviceTemperatureC), we1CurrentNa: d.we1CurrentNa == null ? null : String(d.we1CurrentNa), isSynced: true, createdAt: new Date() }); }
  private async sensor(id: number, userId: number) {
    const owned = await this.sensors.findOneBy({ id, userId });
    if (owned) return owned;
    const active = await this.sensors.findOne({
      where: { userId, isActive: true, status: Not('Expired') },
      order: { startedAt: 'DESC' },
    });
    if (!active) throw new NotFoundException({ message: 'Sensor not found.' });
    return active;
  }
  @Post('measurement') async save(@CurrentUser() u: AuthUser, @Body() dto: MeasurementDto) {
    const s = await this.sensor(dto.sensorId, u.sub);
    const error = this.validate(s, dto);
    if (error) throw new BadRequestException({ message: error });
    const runner = this.db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const measurementTime = new Date(dto.measurementTime);
    try {
      const duplicate = await runner.manager.findOne(GlucoseMeasurement, { where: { sensorId: s.id, measurementTime } });
      if (duplicate) {
        await runner.rollbackTransaction();
        return { message: 'Duplicate reading skipped.', measurementTime: dto.measurementTime };
      }
      await runner.manager.save(GlucoseMeasurement, this.entity(u.sub, s, dto));
      if (!s.lastReadingAt || measurementTime > s.lastReadingAt) {
        s.lastReadingAt = measurementTime;
        await runner.manager.save(Sensor, s);
      }
      await this.workers.enqueueDailySummary(u.sub, measurementTime.toISOString().slice(0, 10), runner);
      await runner.commitTransaction();
    } catch (e) {
      await runner.rollbackTransaction();
      throw e;
    } finally {
      await runner.release();
    }
    void this.notify(u.sub, s.id, dto.glucoseValue, measurementTime);
    return { message: 'Measurement saved successfully.', measurementTime: dto.measurementTime };
  }

  @Post('sync-bulk') async bulk(@CurrentUser() u: AuthUser, @Body() dto: BulkSyncDto) {
    const s = await this.sensor(dto.sensorId, u.sub);
    for (const d of dto.measurements) {
      d.sensorId = dto.sensorId;
      const error = this.validate(s, d);
      if (error) throw new BadRequestException({ message: error });
    }
    // De-duplicate inside the request first. The database primary key on
    // (SensorId, MeasurementTime) remains the concurrency boundary for
    // overlapping uploads.
    const uniqueMeasurements = [...new Map(
      dto.measurements.map((measurement) => [
        new Date(measurement.measurementTime).getTime(),
        measurement,
      ]),
    ).values()];
    let inserted = 0;
    const acknowledged: number[] = [];
    const affectedDates = new Set<string>();
    const insertedRows: Array<{ value: number; time: Date }> = [];
    const runner = this.db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      for (const d of uniqueMeasurements) {
        const measurementTime = new Date(d.measurementTime);
        const duplicate = await runner.manager.findOne(GlucoseMeasurement, { where: { sensorId: s.id, measurementTime } });
        if (duplicate) continue;
        try {
          await runner.manager.save(GlucoseMeasurement, this.entity(u.sub, s, d));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/duplicate|primary key|unique/i.test(message)) continue;
          throw error;
        }
        inserted++;
        if (d.sequenceNumber != null) acknowledged.push(d.sequenceNumber);
        affectedDates.add(measurementTime.toISOString().slice(0, 10));
        insertedRows.push({ value: d.glucoseValue, time: measurementTime });
        if (!s.lastReadingAt || measurementTime > s.lastReadingAt) s.lastReadingAt = measurementTime;
      }
      if (inserted > 0) await runner.manager.save(Sensor, s);
      for (const date of affectedDates) await this.workers.enqueueDailySummary(u.sub, date, runner);
      await runner.commitTransaction();
    } catch (e) {
      await runner.rollbackTransaction();
      throw e;
    } finally {
      await runner.release();
    }
    if (inserted > 0) this.notifyInserted(u.sub, s.id, insertedRows).catch((err) => {
      this.log.warn(`Bulk glucose alert notify failed: ${err instanceof Error ? err.message : err}`);
    });

    return {
      insertedCount: inserted,
      duplicateCount: dto.measurements.length - inserted,
      acknowledgedSequenceNumbers: [...new Set(acknowledged)],
    };
  }
  private resolveRange(query: {
    hours?: string;
    days?: string;
    startUtc?: string;
    endUtc?: string;
    startDate?: string;
    endDate?: string;
  }): { start: Date; end: Date } {
    const endRaw = query.endUtc || query.endDate;
    const startRaw = query.startUtc || query.startDate;
    const end = endRaw ? new Date(endRaw) : new Date();
    if (startRaw) return { start: new Date(startRaw), end };
    if (query.hours != null && query.hours !== '') {
      const hours = Math.max(1, Number(query.hours) || 24);
      return { start: new Date(end.getTime() - hours * 3_600_000), end };
    }
    const days = Math.max(1, Number(query.days ?? '1') || 1);
    return { start: new Date(end.getTime() - days * 86_400_000), end };
  }

  @Get('history')
  async history(
    @CurrentUser() u: AuthUser,
    @Query('sensorId') sensorId?: string,
    @Query('hours') hours?: string,
    @Query('days') days?: string,
    @Query('startUtc') startUtc?: string,
    @Query('endUtc') endUtc?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') pageText = '1',
    @Query('pageSize') sizeText = '300',
    @Query('limit') limitText?: string,
  ) {
    const page = Math.max(1, Number(pageText) || 1);
    const requested = Number(sizeText || limitText || 300) || 300;
    const pageSize = Math.min(1000, Math.max(1, requested));
    const { start, end } = this.resolveRange({ hours, days, startUtc, endUtc, startDate, endDate });
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      throw new BadRequestException('Invalid history time range.');
    }

    const where: FindOptionsWhere<GlucoseMeasurement> = {
      userId: u.sub,
      measurementTime: Between(start, end),
    };
    if (sensorId) where.sensorId = Number(sensorId);

    const [rows, totalCount] = await this.readings.findAndCount({
      where,
      order: { measurementTime: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const items = rows.map((r) => ({
      sensorId: r.sensorId,
      measurementTime: r.measurementTime,
      glucoseValue: r.glucoseValue == null ? null : Number(r.glucoseValue),
      sequenceNumber: r.sequenceNumber,
      batteryVoltageMv: r.batteryVoltageMv,
      deviceTemperatureC:
        r.deviceTemperatureC == null ? null : Number(r.deviceTemperatureC),
      we1CurrentNa: r.we1CurrentNa == null ? null : Number(r.we1CurrentNa),
    }));

    return {
      items,
      page,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      hasMore: page * pageSize < totalCount,
    };
  }

  @Get('summary')
  async summary(
    @CurrentUser() u: AuthUser,
    @Query('sensorId') sensorId?: string,
    @Query('hours') hours?: string,
    @Query('days') days = '1',
    @Query('startUtc') startUtc?: string,
    @Query('endUtc') endUtc?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const { start, end } = this.resolveRange({ hours, days, startUtc, endUtc, startDate, endDate });
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      throw new BadRequestException('Invalid summary time range.');
    }

    const params: unknown[] = [u.sub, start, end];
    let sensorClause = '';
    if (sensorId) {
      sensorClause = ' AND SensorId=?';
      params.push(Number(sensorId));
    }

    const [agg] = await this.q(
      `SELECT COUNT(*) readingCount,
              AVG(GlucoseValue) averageGlucose,
              MIN(GlucoseValue) lowestGlucose,
              MAX(GlucoseValue) highestGlucose,
              MAX(MeasurementTime) lastUpdated
       FROM GlucoseMeasurements
       WHERE UserId=? AND MeasurementTime>=? AND MeasurementTime<=? AND GlucoseValue IS NOT NULL${sensorClause}`,
      params,
    );

    const readingCount = Number(agg?.readingCount ?? agg?.ReadingCount ?? 0);
    if (!readingCount) {
      return {
        currentGlucose: null,
        averageGlucose: null,
        lowestGlucose: null,
        highestGlucose: null,
        timeInRangePercentage: null,
        readingCount: 0,
        lastUpdated: null,
        hasData: false,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
      };
    }

    const profile = await this.q(
      'SELECT TargetLow, TargetHigh FROM PatientProfile WHERE UserId=?',
      [u.sub],
    );
    const low = Number(profile[0]?.TargetLow ?? profile[0]?.targetLow ?? 70);
    const high = Number(profile[0]?.TargetHigh ?? profile[0]?.targetHigh ?? 180);
    const tirParams = [...params, low, high];
    const [tir] = await this.q(
      `SELECT COUNT(*) inRange
       FROM GlucoseMeasurements
       WHERE UserId=? AND MeasurementTime>=? AND MeasurementTime<=? AND GlucoseValue IS NOT NULL${sensorClause}
         AND GlucoseValue>=? AND GlucoseValue<=?`,
      tirParams,
    );
    const inRange = Number(tir?.inRange ?? tir?.InRange ?? 0);

    const latestWhere: FindOptionsWhere<GlucoseMeasurement> = {
      userId: u.sub,
      measurementTime: Between(start, end),
    };
    if (sensorId) latestWhere.sensorId = Number(sensorId);
    const latest = await this.readings.findOne({
      where: latestWhere,
      order: { measurementTime: 'DESC' },
    });

    return {
      currentGlucose: latest?.glucoseValue == null ? null : Number(latest.glucoseValue),
      averageGlucose: Math.round(Number(agg.averageGlucose ?? agg.AverageGlucose)),
      lowestGlucose: Math.round(Number(agg.lowestGlucose ?? agg.LowestGlucose)),
      highestGlucose: Math.round(Number(agg.highestGlucose ?? agg.HighestGlucose)),
      timeInRangePercentage: Math.round((inRange / readingCount) * 1000) / 10,
      readingCount,
      targetLow: low,
      targetHigh: high,
      lastUpdated: agg.lastUpdated ?? agg.LastUpdated ?? latest?.measurementTime ?? null,
      hasData: true,
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
    };
  }
}
