import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { CgmDevice } from '../database/entities';
import { RegisterDeviceDto, UpdateDeviceDto } from './cgm.dto';

@Controller('api/Devices')
export class DevicesController {
  constructor(@InjectRepository(CgmDevice) private readonly devices: Repository<CgmDevice>) {}
  private view(d: CgmDevice) { return { id: d.id, deviceName: d.deviceName ?? 'CGM Device', deviceType: d.deviceType ?? 'Disposable', deviceModel: d.deviceModel ?? 'G-AA', serialNumber: d.serialNumber, bleDeviceName: d.bleDeviceName, firmwareVersion: d.firmwareVersion, batteryVoltageMv: d.batteryVoltageMv, batteryPercentage: d.batteryPercentage == null ? null : Number(d.batteryPercentage), connectionStatus: d.connectionStatus, lastConnectedAt: d.lastConnectedAt }; }
  private async owned(id: number, userId: number) { const d = await this.devices.findOneBy({ id }); if (!d) throw new NotFoundException(); if (d.userId !== userId) throw new ForbiddenException(); return d; }
  @Get() async all(@CurrentUser() u: AuthUser) { return (await this.devices.findBy({ userId: u.sub, isActive: true })).map((d) => this.view(d)); }
  @Get(':id') async one(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.view(await this.owned(Number(id), u.sub)); }
  @Post('register') async register(@CurrentUser() u: AuthUser, @Body() dto: RegisterDeviceDto) {
    let device = dto.serialNumber ? await this.devices.findOneBy({ serialNumber: dto.serialNumber }) : null;
    device ??= this.devices.create({ createdAt: new Date() });
    Object.assign(device, dto, {
      userId: u.sub,
      connectionStatus: 'Connected',
      lastConnectedAt: new Date(),
      lastCommunicationAt: new Date(),
      isActive: true,
      updatedAt: device.id ? new Date() : null,
    });
    try {
      return this.view(await this.devices.save(device));
    } catch {
      throw new ConflictException({ message: 'Device could not be registered.' });
    }
  }
  @Put(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDeviceDto) { return this.updateStatus(u, id, dto); }
  @Put(':id/status') async updateStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDeviceDto) { const d = await this.owned(Number(id), u.sub); Object.assign(d, dto, { lastCommunicationAt: new Date(), updatedAt: new Date() }); await this.devices.save(d); return { message: 'Status updated.' }; }
  @Delete(':id') async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { const d = await this.owned(Number(id), u.sub); Object.assign(d, { isActive: false, connectionStatus: 'Disconnected', updatedAt: new Date() }); await this.devices.save(d); }
}
