import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression, Interval } from "@nestjs/schedule";
import * as nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { DataSource } from "typeorm";
import { normalizeSql } from "../common/sql-helper";
import { FirebaseAdminService } from "../firebase/firebase-admin.service";
@Injectable()
export class WorkersService {
  private log = new Logger(WorkersService.name);
  constructor(
    private db: DataSource,
    private config: ConfigService,
    private firebaseAdmin: FirebaseAdminService,
  ) {}
  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }
  public async enqueueDailySummary(userId: number, dateStr: string) {
    if (this.db.options.type === 'mssql') {
      await this.q(
        'IF EXISTS (SELECT 1 FROM DailySummaryJobs WHERE UserId=? AND SummaryDate=?) UPDATE DailySummaryJobs SET RequestedVersion=RequestedVersion+1,Status=CASE WHEN Status="Completed" THEN "Pending" ELSE Status END,UpdatedAt=GETUTCDATE() WHERE UserId=? AND SummaryDate=? ELSE INSERT INTO DailySummaryJobs(UserId,SummaryDate,Status,RequestedVersion,ProcessedVersion,CreatedAt,UpdatedAt) VALUES(?,?,"Pending",1,0,GETUTCDATE(),GETUTCDATE())',
        [userId, dateStr, userId, dateStr, userId, dateStr],
      );
      return;
    }
    await this.q(
      'INSERT INTO DailySummaryJobs(UserId,SummaryDate,Status,RequestedVersion,ProcessedVersion) VALUES(?,? ,"Pending",1,0) ON DUPLICATE KEY UPDATE RequestedVersion=RequestedVersion+1,Status=IF(Status="Completed","Pending",Status),UpdatedAt=UTC_TIMESTAMP(6)',
      [userId, dateStr],
    );
  }
  @Interval(10_000) async dailySummaryJobs() {
    try {
      const jobs = await this.q('SELECT Id,UserId,SummaryDate,RetryCount,RequestedVersion FROM DailySummaryJobs WHERE (Status IN ("Pending","Failed") AND RetryCount<3 AND (NextAttemptAt IS NULL OR NextAttemptAt<=UTC_TIMESTAMP())) OR (Status="Processing" AND LeaseExpiresAt<UTC_TIMESTAMP()) ORDER BY CreatedAt LIMIT 25');
      for (const job of jobs) {
        const owner = randomUUID();
        const claim = await this.q('UPDATE DailySummaryJobs SET Status="Processing",LeaseOwner=?,LeaseExpiresAt=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),LastError=NULL,UpdatedAt=UTC_TIMESTAMP() WHERE Id=? AND ((Status IN ("Pending","Failed") AND RetryCount<3 AND (NextAttemptAt IS NULL OR NextAttemptAt<=UTC_TIMESTAMP())) OR (Status="Processing" AND LeaseExpiresAt<UTC_TIMESTAMP()))', [owner, job.Id]);
        const claimed = Number(claim?.affectedRows ?? claim?.[1]?.affectedRows ?? claim?.rowsAffected?.[0] ?? 0);
        if (claimed !== 1) continue;
        try {
          await this.computeAndSaveDailySummary(Number(job.UserId), String(job.SummaryDate).slice(0, 10));
          await this.q('UPDATE DailySummaryJobs SET Status=CASE WHEN RequestedVersion>? THEN "Pending" ELSE "Completed" END,ProcessedVersion=?,RetryCount=0,NextAttemptAt=NULL,LeaseOwner=NULL,LeaseExpiresAt=NULL,UpdatedAt=UTC_TIMESTAMP() WHERE Id=? AND Status="Processing" AND LeaseOwner=?', [job.RequestedVersion, job.RequestedVersion, job.Id, owner]);
        } catch (error) {
          const retry = Number(job.RetryCount) + 1;
          await this.q('UPDATE DailySummaryJobs SET Status=?,RetryCount=?,NextAttemptAt=?,LastError=?,LeaseOwner=NULL,LeaseExpiresAt=NULL,UpdatedAt=UTC_TIMESTAMP() WHERE Id=? AND Status="Processing" AND LeaseOwner=?', [retry >= 3 ? 'Failed' : 'Pending', retry, retry >= 3 ? null : new Date(Date.now() + 2 ** retry * 60_000), error instanceof Error ? error.message : String(error), job.Id, owner]);
          this.log.error(`[DAILY-SUMMARIES] Job ${job.Id} failed`, error instanceof Error ? error.stack : String(error));
        }
      }
    } catch (error) {
      this.log.error('[DAILY-SUMMARIES] Queue polling failed', error instanceof Error ? error.stack : String(error));
    }
  }
  @Interval(10_000) async notifications() {
    try {
      const items = await this.q(
        'SELECT q.Id QueueId,q.AlertId,q.RetryCount,a.Title,a.Message,a.UserId FROM AlertQueue q JOIN Alerts a ON a.Id=q.AlertId WHERE q.Status IN ("Pending","Failed") AND q.RetryCount<3 AND (q.NextAttemptAt IS NULL OR q.NextAttemptAt<=UTC_TIMESTAMP()) ORDER BY q.CreatedAt LIMIT 25',
      );
      for (const item of items) {
        const leaseOwner = randomUUID();
        const claim = await this.q(
          'UPDATE AlertQueue SET Status="Processing",ProcessingStartedAt=UTC_TIMESTAMP(),LeaseExpiresAt=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),LeaseOwner=? WHERE Id=? AND Status IN ("Pending","Failed") AND RetryCount<3 AND (NextAttemptAt IS NULL OR NextAttemptAt<=UTC_TIMESTAMP())',
          [leaseOwner, item.QueueId],
        );
        const claimed = Number(claim?.affectedRows ?? claim?.[1]?.affectedRows ?? claim?.rowsAffected?.[0] ?? 0);
        if (claimed !== 1) continue;
        let ok = true;
        const recipients = await this.q(
          "SELECT DISTINCT u.Id,u.FullName,u.Email FROM AlertRecipients r JOIN Users u ON u.Id=r.UserId WHERE r.AlertId=? AND u.IsActive=1",
          [item.AlertId],
        );
        for (const recipient of recipients) {
          if (recipient.Email)
            ok =
              (await this.email(recipient.Email, item.Title, item.Message)) &&
              ok;
          const endpoints = await this.q(
            "SELECT Channel,Address FROM NotificationEndpoints WHERE UserId=? AND Enabled=1",
            [recipient.Id],
          );
          for (const ep of endpoints) {
            const sent = await this.external(ep.Channel, ep.Address, {
              title: item.Title,
              message: item.Message,
              alertId: item.AlertId,
            });
            await this.q(
              "INSERT INTO AlertDeliveryHistory(AlertId,Channel,Destination,SentAt,DeliveredAt,Status,FailureReason) VALUES(?,?,?,UTC_TIMESTAMP(),?, ?,?)",
              [
                item.AlertId,
                ep.Channel,
                ep.Address,
                sent ? new Date() : null,
                sent ? "Delivered" : "Failed",
                sent ? null : "Provider unavailable",
              ],
            );
            ok = sent && ok;
          }
        }
        const retry = Number(item.RetryCount) + 1;
        await this.q(
          'UPDATE AlertQueue SET RetryCount=?,Status=?,ProcessedAt=?,NextAttemptAt=?,ErrorMessage=?,ProcessingStartedAt=NULL,LeaseExpiresAt=NULL,LeaseOwner=NULL WHERE Id=? AND Status="Processing" AND LeaseOwner=?',
          [
            retry,
            ok ? "Completed" : retry >= 3 ? "Failed" : "Pending",
            ok ? new Date() : null,
            ok ? null : new Date(Date.now() + 2 ** retry * 60000),
            ok ? null : "One or more notification deliveries failed.",
            item.QueueId,
            leaseOwner,
          ],
        );
      }
    } catch (err: any) {
      this.log.warn(
        `Notification queue polling skipped: ${err?.message || err}`,
      );
    }
  }
  private async email(to: string, subject: string, text: string) {
    const host = this.config.get<string>("SMTP_HOST"),
      user = this.config.get<string>("SMTP_USER"),
      pass = this.config.get<string>("SMTP_PASS");
    if (!host || !user || !pass) {
      this.log.error('SMTP is not configured; email delivery was not attempted.');
      return false;
    }
    try {
      const port = this.config.get<number>("SMTP_PORT") ?? 587;
      const tx = nodemailer.createTransport({
        host,
        port,
        secure: this.config.get<string>("SMTP_SSL") === "true" || port === 465,
        auth: { user, pass },
        tls: {
          servername: this.config.get<string>("SMTP_TLS_SERVERNAME") || host,
        },
      });
      await tx.sendMail({
        from: `${this.config.get("SMTP_FROM_NAME") ?? "Circle CGM"} <${this.config.get("SMTP_FROM_EMAIL") ?? user}>`,
        to,
        subject,
        text,
      });
      return true;
    } catch (e) {
      this.log.error("Email delivery failed", e);
      return false;
    }
  }
  private async external(channel: string, address: string, payload: unknown) {
    if (channel === "Push") {
      const sent = await this.sendFcm(address, payload);
      if (sent) return true;
    }
    const prefix =
      channel === "Push" ? "PUSH" : channel === "SMS" ? "SMS" : null;
    if (!prefix) return false;
    const url = this.config.get<string>(`${prefix}_PROVIDER_URL`);
    const key = this.config.get<string>(`${prefix}_PROVIDER_KEY`);
    if (!url || !key) {
      if (channel !== "Push") this.log.warn(`${channel} provider is not configured`);
      return false;
    }
    try {
      const body =
        channel === "Push"
          ? { token: address, data: payload }
          : { to: address, message: payload };
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        this.log.error(`${channel} provider returned HTTP ${response.status}`);
      return response.ok;
    } catch (error) {
      this.log.error(`${channel} provider request failed`, error);
      return false;
    }
  }

  private async sendFcm(token: string, payload: unknown): Promise<boolean> {
    if (!token) return false;
    const data = (payload ?? {}) as { title?: string; message?: string; alertId?: number };
    try {
      const messageId = await this.firebaseAdmin.messaging.send({
        token,
        notification: {
          title: data.title || 'AIMA CGM Alert',
          body: data.message || '',
        },
        data: { alertId: String(data.alertId ?? '') },
        android: {
          priority: 'high',
          notification: { channelId: 'cgm_urgent_channel', sound: 'default' },
        },
      });
      this.log.log(`FCM accepted message: ${messageId}`);
      return true;
    } catch (error) {
      this.log.error('Firebase notification failed', error instanceof Error ? error.stack : String(error));
      return false;
    }
  }
  @Cron("5 0 * * *") // Runs every day at 00:05 (5 minutes after 12:00 AM midnight)
  async summaries() {
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    this.log.log(
      `[DAILY-SUMMARIES] Running daily glucose summary generation for ${yesterday}...`,
    );
    await this.generateDailySummariesForDate(yesterday);
  }

  public async generateDailySummariesForDate(dateStr: string) {
    try {
      const users = await this.q(
        "SELECT DISTINCT UserId FROM GlucoseMeasurements WHERE CAST(MeasurementTime AS DATE) = CAST(? AS DATE)",
        [dateStr],
      );
      for (const { UserId: userId, userId: uId } of users) {
        const id = userId ?? uId;
        if (id) {
          await this.computeAndSaveDailySummary(Number(id), dateStr);
        }
      }
    } catch (err: any) {
      this.log.error(
        `[DAILY-SUMMARIES] Error generating summaries for ${dateStr}:`,
        err.message || err,
      );
    }
  }

  public async computeAndSaveDailySummary(userId: number, dateStr: string) {
    try {
      const rows = await this.q(
        "SELECT GlucoseValue FROM GlucoseMeasurements WHERE UserId=? AND CAST(MeasurementTime AS DATE)=CAST(? AS DATE) AND GlucoseValue IS NOT NULL ORDER BY MeasurementTime",
        [userId, dateStr],
      );
      const v = rows
        .map((x: Record<string, unknown>) => Number(x.GlucoseValue))
        .filter((n: number) => !isNaN(n) && n > 0);
      if (!v.length) return;

      const mean = v.reduce((a: number, b: number) => a + b, 0) / v.length;
      const sorted = [...v].sort((a, b) => a - b);
      const median =
        v.length % 2
          ? sorted[Math.floor(v.length / 2)]
          : (sorted[v.length / 2 - 1] + sorted[v.length / 2]) / 2;
      const sd =
        v.length > 1
          ? Math.sqrt(
              v.reduce((n: number, x: number) => n + (x - mean) ** 2, 0) /
                (v.length - 1),
            )
          : 0;
      const low = v.filter((x: number) => x < 70).length;
      const high = v.filter((x: number) => x > 180).length;
      const inside = v.length - low - high;

      let highEvents = 0,
        lowEvents = 0,
        inHigh = false,
        inLow = false;
      for (const x of v) {
        if (x > 180 && !inHigh) highEvents++;
        inHigh = x > 180;
        if (x < 70 && !inLow) lowEvents++;
        inLow = x < 70;
      }

      const existing = await this.q(
        "SELECT Id FROM DailyGlucoseSummaries WHERE UserId=? AND CAST(SummaryDate AS DATE)=CAST(? AS DATE)",
        [userId, dateStr],
      );
      if (existing.length) {
        await this.q(
          "UPDATE DailyGlucoseSummaries SET ReadingCount=?,MeanGlucose=?,MedianGlucose=?,StandardDeviation=?,Gmi=?,CvPercentage=?,TimeInRangeMinutes=?,TimeBelowRangeMinutes=?,TimeAboveRangeMinutes=?,TimeInRangePercentage=?,TimeBelowRangePercentage=?,TimeAboveRangePercentage=?,LowestGlucose=?,HighestGlucose=?,HighEventsCount=?,LowEventsCount=?,GeneratedAt=UTC_TIMESTAMP() WHERE Id=?",
          [
            v.length,
            mean,
            median,
            sd,
            3.31 + 0.02392 * mean,
            mean ? (sd / mean) * 100 : 0,
            inside * 4,
            low * 4,
            high * 4,
            (inside / v.length) * 100,
            (low / v.length) * 100,
            (high / v.length) * 100,
            Math.min(...v),
            Math.max(...v),
            highEvents,
            lowEvents,
            existing[0].Id,
          ],
        );
      } else {
        await this.q(
          "INSERT INTO DailyGlucoseSummaries(UserId,SummaryDate,ReadingCount,MeanGlucose,MedianGlucose,StandardDeviation,Gmi,CvPercentage,TimeInRangeMinutes,TimeBelowRangeMinutes,TimeAboveRangeMinutes,TimeInRangePercentage,TimeBelowRangePercentage,TimeAboveRangePercentage,LowestGlucose,HighestGlucose,HighEventsCount,LowEventsCount,GeneratedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())",
          [
            userId,
            dateStr,
            v.length,
            mean,
            median,
            sd,
            3.31 + 0.02392 * mean,
            mean ? (sd / mean) * 100 : 0,
            inside * 4,
            low * 4,
            high * 4,
            (inside / v.length) * 100,
            (low / v.length) * 100,
            (high / v.length) * 100,
            Math.min(...v),
            Math.max(...v),
            highEvents,
            lowEvents,
          ],
        );
      }
      this.log.log(
        `[DAILY-SUMMARIES] Daily summary saved for userId ${userId} on ${dateStr} (${v.length} readings, Mean: ${Math.round(mean)} mg/dL)`,
      );
    } catch (e: any) {
      this.log.error(
        `[DAILY-SUMMARIES] Failed to save summary for userId ${userId}:`,
        e.message || e,
      );
      throw e;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async operations() {
    await this.q(
      'UPDATE AlertQueue SET Status="Pending",ProcessingStartedAt=NULL,LeaseExpiresAt=NULL,LeaseOwner=NULL,NextAttemptAt=UTC_TIMESTAMP(),ErrorMessage="Recovered expired processing lease" WHERE Status="Processing" AND LeaseExpiresAt IS NOT NULL AND LeaseExpiresAt<UTC_TIMESTAMP()',
    );
    const [failed] = await this.q(
      'SELECT COUNT(*) count FROM AlertQueue WHERE Status="Failed"',
    );
    const [pending] = await this.q(
      'SELECT MIN(CreatedAt) oldest FROM AlertQueue WHERE Status="Pending"',
    );
    const failedCount = Number(failed?.count ?? failed?.COUNT ?? 0);
    if (failedCount >= 25) {
      this.log.warn(
        `[OPERATIONS] ${failedCount} historic failed notification queue items exist in database.`,
      );
    }
    if (
      pending?.oldest &&
      new Date(pending.oldest) < new Date(Date.now() - 600000)
    ) {
      this.log.warn("[OPERATIONS] Notification queue lag exceeds ten minutes.");
    }
  }
}
