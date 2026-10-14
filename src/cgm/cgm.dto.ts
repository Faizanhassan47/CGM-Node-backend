import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
export class RegisterDeviceDto { @IsString() deviceName!: string; @IsString() deviceType!: string; @IsString() deviceModel!: string; @IsOptional() @IsString() serialNumber?: string; @IsOptional() @IsString() bleDeviceName?: string; @IsOptional() @IsString() firmwareVersion?: string; @IsOptional() @IsInt() batteryVoltageMv?: number; }
export class UpdateDeviceDto { @IsString() connectionStatus!: string; @IsOptional() @IsInt() batteryVoltageMv?: number; @IsOptional() @IsNumber() batteryPercentage?: number; }
export class StartSensorDto { @IsInt() deviceId!: number; @IsString() sensorIdentifier!: string; @IsOptional() @IsInt() @Min(0) @Max(240) warmupMinutes = 120; }
export class MeasurementDto { @IsInt() sensorId!: number; @IsNumber() @Min(20) @Max(600) glucoseValue!: number; @IsDateString() measurementTime!: string; @IsOptional() @IsInt() batteryVoltageMv?: number; @IsOptional() @IsNumber() deviceTemperatureC?: number; @IsOptional() @IsNumber() we1CurrentNa?: number; @IsOptional() @IsInt() @Min(0) @Max(65535) sequenceNumber?: number; }
export class BulkSyncDto { @IsInt() sensorId!: number; @ValidateNested({ each: true }) @Type(() => MeasurementDto) measurements!: MeasurementDto[]; }
