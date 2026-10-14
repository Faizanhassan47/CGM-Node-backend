import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { normalizeSql } from '../common/sql-helper';
class JoinDto { @IsString() referralCode!: string; }
class AlertDto { @IsBoolean() receiveAlerts!: boolean; }
class RoleDto { @IsString() role!: string; }
class ThresholdDto { @IsOptional() @IsNumber() lowThreshold?:number; @IsOptional() @IsNumber() highThreshold?:number; }
@Controller('api/Family')
export class FamilyController {
  constructor(private db:DataSource){}
  private q(sql:string, params?:unknown[]){ return this.db.query(normalizeSql(sql, this.db), params); }
  private async familyFor(userId:number){const rows=await this.q('SELECT f.*, u.ReferralCode as referralCode, u.FullName as ownerName FROM Families f LEFT JOIN Users u ON u.Id=f.OwnerUserId LEFT JOIN FamilyMembers m ON m.FamilyId=f.Id AND m.UserId=? AND m.Status="Active" WHERE f.IsActive=1 AND (f.OwnerUserId=? OR m.Id IS NOT NULL) LIMIT 1',[userId,userId]);return rows[0];}
  @Get() async get(@CurrentUser()u:AuthUser){const family=await this.familyFor(u.sub);if(!family)throw new NotFoundException({message:'Family not found.'});return family;}
  @Get('members')
  async members(@CurrentUser() u: AuthUser) {
    const f = await this.familyFor(u.sub);
    if (!f) return [];
    const rawMembers = await this.q(
      'SELECT m.Id id, m.UserId userId, u.FullName fullName, u.Email email, m.Role role, m.ReceiveAlerts receiveAlerts, m.Status status, m.JoinedAt joinedAt ' +
      'FROM FamilyMembers m LEFT JOIN Users u ON u.Id=m.UserId WHERE m.FamilyId=? AND m.Status="Active"',
      [f.Id]
    );

    const enriched = await Promise.all(
      rawMembers.map(async (m: Record<string, any>) => {
        const memberUserId = m.userId ?? m.UserId;

        // 1. Get latest glucose measurement
        const latestMeasurement = (await this.q(
          'SELECT TOP 1 GlucoseValue as glucoseValue, MeasurementTime as measurementTime, BatteryVoltageMv as batteryVoltageMv ' +
          'FROM GlucoseMeasurements WHERE UserId=? AND GlucoseValue IS NOT NULL ORDER BY MeasurementTime DESC',
          [memberUserId]
        ))[0];

        // 2. Get active sensor details (expiry date and status)
        const activeSensor = (await this.q(
          'SELECT TOP 1 Id as id, SensorIdentifier as sensorIdentifier, Status as status, ExpiresAt as expiresAt, StartedAt as startedAt ' +
          'FROM Sensors WHERE UserId=? AND IsActive=1 ORDER BY Id DESC',
          [memberUserId]
        ))[0];

        // 3. Get device details (battery percentage / voltage)
        const activeDevice = (await this.q(
          'SELECT TOP 1 BatteryPercentage as batteryPercentage, BatteryVoltageMv as batteryVoltageMv, DeviceModel as deviceModel, BleDeviceName as bleDeviceName ' +
          'FROM CGMDevices WHERE UserId=? AND IsActive=1 ORDER BY Id DESC',
          [memberUserId]
        ))[0];

        let batteryPct = activeDevice?.batteryPercentage ?? activeDevice?.BatteryPercentage;
        const batteryMv = activeDevice?.batteryVoltageMv ?? activeDevice?.BatteryVoltageMv ?? latestMeasurement?.batteryVoltageMv ?? latestMeasurement?.BatteryVoltageMv;
        if (!batteryPct && batteryMv) {
          // Approximate percentage from 3000mV CR2032/LiPo (e.g. 2400mV = 0%, 3000mV = 100%)
          const mv = Number(batteryMv);
          if (mv >= 3000) batteryPct = 100;
          else if (mv <= 2400) batteryPct = 5;
          else batteryPct = Math.round(((mv - 2400) / 600) * 100);
        }

        return {
          ...m,
          currentGlucose: latestMeasurement?.glucoseValue != null ? Number(latestMeasurement.glucoseValue) : null,
          lastReadingTime: latestMeasurement?.measurementTime ?? null,
          sensorExpiresAt: activeSensor?.expiresAt ?? activeSensor?.ExpiresAt ?? null,
          sensorStatus: activeSensor?.status ?? activeSensor?.Status ?? null,
          sensorIdentifier: activeSensor?.sensorIdentifier ?? activeSensor?.SensorIdentifier ?? null,
          batteryPercentage: batteryPct != null ? Number(batteryPct) : null,
          batteryVoltageMv: batteryMv != null ? Number(batteryMv) : null,
        };
      })
    );

    return enriched;
  }
  @Post('create') async create(@CurrentUser()u:AuthUser){if(await this.familyFor(u.sub))throw new BadRequestException({message:'User already belongs to a family.'});await this.q('INSERT INTO Families(OwnerUserId,CreatedAt,IsActive) VALUES(?,UTC_TIMESTAMP(),1)',[u.sub]);const fRow=(await this.q('SELECT TOP 1 Id FROM Families WHERE OwnerUserId=? ORDER BY Id DESC',[u.sub]))[0];const familyId=fRow?.Id??fRow?.id;await this.q('INSERT INTO FamilyMembers(FamilyId,UserId,Role,ReceiveAlerts,Status,JoinedAt) VALUES(?,?,"Owner",1,"Active",UTC_TIMESTAMP())',[familyId,u.sub]);return{familyId};}
  @Post('join') async join(@CurrentUser()u:AuthUser,@Body()d:JoinDto){if(await this.familyFor(u.sub))throw new BadRequestException({message:'User already belongs to a family.'});const owners=await this.q('SELECT f.Id FROM Families f JOIN Users u ON u.Id=f.OwnerUserId WHERE u.ReferralCode=? AND f.IsActive=1',[d.referralCode.trim()]);if(!owners.length)throw new NotFoundException({message:'Invalid referral code.'});await this.q('INSERT INTO FamilyMembers(FamilyId,UserId,Role,ReceiveAlerts,Status,JoinedByReferralCode,JoinedAt) VALUES(?,?,"Member",1,"Active",?,UTC_TIMESTAMP())',[owners[0].Id,u.sub,d.referralCode.trim()]);return{message:'Joined family successfully.'};}
  private async owner(familyId: number, userId: number) {
    const rows = await this.q('SELECT OwnerUserId, Id FROM Families WHERE Id=?', [familyId]);
    if (!rows.length) throw new NotFoundException({ message: 'Family circle does not exist.' });
    const ownerId = Number(rows[0].OwnerUserId ?? rows[0].ownerUserId);
    if (ownerId !== Number(userId)) {
      throw new ForbiddenException({ message: 'Only the circle owner can perform this action.' });
    }
  }
  @Put('members/:targetUserId/alerts')async alerts(@CurrentUser()u:AuthUser,@Param('targetUserId')target:string,@Body()d:AlertDto){const f=await this.familyFor(u.sub);if(!f)throw new NotFoundException();const familyId=Number(f.Id??f.id);await this.owner(familyId,u.sub);await this.q('UPDATE FamilyMembers SET ReceiveAlerts=? WHERE FamilyId=? AND UserId=?',[d.receiveAlerts,familyId,target]);return{message:'Alert preference updated.'};}
  @Put('members/:targetUserId/role')async role(@CurrentUser()u:AuthUser,@Param('targetUserId')target:string,@Body()d:RoleDto){const f=await this.familyFor(u.sub);if(!f)throw new NotFoundException();const familyId=Number(f.Id??f.id);await this.owner(familyId,u.sub);await this.q('UPDATE FamilyMembers SET Role=? WHERE FamilyId=? AND UserId=?',[d.role,familyId,target]);return{message:'Role updated.'};}
  @Put('thresholds') async thresholds(@CurrentUser()u:AuthUser,@Body()d:ThresholdDto){const f=await this.familyFor(u.sub);if(!f)throw new NotFoundException();const familyId=Number(f.Id??f.id);await this.owner(familyId,u.sub);await this.q('UPDATE Families SET LowGlucoseThreshold=?,HighGlucoseThreshold=? WHERE Id=?',[d.lowThreshold??null,d.highThreshold??null,familyId]);return{message:'Thresholds updated.'};}
  @Delete('members/:targetUserId')async remove(@CurrentUser()u:AuthUser,@Param('targetUserId')target:string){const f=await this.familyFor(u.sub);if(!f)throw new NotFoundException();const familyId=Number(f.Id??f.id);await this.owner(familyId,u.sub);await this.q('UPDATE FamilyMembers SET Status="Removed" WHERE FamilyId=? AND UserId=?',[familyId,target]);}
  @Delete()
  async deleteFamily(@CurrentUser() u: AuthUser) {
    const f = await this.familyFor(u.sub);
    if (!f) throw new NotFoundException({ message: 'Family not found.' });
    const familyId = Number(f.Id ?? f.id);
    console.log(`[FAMILY-DELETE] User ${u.sub} attempting to delete family ${familyId}`);
    await this.owner(familyId, u.sub);
    await this.q('UPDATE Families SET IsActive=0 WHERE Id=?', [familyId]);
    await this.q('UPDATE FamilyMembers SET Status="Removed" WHERE FamilyId=?', [familyId]);
    console.log(`[FAMILY-DELETE] Family ${familyId} deleted successfully by user ${u.sub}`);
    return { success: true, message: 'Family circle successfully deleted.' };
  }
  @Post('leave')async leave(@CurrentUser()u:AuthUser){const f=await this.familyFor(u.sub);if(!f)throw new NotFoundException();if(f.OwnerUserId===u.sub)throw new BadRequestException({message:'The owner cannot leave the family. You can delete the family instead.'});await this.q('UPDATE FamilyMembers SET Status="Left" WHERE FamilyId=? AND UserId=?',[f.Id,u.sub]);return{message:'Left family successfully.'};}
  @Post('notify')async notify(@CurrentUser()u:AuthUser){const f=await this.familyFor(u.sub);if(!f)throw new NotFoundException();await this.q('INSERT INTO Alerts(UserId,AlertType,Title,Message,Severity,IsRead,AlertTime,CreatedAt) VALUES(?,"FamilyNotification","Family notification","A family member requested your attention.","Warning",0,UTC_TIMESTAMP(),UTC_TIMESTAMP())',[u.sub]);return{message:'Notification created.'};}
  @Get('weekly-report')weekly(@CurrentUser()u:AuthUser){return this.report(u.sub);}
  @Get('members/:targetUserId/report-summary')async memberReport(@CurrentUser()u:AuthUser,@Param('targetUserId')target:string){const f=await this.familyFor(u.sub);if(!f)throw new ForbiddenException();const allowed=await this.q('SELECT 1 FROM FamilyMembers WHERE FamilyId=? AND UserId=? AND Status="Active"',[f.Id,target]);if(!allowed.length)throw new ForbiddenException();return this.report(Number(target));}
  private async report(userId:number){const rows=await this.q('SELECT GlucoseValue,MeasurementTime FROM GlucoseMeasurements WHERE UserId=? AND MeasurementTime>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY) AND GlucoseValue IS NOT NULL ORDER BY MeasurementTime',[userId]);const values=rows.map((x:Record<string,unknown>)=>Number(x.GlucoseValue));return{userId,readingCount:values.length,averageGlucose:values.length?Math.round(values.reduce((a:number,b:number)=>a+b,0)/values.length):null,timeInRangePercentage:values.length?Math.round(values.filter((v:number)=>v>=70&&v<=180).length/values.length*1000)/10:0,readings:rows};}
}
