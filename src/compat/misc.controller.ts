import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from "class-validator";
import { DataSource } from "typeorm";
import { Public } from "../auth/public.decorator";
import { AuthUser, CurrentUser } from "../common/auth-user";
import { normalizeSql } from "../common/sql-helper";
class EndpointDto {
  @IsIn(["Push", "SMS"]) channel!: string;
  @IsString() address!: string;
  @IsOptional() @IsBoolean() enabled = true;
}
class AppVersionDto {
  @IsString() platform!: string;
  @IsString() versionName!: string;
  @IsInt() versionCode!: number;
  @IsOptional() @IsString() minimumSupportedVersion?: string;
  @IsOptional() @IsString() downloadUrl?: string;
  @IsOptional() @IsString() releaseNotes?: string;
  @IsOptional() @IsBoolean() isMandatory = false;
}
class HardwareDto {
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() deviceModel?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() osVersion?: string;
  @IsOptional() @IsString() appVersion?: string;
  @IsOptional() @IsString() bluetoothMacAddress?: string;
  @IsOptional() @IsString() rawData?: string;
}
@Controller("api/notification-endpoints")
export class NotificationEndpointsController {
  constructor(private db: DataSource) {}
  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }
  @Get() get(@CurrentUser() u: AuthUser) {
    return this.q("SELECT * FROM NotificationEndpoints WHERE UserId=?", [
      u.sub,
    ]);
  }
  @Post() async save(@CurrentUser() u: AuthUser, @Body() d: EndpointDto) {
    const rows = await this.q(
      "SELECT * FROM NotificationEndpoints WHERE UserId=? AND Channel=? AND Address=?",
      [u.sub, d.channel, d.address.trim()],
    );
    if (rows.length) {
      await this.q(
        "UPDATE NotificationEndpoints SET Enabled=?,UpdatedAt=UTC_TIMESTAMP() WHERE Id=?",
        [d.enabled, rows[0].Id],
      );
      return { ...rows[0], Enabled: d.enabled };
    }
    await this.q(
      "INSERT INTO NotificationEndpoints(UserId,Channel,Address,Enabled,CreatedAt) VALUES(?,?,?,?,UTC_TIMESTAMP())",
      [u.sub, d.channel, d.address.trim(), d.enabled],
    );
    const ep = (
      await this.q(
        "SELECT TOP 1 * FROM NotificationEndpoints WHERE UserId=? ORDER BY Id DESC",
        [u.sub],
      )
    )[0];
    return ep;
  }
  @Delete(":id") async remove(
    @CurrentUser() u: AuthUser,
    @Param("id") id: string,
  ) {
    const rows = await this.q(
      "SELECT UserId FROM NotificationEndpoints WHERE Id=?",
      [id],
    );
    if (!rows.length) throw new NotFoundException();
    if (rows[0].UserId !== u.sub) throw new ForbiddenException();
    await this.q("DELETE FROM NotificationEndpoints WHERE Id=?", [id]);
  }
}
@Controller("api/AppVersion")
export class AppVersionController {
  constructor(private db: DataSource) {}
  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }
  private checkAdmin(u: AuthUser) {
    const adminEmails = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (!u.email || !adminEmails.includes(u.email.toLowerCase())) {
      throw new ForbiddenException(
        "Only administrators can publish application versions.",
      );
    }
  }
  @Public()
  @Get("latest")
  async latest(@Query("platform") p?: string) {
    if (!p)
      throw new BadRequestException(
        "Platform is required (e.g., 'Android' or 'iOS').",
      );
    const rows = await this.q(
      "SELECT * FROM AppVersions WHERE LOWER(Platform)=LOWER(?) ORDER BY VersionCode DESC LIMIT 1",
      [p],
    );
    if (!rows.length)
      throw new NotFoundException(`No version info found for platform '${p}'.`);
    return rows[0];
  }
  @Post()
  async add(@CurrentUser() u: AuthUser, @Body() d: AppVersionDto) {
    this.checkAdmin(u);
    await this.q(
      "INSERT INTO AppVersions(Platform,VersionName,VersionCode,MinimumSupportedVersion,DownloadUrl,IsForceUpdate,ReleaseNotes,ReleaseDate) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP())",
      [
        d.platform,
        d.versionName,
        d.versionCode,
        d.minimumSupportedVersion ?? null,
        d.downloadUrl ?? null,
        d.isMandatory,
        d.releaseNotes ?? null,
      ],
    );
    const row = (
      await this.q(
        "SELECT TOP 1 * FROM AppVersions WHERE LOWER(Platform)=LOWER(?) ORDER BY Id DESC",
        [d.platform],
      )
    )[0];
    return { ...d, id: row?.Id ?? row?.id, releaseDate: new Date() };
  }
}
@Public()
@Controller("api/Articles")
export class ArticlesController {
  constructor(private db: DataSource) {}
  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }
  @Get() all(@Query("category") c?: string) {
    return c
      ? this.q(
          "SELECT * FROM Articles WHERE IsPublished=1 AND Category=? ORDER BY CreatedAt DESC",
          [c],
        )
      : this.q(
          "SELECT * FROM Articles WHERE IsPublished=1 ORDER BY CreatedAt DESC",
        );
  }
  @Get(":id") async one(@Param("id") id: string) {
    const rows = await this.q(
      "SELECT * FROM Articles WHERE Id=? AND IsPublished=1",
      [id],
    );
    if (!rows.length) throw new NotFoundException();
    return rows[0];
  }
}
@Public()
@Controller("api/Dictionaries")
export class DictionariesController {
  constructor(private db: DataSource) {}
  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }
  @Get("foods") foods() {
    return this.q("SELECT * FROM DictFoods ORDER BY Name");
  }
  @Get("insulins") insulins() {
    return this.q("SELECT * FROM DictInsulins ORDER BY Name");
  }
  @Get("moods") moods() {
    return this.q("SELECT * FROM DictMoods ORDER BY Name");
  }
}
@Controller("api/DeviceHardware")
export class DeviceHardwareController {
  constructor(private db: DataSource) {}
  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }
  @Post("log")
  async log(@CurrentUser() u: AuthUser, @Body() d: HardwareDto) {
    const deviceModel = d.deviceModel ?? d.model ?? "Unknown";
    const osVersion = d.osVersion ?? null;
    const btMac = d.bluetoothMacAddress ?? null;
    console.log(
      `[HARDWARE-LOG] Logging phone hardware for user ${u.sub}: Model=${deviceModel}, OS=${osVersion}, BT=${btMac}`,
    );
    await this.q(
      "INSERT INTO PhoneHardwareLogs(UserId,DeviceModel,OsVersion,BluetoothMacAddress,LoggedAt) VALUES(?,?,?,?,UTC_TIMESTAMP())",
      [u.sub, deviceModel, osVersion, btMac],
    );
    return { success: true, message: "Hardware log recorded." };
  }
}
@Controller("api/Admin")
export class AdminController {
  constructor(private db: DataSource) {}
  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }

  private checkAdmin(u: AuthUser) {
    const configured = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!configured.length) {
      throw new ForbiddenException({
        statusCode: 403,
        message: "Forbidden: Admin access is not configured.",
      });
    }
    const isEmailAdmin =
      u?.email && configured.includes(u.email.toLowerCase());
    if (!isEmailAdmin) {
      throw new ForbiddenException({
        statusCode: 403,
        message: "Forbidden: Access is restricted to system administrators.",
      });
    }
  }

  @Get("users")
  async users(@CurrentUser() u: AuthUser) {
    this.checkAdmin(u);
    return this.q(
      "SELECT Id,FullName,Email,AuthProvider,EmailVerified,IsActive,CreatedAt FROM Users ORDER BY CreatedAt DESC LIMIT 100",
    );
  }

  @Get("users/:id/record")
  async userRecord(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    this.checkAdmin(u);
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new NotFoundException("User not found.");
    }
    const users = await this.q(
      "SELECT Id,FullName,Email,AuthProvider,EmailVerified,IsActive,ProfilePictureUrl,ReferralCode,CreatedAt FROM Users WHERE Id=?",
      [userId],
    );
    if (!users.length) throw new NotFoundException("User not found.");
    const safe = async (sql: string, params: unknown[] = [userId]) => {
      try {
        return await this.q(sql, params);
      } catch {
        return [];
      }
    };
    const [
      profiles,
      devices,
      sensors,
      latest,
      history,
      summaryRows,
      daily,
      alerts,
      rules,
      families,
      members,
      meals,
      water,
      hardware,
    ] = await Promise.all([
      safe("SELECT * FROM PatientProfile WHERE UserId=?", [userId]),
      safe(
        "SELECT Id,DeviceName,DeviceType,DeviceModel,SerialNumber,BleDeviceName,FirmwareVersion,BatteryPercentage,ConnectionStatus,LastConnectedAt,IsActive,CreatedAt FROM CGMDevices WHERE UserId=? ORDER BY CreatedAt DESC",
        [userId],
      ),
      safe(
        "SELECT Id,DeviceId,SensorIdentifier,Status,StartedAt,ActivatedAt,ExpiresAt,EndedAt,LastReadingAt,IsActive FROM Sensors WHERE UserId=? ORDER BY Id DESC",
        [userId],
      ),
      safe(
        "SELECT SensorId,MeasurementTime,GlucoseValue,SequenceNumber,DeviceTemperatureC,BatteryVoltageMv FROM GlucoseMeasurements WHERE UserId=? ORDER BY MeasurementTime DESC LIMIT 1",
        [userId],
      ),
      safe(
        "SELECT SensorId,MeasurementTime,GlucoseValue,SequenceNumber FROM GlucoseMeasurements WHERE UserId=? ORDER BY MeasurementTime DESC LIMIT 200",
        [userId],
      ),
      safe(
        "SELECT COUNT(*) ReadingCount, AVG(GlucoseValue) MeanGlucose, MIN(GlucoseValue) MinGlucose, MAX(GlucoseValue) MaxGlucose FROM GlucoseMeasurements WHERE UserId=? AND GlucoseValue IS NOT NULL",
        [userId],
      ),
      safe(
        "SELECT SummaryDate,ReadingCount,MeanGlucose,TimeInRangePercentage,Gmi,CvPercentage FROM DailyGlucoseSummaries WHERE UserId=? ORDER BY SummaryDate DESC LIMIT 30",
        [userId],
      ),
      safe(
        "SELECT Id,AlertType,Title,Message,GlucoseValue,GlucoseUnit,Severity,IsRead,AlertTime FROM Alerts WHERE UserId=? ORDER BY AlertTime DESC LIMIT 50",
        [userId],
      ),
      safe(
        "SELECT Id,AlertType,MinimumValue,MaximumValue,DurationMinutes,Enabled FROM AlertRules WHERE UserId=? ORDER BY AlertType",
        [userId],
      ),
      safe(
        "SELECT Id,OwnerUserId,IsActive,LowGlucoseThreshold,HighGlucoseThreshold,CreatedAt FROM Families WHERE OwnerUserId=? OR Id IN (SELECT FamilyId FROM FamilyMembers WHERE UserId=? AND Status=\"Active\")",
        [userId, userId],
      ),
      safe(
        "SELECT fm.Id,fm.UserId,fm.Role,fm.Status,fm.ReceiveAlerts,u.FullName,u.Email FROM FamilyMembers fm JOIN Users u ON u.Id=fm.UserId WHERE fm.FamilyId IN (SELECT Id FROM Families WHERE OwnerUserId=? UNION SELECT FamilyId FROM FamilyMembers WHERE UserId=?)",
        [userId, userId],
      ),
      safe(
        "SELECT Id,MealType,FoodDescription,OccurredAtUtc FROM MealLogs WHERE UserId=? AND DeletedAt IS NULL ORDER BY OccurredAtUtc DESC LIMIT 50",
        [userId],
      ),
      safe(
        "SELECT Id,AmountMl,OccurredAtUtc FROM WaterIntakeLogs WHERE UserId=? AND DeletedAt IS NULL ORDER BY OccurredAtUtc DESC LIMIT 50",
        [userId],
      ),
      safe(
        "SELECT DeviceModel,OsVersion,BluetoothMacAddress,LoggedAt FROM PhoneHardwareLogs WHERE UserId=? ORDER BY LoggedAt DESC LIMIT 10",
        [userId],
      ),
    ]);
    const summary = summaryRows[0] || {};
    return {
      user: users[0],
      profile: profiles[0] || null,
      devices,
      sensors,
      latest: latest[0] || null,
      history,
      summary: {
        ReadingCount: Number(summary.ReadingCount ?? 0),
        MeanGlucose: summary.MeanGlucose == null ? null : Number(summary.MeanGlucose),
        MinGlucose: summary.MinGlucose == null ? null : Number(summary.MinGlucose),
        MaxGlucose: summary.MaxGlucose == null ? null : Number(summary.MaxGlucose),
      },
      dailySummaries: daily,
      alerts,
      alertRules: rules,
      family: families[0] || null,
      members,
      meals,
      water,
      hardware,
    };
  }

  @Post("users/:id/disable")
  async disable(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    this.checkAdmin(u);
    const r = await this.q("UPDATE Users SET IsActive=0 WHERE Id=?", [id]);
    if (!r.affectedRows && !r.rowsAffected?.[0]) throw new NotFoundException();
    return { success: true, message: `User ${id} has been disabled.` };
  }

  @Get("stats")
  async stats(@CurrentUser() u: AuthUser) {
    this.checkAdmin(u);
    const [[users], [sensors], [alerts]] = await Promise.all([
      this.q("SELECT COUNT(*) TotalUsers FROM Users"),
      this.q("SELECT COUNT(*) TotalSensors FROM Sensors"),
      this.q("SELECT COUNT(*) ActiveAlerts FROM Alerts WHERE IsRead=0"),
    ]);
    return {
      TotalUsers: Number(users?.TotalUsers ?? 0),
      TotalSensors: Number(sensors?.TotalSensors ?? 0),
      ActiveAlerts: Number(alerts?.ActiveAlerts ?? 0),
    };
  }
}
