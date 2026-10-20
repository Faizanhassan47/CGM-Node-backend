import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('Users')
export class User {
  @PrimaryGeneratedColumn({ name: 'Id' }) id!: number;
  @Column({ name: 'FullName', length: 150 }) fullName!: string;
  @Column({ name: 'Email', length: 255, unique: true }) email!: string;
  @Column({ name: 'PasswordHash', type: 'text', nullable: true }) passwordHash!: string | null;
  @Column({ name: 'AuthProvider', length: 30, default: 'Email' }) authProvider!: string;
  @Column({ name: 'GoogleSubjectId', type: 'varchar', length: 255, nullable: true }) googleSubjectId!: string | null;
  @Column({ name: 'AppleSubjectId', type: 'varchar', length: 255, nullable: true }) appleSubjectId!: string | null;
  @Column({ name: 'LastLoginDeviceId', type: 'varchar', length: 255, nullable: true }) lastLoginDeviceId!: string | null;
  @Column({ name: 'LastLoginDeviceInfo', type: 'text', nullable: true }) lastLoginDeviceInfo!: string | null;
  @Column({ name: 'EmailVerified', default: false }) emailVerified!: boolean;
  @Column({ name: 'IsActive', default: true }) isActive!: boolean;
  @Column({ name: 'ProfilePictureUrl', type: 'varchar', length: 500, nullable: true }) profilePictureUrl!: string | null;
  @Column({ name: 'ReferralCode', type: 'varchar', length: 64, nullable: true }) referralCode!: string | null;
  @Column({ name: 'LastLoginAt', type: 'datetime', nullable: true }) lastLoginAt!: Date | null;
  @Column({ name: 'CreatedAt', type: 'datetime' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'datetime', nullable: true }) updatedAt!: Date | null;
  @Column({ name: 'TokenVersion', default: 0 }) tokenVersion!: number;
}

@Entity('PatientProfile')
export class PatientProfile {
  @PrimaryGeneratedColumn({ name: 'Id' }) id!: number;
  @Column({ name: 'UserId', unique: true }) userId!: number;
  @Column({ name: 'PhoneNumber', type: 'varchar', length: 50, nullable: true }) phoneNumber!: string | null;
  @Column({ name: 'DateOfBirth', type: 'date', nullable: true }) dateOfBirth!: string | null;
  @Column({ name: 'Gender', type: 'varchar', length: 30, nullable: true }) gender!: string | null;
  @Column({ name: 'ProfilePictureUrl', type: 'varchar', length: 500, nullable: true }) profilePictureUrl!: string | null;
  @Column({ name: 'PreferredGlucoseUnit', default: 'mg/dL' }) preferredGlucoseUnit!: string;
  @Column({ name: 'Language', default: 'English' }) language!: string;
  @Column({ name: 'Theme', default: 'System' }) theme!: string;
  @Column({ name: 'ProfileCompleted', default: false }) profileCompleted!: boolean;
  @Column({ name: 'TargetLow', type: 'decimal', precision: 5, scale: 1, default: 90.0 }) targetLow!: number;
  @Column({ name: 'TargetHigh', type: 'decimal', precision: 5, scale: 1, default: 130.0 }) targetHigh!: number;
  @Column({ name: 'UrgentLowThreshold', type: 'decimal', precision: 5, scale: 1, default: 55.0 }) urgentLowThreshold!: number;
  @Column({ name: 'UrgentHighThreshold', type: 'decimal', precision: 5, scale: 1, default: 250.0 }) urgentHighThreshold!: number;
  @Column({ name: 'BedTime', type: 'varchar', length: 10, default: '22:00' }) bedTime!: string;
  @Column({ name: 'WakeTime', type: 'varchar', length: 10, default: '07:00' }) wakeTime!: string;
  @Column({ name: 'NightLowThreshold', type: 'decimal', precision: 5, scale: 1, default: 70.0 }) nightLowThreshold!: number;
  @Column({ name: 'NightHighThreshold', type: 'decimal', precision: 5, scale: 1, default: 160.0 }) nightHighThreshold!: number;
  @Column({ name: 'NightAlertsEnabled', default: true }) nightAlertsEnabled!: boolean;
  @Column({ name: 'CreatedAt', type: 'datetime' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'datetime', nullable: true }) updatedAt!: Date | null;
}

@Entity('CGMDevices')
export class CgmDevice {
  @PrimaryGeneratedColumn({ name: 'Id' }) id!: number;
  @Column({ name: 'UserId' }) userId!: number;
  @Column({ name: 'DeviceName', type: 'varchar', length: 255, nullable: true }) deviceName!: string | null;
  @Column({ name: 'DeviceType', type: 'varchar', length: 50, nullable: true }) deviceType!: string | null;
  @Column({ name: 'DeviceModel', type: 'varchar', length: 100, nullable: true }) deviceModel!: string | null;
  @Column({ name: 'SerialNumber', type: 'varchar', length: 255, nullable: true, unique: true }) serialNumber!: string | null;
  @Column({ name: 'BleDeviceName', type: 'varchar', length: 255, nullable: true }) bleDeviceName!: string | null;
  @Column({ name: 'FirmwareVersion', type: 'varchar', length: 100, nullable: true }) firmwareVersion!: string | null;
  @Column({ name: 'BatteryVoltageMv', type: 'int', nullable: true }) batteryVoltageMv!: number | null;
  @Column({ name: 'BatteryPercentage', type: 'decimal', precision: 5, scale: 2, nullable: true }) batteryPercentage!: string | null;
  @Column({ name: 'ConnectionStatus', default: 'Disconnected' }) connectionStatus!: string;
  @Column({ name: 'LastConnectedAt', type: 'datetime', nullable: true }) lastConnectedAt!: Date | null;
  @Column({ name: 'LastCommunicationAt', type: 'datetime', nullable: true }) lastCommunicationAt!: Date | null;
  @Column({ name: 'IsActive', default: true }) isActive!: boolean;
  @Column({ name: 'CreatedAt', type: 'datetime' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'datetime', nullable: true }) updatedAt!: Date | null;
}

@Entity('Sensors')
export class Sensor {
  @PrimaryGeneratedColumn({ name: 'Id' }) id!: number;
  @Column({ name: 'UserId' }) userId!: number;
  @Column({ name: 'DeviceId' }) deviceId!: number;
  @Column({ name: 'SensorIdentifier', type: 'varchar', length: 255, nullable: true }) sensorIdentifier!: string | null;
  @Column({ name: 'Status', default: 'Inactive' }) status!: string;
  @Column({ name: 'StartedAt', type: 'datetime', nullable: true }) startedAt!: Date | null;
  @Column({ name: 'ActivatedAt', type: 'datetime', nullable: true }) activatedAt!: Date | null;
  @Column({ name: 'ExpiresAt', type: 'datetime', nullable: true }) expiresAt!: Date | null;
  @Column({ name: 'EndedAt', type: 'datetime', precision: 3, nullable: true }) endedAt!: Date | null;
  @Column({ name: 'LastReadingAt', type: 'datetime', nullable: true }) lastReadingAt!: Date | null;
  @Column({ name: 'IsActive', default: true }) isActive!: boolean;
}

@Entity('GlucoseMeasurements')
export class GlucoseMeasurement {
  @PrimaryColumn({ name: 'SensorId' }) sensorId!: number;
  @PrimaryColumn({ name: 'MeasurementTime', type: 'datetime', precision: 3 }) measurementTime!: Date;
  @Column({ name: 'UserId' }) userId!: number;
  @Column({ name: 'DeviceId', type: 'int', nullable: true }) deviceId!: number | null;
  @Column({ name: 'SequenceNumber', type: 'int', unsigned: true, nullable: true }) sequenceNumber!: number | null;
  @Column({ name: 'GlucoseValue', type: 'decimal', precision: 10, scale: 2, nullable: true }) glucoseValue!: string | null;
  @Column({ name: 'BatteryVoltageMv', type: 'int', nullable: true }) batteryVoltageMv!: number | null;
  @Column({ name: 'DeviceTemperatureC', type: 'decimal', precision: 10, scale: 2, nullable: true }) deviceTemperatureC!: string | null;
  @Column({ name: 'WE1CurrentNa', type: 'decimal', precision: 12, scale: 4, nullable: true }) we1CurrentNa!: string | null;
  @Column({ name: 'IsSynced', default: false }) isSynced!: boolean;
  @Column({ name: 'CreatedAt', type: 'datetime' }) createdAt!: Date;
}

export const CORE_ENTITIES = [User, PatientProfile, CgmDevice, Sensor, GlucoseMeasurement];
