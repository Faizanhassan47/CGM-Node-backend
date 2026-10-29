import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { normalizeSql } from '../common/sql-helper';
import { DietAssistantService } from './diet-assistant.service';

@Controller('api/DietAssistant')
export class DietAssistantController {
  constructor(private readonly db: DataSource, private readonly assistant: DietAssistantService) {}
  private q(sql: string, params?: unknown[]) { return this.db.query(normalizeSql(sql, this.db), params); }

  @Post('chat')
  async chat(@CurrentUser() user: AuthUser, @Body() body: { message?: string }) {
    const message = body?.message?.trim();
    if (!message || message.length > 2000) throw new BadRequestException('Message must be between 1 and 2,000 characters.');
    const [profile, readings, meals, water, summaries] = await Promise.all([
      this.q('SELECT PreferredGlucoseUnit,TargetLow,TargetHigh FROM PatientProfile WHERE UserId=?', [user.sub]),
      this.q('SELECT MeasurementTime,GlucoseValue FROM GlucoseMeasurements WHERE UserId=? AND MeasurementTime>=UTC_TIMESTAMP()-INTERVAL 7 DAY ORDER BY MeasurementTime DESC LIMIT 500', [user.sub]),
      this.q('SELECT MealType,FoodDescription,OccurredAtUtc FROM MealLogs WHERE UserId=? AND DeletedAt IS NULL AND OccurredAtUtc>=UTC_TIMESTAMP()-INTERVAL 7 DAY ORDER BY OccurredAtUtc DESC LIMIT 100', [user.sub]),
      this.q('SELECT AmountMl,OccurredAtUtc FROM WaterIntakeLogs WHERE UserId=? AND DeletedAt IS NULL AND OccurredAtUtc>=UTC_TIMESTAMP()-INTERVAL 7 DAY ORDER BY OccurredAtUtc DESC LIMIT 100', [user.sub]),
      this.q('SELECT SummaryDate,ReadingCount,MeanGlucose,TimeInRangePercentage,Gmi,CvPercentage FROM DailyGlucoseSummaries WHERE UserId=? ORDER BY SummaryDate DESC LIMIT 14', [user.sub]),
    ]);
    const values = readings.map((row: Record<string, unknown>) => Number(row.GlucoseValue ?? row.glucoseValue)).filter(Number.isFinite);
    const metrics = values.length ? {
      readingCount: values.length,
      meanGlucose: Math.round(values.reduce((sum: number, value: number) => sum + value, 0) / values.length * 10) / 10,
      lowestGlucose: Math.min(...values),
      highestGlucose: Math.max(...values),
      timeInRangePercentage: Math.round(values.filter((value: number) => value >= 70 && value <= 180).length / values.length * 1000) / 10,
    } : { readingCount: 0 };
    return this.assistant.answer(message, { profile: profile[0] ?? {}, metrics, dailySummaries: summaries, readings, meals, water });
  }
}
