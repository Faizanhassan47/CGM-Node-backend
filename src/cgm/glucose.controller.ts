import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, FindOptionsWhere, MoreThanOrEqual, Repository } from 'typeorm';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { GlucoseMeasurement, Sensor } from '../database/entities';
import { BulkSyncDto, MeasurementDto } from './cgm.dto';
import { GlucoseGateway } from '../realtime/glucose.gateway';
import { normalizeSql } from '../common/sql-helper';
import { WorkersService } from '../workers/workers.service';

@Controller('api/Glucose')
export class GlucoseController {
  constructor(
    @InjectRepository(GlucoseMeasurement) private readonly readings: Repository<GlucoseMeasurement>,
    @InjectRepository(Sensor) private readonly sensors: Repository<Sensor>,
    private readonly db: DataSource,
    private readonly gateway: GlucoseGateway,
    private readonly workers: WorkersService,
  ) {}
  private q(sql: string, params?: unknown[]) { return this.db.query(normalizeSql(sql, this.db), params); }
  private async notify(userId: number, sensorId: number, value: number, time: Date) {
    try {
      let type: string | undefined, title: string | undefined, severity: string | undefined;

      // Check user profile thresholds & sleep schedule for dynamic alerts
      const profiles = await this.q('SELECT TargetLow, TargetHigh, UrgentLowThreshold, UrgentHighThreshold, BedTime, WakeTime, NightLowThreshold, NightAlertsEnabled FROM PatientProfile WHERE UserId=?', [userId]);
      const p = profiles[0] || {};
      const targetLow = Number(p.TargetLow ?? 90.0);
      const targetHigh = Number(p.TargetHigh ?? 130.0);
      const urgentLow = Number(p.UrgentLowThreshold ?? 55.0);
      const urgentHigh = Number(p.UrgentHighThreshold ?? 250.0);
      const bedTime = p.BedTime || '22:00';
      const wakeTime = p.WakeTime || '07:00';
      const nightLow = Number(p.NightLowThreshold ?? 70.0);
      const nightAlertsEnabled = p.NightAlertsEnabled ?? true;

      const [bH, bM] = bedTime.split(':').map(Number);
      const [wH, wM] = wakeTime.split(':').map(Number);
      const curMinutes = time.getHours() * 60 + time.getMinutes();
      const bedMinutes = bH * 60 + bM;
      const wakeMinutes = wH * 60 + wM;

      let isSleepTime = false;
      if (bedMinutes > wakeMinutes) {
        isSleepTime = curMinutes >= bedMinutes || curMinutes <= wakeMinutes;
      } else {
        isSleepTime = curMinutes >= bedMinutes && curMinutes <= wakeMinutes;
      }

      if (isSleepTime && nightAlertsEnabled && value < nightLow) {
        type = 'NocturnalHypo';
        title = '🚨 Urgent Nocturnal Low Glucose';
        severity = 'Critical';
      } else if (value <= urgentLow) {
        type = 'UrgentLow';
        title = '🚨 Critical Urgent Low Glucose';
        severity = 'Critical';
      } else if (value < targetLow) {
        type = 'LowGlucose';
        title = 'Low Glucose';
        severity = value <= urgentLow + 10 ? 'Critical' : 'Warning';
      } else if (value >= urgentHigh) {
        type = 'UrgentHigh';
        title = '🚨 Critical Urgent High Glucose';
        severity = 'Critical';
      } else if (value > targetHigh) {
        type = 'HighGlucose';
        title = 'High Glucose';
        severity = value >= urgentHigh - 20 ? 'Critical' : 'Warning';
      }

      if (type) {
        await this.q(
          'INSERT INTO Alerts(UserId,SensorId,AlertType,Title,Message,GlucoseValue,GlucoseUnit,Severity,IsRead,AlertTime,CreatedAt) VALUES(?,?,?,?,?,?,?,?,0,?,UTC_TIMESTAMP())',
          [userId, sensorId, type, title, `${title}: ${value} mg/dL`, value, 'mg/dL', severity, time],
        );
        const aRow = (await this.q('SELECT TOP 1 Id FROM Alerts WHERE UserId=? ORDER BY Id DESC', [userId]))[0];
        const alertId = aRow?.Id ?? aRow?.id;
        const recipients = await this.q(
          'SELECT DISTINCT UserId FROM FamilyMembers WHERE FamilyId IN (SELECT Id FROM Families WHERE OwnerUserId=? UNION SELECT FamilyId FROM FamilyMembers WHERE UserId=? AND Status="Active") AND Status="Active" AND ReceiveAlerts=1',
          [userId, userId],
        );
        const targetUserIds = [userId, ...recipients.map((r: Record<string, number>) => r.UserId ?? r.userId)];
        for (const uid of [...new Set(targetUserIds)]) {
          const existing = await this.q('SELECT 1 FROM AlertRecipients WHERE AlertId=? AND UserId=?', [alertId, uid]);
          if (!existing.length) {
            await this.q('INSERT INTO AlertRecipients(AlertId,UserId,IsRead,CreatedAt) VALUES(?,?,0,UTC_TIMESTAMP())', [alertId, uid]);
          }
        }
        await this.q('INSERT INTO AlertQueue(AlertId,Status,RetryCount,CreatedAt) VALUES(?,"Pending",0,UTC_TIMESTAMP())', [alertId]);
      }
      const families = await this.q('SELECT Id FROM Families WHERE OwnerUserId=? UNION SELECT FamilyId Id FROM FamilyMembers WHERE UserId=? AND Status="Active"', [userId, userId]);
      this.gateway.publish(families.map((x: Record<string, number>) => x.Id ?? x.id), { userId, glucoseValue: value, measurementTime: time });
    } catch (_) {}
  }
  private validate(s: Sensor, d: MeasurementDto) { const time = new Date(d.measurementTime); if (!s.isActive || ['Expired', 'Stopped'].includes(s.status)) return 'The sensor session is not active.'; if (!s.activatedAt || time < s.activatedAt) return 'Warm-up measurements cannot be uploaded as glucose readings.'; if (s.expiresAt && time > s.expiresAt) return 'The measurement occurred after the sensor expired.'; if (time > new Date(Date.now() + 300_000)) return 'The measurement timestamp is in the future.'; return null; }
  private entity(userId: number, s: Sensor, d: MeasurementDto) { return this.readings.create({ userId, sensorId: s.id, deviceId: s.deviceId, sequenceNumber: d.sequenceNumber ?? null, glucoseValue: String(d.glucoseValue), measurementTime: new Date(d.measurementTime), batteryVoltageMv: d.batteryVoltageMv ?? null, deviceTemperatureC: d.deviceTemperatureC == null ? null : String(d.deviceTemperatureC), we1CurrentNa: d.we1CurrentNa == null ? null : String(d.we1CurrentNa), isSynced: true, createdAt: new Date() }); }
  private async sensor(id: number, userId: number) { const s = await this.sensors.findOneBy({ id, userId }); if (!s) throw new NotFoundException({ message: 'Sensor not found.' }); return s; }
  @Post('measurement') async save(@CurrentUser() u: AuthUser, @Body() dto: MeasurementDto) {
    const s = await this.sensor(dto.sensorId, u.sub);
    const error = this.validate(s, dto);
    if (error) throw new BadRequestException({ message: error });
    const duplicate = await this.readings.exist({ where: { sensorId: s.id, measurementTime: new Date(dto.measurementTime) } });
    if (duplicate) return { message: 'Duplicate reading skipped.', measurementTime: dto.measurementTime };
    await this.readings.save(this.entity(u.sub, s, dto));
    if (!s.lastReadingAt || new Date(dto.measurementTime) > s.lastReadingAt) {
      s.lastReadingAt = new Date(dto.measurementTime);
      await this.sensors.save(s);
    }
    try { await this.notify(u.sub, s.id, dto.glucoseValue, new Date(dto.measurementTime)); } catch(_) {}
    const dateStr = new Date(dto.measurementTime).toISOString().slice(0, 10);
    this.workers.computeAndSaveDailySummary(u.sub, dateStr).catch(() => {});
    return { message: 'Measurement saved successfully.', measurementTime: dto.measurementTime };
  }

  @Post('sync-bulk') async bulk(@CurrentUser() u: AuthUser, @Body() dto: BulkSyncDto) {
    const s = await this.sensor(dto.sensorId, u.sub);
    for (const d of dto.measurements) {
      d.sensorId = dto.sensorId;
      const error = this.validate(s, d);
      if (error) throw new BadRequestException({ message: error });
    }
    let inserted = 0;
    const acknowledged: number[] = [];
    const affectedDates = new Set<string>();

    for (const d of dto.measurements) {
      if (d.sequenceNumber != null) acknowledged.push(d.sequenceNumber);
      const duplicate = await this.readings.exist({ where: { sensorId: s.id, measurementTime: new Date(d.measurementTime) } });
      if (!duplicate) {
        await this.readings.save(this.entity(u.sub, s, d));
        inserted++;
        affectedDates.add(new Date(d.measurementTime).toISOString().slice(0, 10));
      }
    }

    if (affectedDates.size > 0) {
      for (const d of affectedDates) {
        this.workers.computeAndSaveDailySummary(u.sub, d).catch(() => {});
      }
    }

    return {
      insertedCount: inserted,
      duplicateCount: dto.measurements.length - inserted,
      acknowledgedSequenceNumbers: [...new Set(acknowledged)],
    };
  }
  @Get('history') async history(@CurrentUser() u: AuthUser, @Query('sensorId') sensorId?: string, @Query('hours') hours = '24', @Query('startUtc') startUtc?: string, @Query('endUtc') endUtc?: string, @Query('page') pageText = '1', @Query('pageSize') sizeText = '1000') { const page = Math.max(1, Number(pageText)); const pageSize = Math.min(1000, Math.max(1, Number(sizeText))); const start = startUtc ? new Date(startUtc) : new Date(Date.now() - Number(hours) * 3_600_000); const time = endUtc ? Between(start, new Date(endUtc)) : MoreThanOrEqual(start); const where: FindOptionsWhere<GlucoseMeasurement> = { userId: u.sub, measurementTime: time }; if (sensorId) where.sensorId = Number(sensorId); const [items, totalCount] = await this.readings.findAndCount({ where, order: { measurementTime: 'DESC' }, skip: (page - 1) * pageSize, take: pageSize }); return { items, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) }; }
  @Get('summary')
  async summary(@CurrentUser() u: AuthUser, @Query('sensorId') sensorId?: string) {
    const where: FindOptionsWhere<GlucoseMeasurement> = {
      userId: u.sub,
      measurementTime: MoreThanOrEqual(new Date(Date.now() - 86_400_000)),
    };
    if (sensorId) where.sensorId = Number(sensorId);
    const rows = await this.readings.find({ where, order: { measurementTime: 'DESC' } });
    if (!rows.length) {
      return {
        currentGlucose: null,
        averageGlucose: null,
        lowestGlucose: null,
        highestGlucose: null,
        timeInRangePercentage: null,
        lastUpdated: null,
        hasData: false,
      };
    }
    const values = rows.map((r) => Number(r.glucoseValue)).filter(Number.isFinite);
    return {
      currentGlucose: Number(rows[0].glucoseValue),
      averageGlucose: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
      lowestGlucose: values.length ? Math.min(...values) : null,
      highestGlucose: values.length ? Math.max(...values) : null,
      timeInRangePercentage: values.length ? Math.round(values.filter((v) => v >= 70 && v <= 180).length / values.length * 1000) / 10 : null,
      lastUpdated: rows[0].measurementTime,
      hasData: true,
    };
  }
}
