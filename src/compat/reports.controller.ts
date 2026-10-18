import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Query,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { AuthUser, CurrentUser } from "../common/auth-user";
import { normalizeSql } from "../common/sql-helper";

@Controller("api/Reports")
export class ReportsController {
  constructor(private db: DataSource) {}

  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }

  private async ensureReportAccess(
    requesterUserId: number,
    targetUserId: number,
  ) {
    if (targetUserId === requesterUserId) return;
    const access = await this.q(
      'SELECT 1 FROM Families f LEFT JOIN FamilyMembers me ON me.FamilyId=f.Id AND me.UserId=? AND me.Status="Active" LEFT JOIN FamilyMembers them ON them.FamilyId=f.Id AND them.UserId=? AND them.Status="Active" WHERE f.IsActive=1 AND (f.OwnerUserId=? OR me.Id IS NOT NULL) AND them.Id IS NOT NULL LIMIT 1',
      [requesterUserId, targetUserId, requesterUserId],
    );
    if (!access.length) {
      throw new ForbiddenException(
        "You do not have permission to view reports for this user.",
      );
    }
  }

  @Get("detailed")
  async detailed(
    @CurrentUser() u: AuthUser,
    @Query("targetUserId") target?: string,
    @Query("startDate") startText?: string,
    @Query("endDate") endText?: string,
  ) {
    const userId = target && Number(target) > 0 ? Number(target) : u.sub;
    await this.ensureReportAccess(u.sub, userId);
    const users = await this.q(
      "SELECT Id,FullName,Email FROM Users WHERE Id=?",
      [userId],
    );
    if (!users.length)
      throw new NotFoundException({ message: "User not found." });
    const end = endText ? new Date(endText) : new Date();
    const start = startText
      ? new Date(startText)
      : new Date(end.getTime() - 6 * 86400000);
    const rows = await this.q(
      "SELECT GlucoseValue,MeasurementTime FROM GlucoseMeasurements WHERE UserId=? AND MeasurementTime>=? AND MeasurementTime<? AND GlucoseValue IS NOT NULL ORDER BY MeasurementTime",
      [userId, start, new Date(end.getTime() + 86400000)],
    );
    const values = rows.map((r: Record<string, unknown>) =>
      Number(r.GlucoseValue),
    );
    const pct = (fn: (v: number) => boolean) =>
      values.length
        ? Math.round((values.filter(fn).length / values.length) * 1000) / 10
        : 0;
    const avg = values.length
      ? Math.round(
          values.reduce((a: number, b: number) => a + b, 0) / values.length,
        )
      : 0;
    const variance =
      values.length > 1
        ? values.reduce((n: number, v: number) => n + (v - avg) ** 2, 0) /
          (values.length - 1)
        : 0;
    const sd = Math.round(Math.sqrt(variance) * 10) / 10;
    const daily = new Map<string, number[]>();
    for (const r of rows) {
      const key = new Date(r.MeasurementTime).toISOString().slice(0, 10);
      daily.set(key, [...(daily.get(key) ?? []), Number(r.GlucoseValue)]);
    }
    // Calculate actual clinical events (runs of readings outside range)
    let highEvents = 0;
    let lowEvents = 0;
    let inHigh = false;
    let inLow = false;
    for (const v of values) {
      if (v > 180 && !inHigh) highEvents++;
      inHigh = v > 180;
      if (v < 70 && !inLow) lowEvents++;
      inLow = v < 70;
    }

    return {
      userId,
      patientName: users[0].FullName || "Circle Patient",
      patientEmail: users[0].Email,
      dateRange: `${start.toDateString()} – ${end.toDateString()}`,
      startDate: start,
      endDate: end,
      generatedAt: new Date(),
      totalReadings: values.length,
      avgGlucose: values.length ? `${avg} mg/dL` : null,
      timeInRange: values.length ? `${pct((v) => v >= 70 && v <= 180)}%` : null,
      timeAboveRange: values.length ? `${pct((v) => v > 180)}%` : null,
      timeBelowRange: values.length ? `${pct((v) => v < 70)}%` : null,
      timeVeryHigh: values.length ? `${pct((v) => v > 250)}%` : null,
      timeVeryLow: values.length ? `${pct((v) => v < 54)}%` : null,
      highestGlucose: values.length ? `${Math.max(...values)} mg/dL` : null,
      lowestGlucose: values.length ? `${Math.min(...values)} mg/dL` : null,
      estimatedA1c: values.length
        ? `${Math.round(((avg + 46.7) / 28.7) * 10) / 10}%`
        : null,
      glucoseVariability:
        values.length && avg ? `${Math.round((sd / avg) * 1000) / 10}%` : null,
      standardDeviation: values.length ? `${sd} mg/dL` : null,
      lowEvents: values.length ? lowEvents : null,
      highEvents: values.length ? highEvents : null,
      tirPercentage: pct((v) => v >= 70 && v <= 180),
      tarPercentage: pct((v) => v > 180),
      tbrPercentage: pct((v) => v < 70),
      veryHighPercentage: pct((v) => v > 250),
      veryLowPercentage: pct((v) => v < 54),
      dailySummaries: [...daily].map(([date, v]) => ({
        dateFormatted: date,
        readingsCount: v.length,
        avgGlucose: `${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} mg/dL`,
        minGlucose: `${Math.min(...v)} mg/dL`,
        maxGlucose: `${Math.max(...v)} mg/dL`,
        timeInRange: `${Math.round((v.filter((x) => x >= 70 && x <= 180).length / v.length) * 100)}%`,
        lowEvents: v.filter((x) => x < 70).length,
        highEvents: v.filter((x) => x > 180).length,
      })),
      recentReadings: rows.map((r: Record<string, unknown>) => ({
        time: r.MeasurementTime,
        timeFormatted: new Date(r.MeasurementTime as string).toLocaleString(),
        value: Number(r.GlucoseValue),
        status:
          Number(r.GlucoseValue) < 54
            ? "Very Low"
            : Number(r.GlucoseValue) < 70
              ? "Low"
              : Number(r.GlucoseValue) > 250
                ? "Very High"
                : Number(r.GlucoseValue) > 180
                  ? "High"
                  : "Normal",
      })),
    };
  }

  @Get("overnight")
  async overnight(
    @CurrentUser() u: AuthUser,
    @Query("targetUserId") target?: string,
    @Query("date") dateText?: string,
  ) {
    const userId = target && Number(target) > 0 ? Number(target) : u.sub;
    await this.ensureReportAccess(u.sub, userId);
    const profiles = await this.q(
      "SELECT BedTime, WakeTime, NightLowThreshold, NightHighThreshold, NightAlertsEnabled FROM PatientProfile WHERE UserId=?",
      [userId],
    );
    const p = profiles[0] || {};
    const bedTimeStr = p.BedTime || "22:00";
    const wakeTimeStr = p.WakeTime || "07:00";
    const lowThresh = Number(p.NightLowThreshold ?? 70.0);
    const highThresh = Number(p.NightHighThreshold ?? 160.0);

    const refDate = dateText ? new Date(dateText) : new Date();
    const [bedHour, bedMin] = bedTimeStr.split(":").map(Number);
    const [wakeHour, wakeMin] = wakeTimeStr.split(":").map(Number);

    const sleepStart = new Date(refDate);
    sleepStart.setDate(sleepStart.getDate() - 1);
    sleepStart.setHours(bedHour, bedMin, 0, 0);

    const sleepEnd = new Date(refDate);
    sleepEnd.setHours(wakeHour, wakeMin, 0, 0);

    const rows = await this.q(
      "SELECT GlucoseValue, MeasurementTime FROM GlucoseMeasurements WHERE UserId=? AND MeasurementTime>=? AND MeasurementTime<=? AND GlucoseValue IS NOT NULL ORDER BY MeasurementTime ASC",
      [userId, sleepStart, sleepEnd],
    );

    const values = rows
      .map((r: Record<string, unknown>) => Number(r.GlucoseValue))
      .filter((v: number) => !isNaN(v) && v > 0);
    const count = values.length;

    if (!count) {
      return {
        userId,
        bedTime: bedTimeStr,
        wakeTime: wakeTimeStr,
        nightLowThreshold: lowThresh,
        nightHighThreshold: highThresh,
        sleepStart,
        sleepEnd,
        hasData: false,
        message:
          "No continuous glucose readings recorded during the overnight sleep window.",
      };
    }

    const mean = Math.round(
      values.reduce((a: number, b: number) => a + b, 0) / count,
    );
    const variance =
      count > 1
        ? values.reduce((n: number, v: number) => n + (v - mean) ** 2, 0) /
          (count - 1)
        : 0;
    const sd = Math.round(Math.sqrt(variance) * 10) / 10;
    const cv = mean > 0 ? Math.round((sd / mean) * 1000) / 10 : 0;

    const tir =
      Math.round(
        (values.filter((v: number) => v >= lowThresh && v <= highThresh)
          .length /
          count) *
          1000,
      ) / 10;
    const tbr =
      Math.round(
        (values.filter((v: number) => v < lowThresh).length / count) * 1000,
      ) / 10;
    const tar =
      Math.round(
        (values.filter((v: number) => v > highThresh).length / count) * 1000,
      ) / 10;

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const minReading = rows.find(
      (r: Record<string, unknown>) => Number(r.GlucoseValue) === minVal,
    );

    // 1. Nocturnal Hypoglycemia
    const nocturnalHypos = values.filter((v: number) => v < lowThresh).length;
    const nocturnalHypoDetected = nocturnalHypos > 0;

    // 2. Dawn Phenomenon detection (>= 25 mg/dL rise between 4:00 AM and wakeTime without hypo)
    const earlyMorningRows = rows.filter((r: Record<string, unknown>) => {
      const h = new Date(r.MeasurementTime as string).getHours();
      return h >= 4 && h <= wakeHour;
    });
    let dawnPhenomenonDetected = false;
    let dawnRiseMgDl = 0;
    if (earlyMorningRows.length >= 2) {
      const dawnStartVal = Number(earlyMorningRows[0].GlucoseValue);
      const dawnMaxVal = Math.max(
        ...earlyMorningRows.map((r: Record<string, unknown>) =>
          Number(r.GlucoseValue),
        ),
      );
      dawnRiseMgDl = Math.round((dawnMaxVal - dawnStartVal) * 10) / 10;
      if (dawnRiseMgDl >= 25 && earlyMorningRows[0].GlucoseValue >= lowThresh) {
        dawnPhenomenonDetected = true;
      }
    }

    // 3. Somogyi Effect detection (low between 1am-4am followed by morning spike > 180)
    const midnightDip = rows.some((r: Record<string, unknown>) => {
      const h = new Date(r.MeasurementTime as string).getHours();
      return h >= 1 && h <= 4 && Number(r.GlucoseValue) < lowThresh;
    });
    const morningSpike = rows.some((r: Record<string, unknown>) => {
      const h = new Date(r.MeasurementTime as string).getHours();
      return h >= 6 && Number(r.GlucoseValue) > 180;
    });
    const somogyiEffectDetected = midnightDip && morningSpike;

    let stabilityScore: "Stable" | "Moderate Fluctuation" | "High Variability" =
      "Stable";
    if (cv > 36 || nocturnalHypoDetected) {
      stabilityScore = "High Variability";
    } else if (cv > 25) {
      stabilityScore = "Moderate Fluctuation";
    }

    return {
      userId,
      hasData: true,
      bedTime: bedTimeStr,
      wakeTime: wakeTimeStr,
      sleepStart,
      sleepEnd,
      totalSleepReadings: count,
      meanGlucose: mean,
      standardDeviation: sd,
      coefficientOfVariation: cv,
      timeInRange: tir,
      timeBelowRange: tbr,
      timeAboveRange: tar,
      lowestGlucose: minVal,
      lowestGlucoseTime: minReading ? minReading.MeasurementTime : null,
      highestGlucose: maxVal,
      stabilityScore,
      nocturnalHypoDetected,
      nocturnalHypoCount: nocturnalHypos,
      dawnPhenomenonDetected,
      dawnRiseMgDl,
      somogyiEffectDetected,
      nightLowThreshold: lowThresh,
      nightHighThreshold: highThresh,
      curve: rows.map((r: Record<string, unknown>) => ({
        time: r.MeasurementTime,
        value: Number(r.GlucoseValue),
        status:
          Number(r.GlucoseValue) < lowThresh
            ? "Low"
            : Number(r.GlucoseValue) > highThresh
              ? "High"
              : "Normal",
      })),
    };
  }
}
