import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { normalizeSql } from '../common/sql-helper';
class RuleDto { @IsString() alertType!: string; @IsOptional() @IsNumber() minimumValue?: number; @IsOptional() @IsNumber() maximumValue?: number; @IsInt() @Min(0) durationMinutes = 15; @IsBoolean() enabled = true; }
@Controller('api/Alerts')
export class AlertsController {
  constructor(private db: DataSource) {}
  private q(sql: string, params?: unknown[]) { return this.db.query(normalizeSql(sql, this.db), params); }
  @Get() async list(@CurrentUser() u: AuthUser, @Query('severity') severity?: string, @Query('unreadOnly') unread?: string) {
    if (this.db.options.type === 'mysql') {
      await this.q(`CREATE TABLE IF NOT EXISTS UserAlertClears (UserId INT PRIMARY KEY, ClearedAt DATETIME NOT NULL)`);
    }
    // Alerts created for the patient may not have an AlertRecipients row
    // (for example legacy rows or family notifications). Include those rows
    // while keeping all activity scoped to the authenticated user.
    let sql = `SELECT * FROM (
      SELECT CONCAT('alert:', a.Id) id, IF(a.AlertType="HighGlucose",1,0) category,
        a.Title title, a.Message message, a.AlertTime timestamp, a.GlucoseValue glucoseValue,
        IF(a.GlucoseUnit="mmol/L",1,0) unit, COALESCE(r.IsRead,a.IsRead,0) isRead,
        IF(a.Severity="Critical",1,0) isCritical, a.UserId patientUserId, a.Severity severity
      FROM Alerts a
      LEFT JOIN AlertRecipients r ON a.Id=r.AlertId AND r.UserId=?
      WHERE (a.UserId=? OR r.UserId IS NOT NULL)
      ${severity ? 'AND a.Severity=?' : ''}
    ) activity`;
    const args: unknown[] = [u.sub, u.sub];
    if (severity) args.push(severity);
    if (unread === 'true') sql += ' WHERE isRead=0 AND timestamp > COALESCE((SELECT ClearedAt FROM UserAlertClears WHERE UserId=?), \'1970-01-01\')';
    else sql += ' WHERE timestamp > COALESCE((SELECT ClearedAt FROM UserAlertClears WHERE UserId=?), \'1970-01-01\')';
    args.push(u.sub);
    return this.q(`${sql} ORDER BY timestamp DESC LIMIT 50`, args);
  }
  @Delete('history') async clearHistory(@CurrentUser() u: AuthUser) {
    if (this.db.options.type === 'mysql') {
      await this.q(`CREATE TABLE IF NOT EXISTS UserAlertClears (
        UserId INT PRIMARY KEY,
        ClearedAt DATETIME NOT NULL
      )`);
      await this.q('INSERT INTO UserAlertClears (UserId, ClearedAt) VALUES (?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE ClearedAt=UTC_TIMESTAMP()', [u.sub]);
    } else {
      await this.q(`IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserAlertClears')
        CREATE TABLE UserAlertClears (UserId INT PRIMARY KEY, ClearedAt DATETIME NOT NULL)`);
      await this.q(`MERGE UserAlertClears AS target
        USING (SELECT ? AS UserId) AS source ON target.UserId = source.UserId
        WHEN MATCHED THEN UPDATE SET ClearedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (UserId, ClearedAt) VALUES (source.UserId, GETUTCDATE());`, [u.sub]);
    }
    return { message: 'Alert history cleared.' };
  }
  @Put(':id/read') async read(@CurrentUser() u: AuthUser, @Param('id') id: string) { const result = await this.q('UPDATE AlertRecipients SET IsRead=1,ReadAt=UTC_TIMESTAMP() WHERE AlertId=? AND UserId=?', [id, u.sub]); if (!result.affectedRows && !result.rowsAffected?.[0]) throw new NotFoundException(); return { message: 'Alert marked as read.' }; }
}
@Controller('api/alert-rules')
export class AlertRulesController {
  constructor(private db: DataSource) {}
  private q(sql: string, params?: unknown[]) { return this.db.query(normalizeSql(sql, this.db), params); }
  private check(d: RuleDto) { if (d.minimumValue != null && d.maximumValue != null && d.minimumValue > d.maximumValue) throw new BadRequestException({ message: 'Minimum value cannot exceed maximum value.' }); }
  @Get() get(@CurrentUser() u: AuthUser) { return this.q('SELECT * FROM AlertRules WHERE UserId=? ORDER BY AlertType', [u.sub]); }
  @Post() async create(@CurrentUser() u: AuthUser, @Body() d: RuleDto) { this.check(d); const r = await this.q('INSERT INTO AlertRules(UserId,AlertType,MinimumValue,MaximumValue,DurationMinutes,Enabled,CreatedAt) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP())', [u.sub,d.alertType.trim(),d.minimumValue??null,d.maximumValue??null,d.durationMinutes,d.enabled]); const insertedId = r.insertId ?? r[0]?.id ?? (await this.q('SELECT TOP 1 Id FROM AlertRules WHERE UserId=? ORDER BY Id DESC', [u.sub]))[0]?.Id; return (await this.q('SELECT * FROM AlertRules WHERE Id=?',[insertedId]))[0]; }
  @Put(':id') async update(@CurrentUser() u: AuthUser,@Param('id') id:string,@Body() d:RuleDto){this.check(d);const rows=await this.q('SELECT UserId FROM AlertRules WHERE Id=?',[id]);if(!rows.length)throw new NotFoundException();if(rows[0].UserId!==u.sub)throw new ForbiddenException();await this.q('UPDATE AlertRules SET AlertType=?,MinimumValue=?,MaximumValue=?,DurationMinutes=?,Enabled=? WHERE Id=?',[d.alertType.trim(),d.minimumValue??null,d.maximumValue??null,d.durationMinutes,d.enabled,id]);return (await this.q('SELECT * FROM AlertRules WHERE Id=?',[id]))[0];}
  @Delete(':id') async remove(@CurrentUser() u:AuthUser,@Param('id') id:string){const r=await this.q('DELETE FROM AlertRules WHERE Id=? AND UserId=?',[id,u.sub]);if(!r.affectedRows && !r.rowsAffected?.[0])throw new NotFoundException();}
}
