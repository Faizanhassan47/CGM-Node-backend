import { DataSource } from 'typeorm';

export async function ensureTablesExist(dataSource: DataSource): Promise<void> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();

  const isMssql = dataSource.options.type === 'mssql';

  const mssqlDDL = [
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
     CREATE TABLE Users (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       FullName NVARCHAR(150) NOT NULL,
       Email NVARCHAR(255) NOT NULL UNIQUE,
       PasswordHash NVARCHAR(MAX) NULL,
       AuthProvider NVARCHAR(30) NOT NULL DEFAULT 'Email',
       GoogleSubjectId NVARCHAR(255) NULL,
       AppleSubjectId NVARCHAR(255) NULL,
       LastLoginDeviceId NVARCHAR(255) NULL,
       LastLoginDeviceInfo NVARCHAR(MAX) NULL,
       EmailVerified BIT NOT NULL DEFAULT 0,
       IsActive BIT NOT NULL DEFAULT 1,
       ProfilePictureUrl NVARCHAR(500) NULL,
       ReferralCode NVARCHAR(64) NULL,
       LastLoginAt DATETIME NULL,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
       UpdatedAt DATETIME NULL,
       TokenVersion INT NOT NULL DEFAULT 0
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PatientProfile')
     CREATE TABLE PatientProfile (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL UNIQUE,
       PhoneNumber NVARCHAR(50) NULL,
       DateOfBirth DATE NULL,
       Gender NVARCHAR(30) NULL,
       ProfilePictureUrl NVARCHAR(500) NULL,
       PreferredGlucoseUnit NVARCHAR(20) NOT NULL DEFAULT 'mg/dL',
       Language NVARCHAR(50) NOT NULL DEFAULT 'English',
       Theme NVARCHAR(50) NOT NULL DEFAULT 'System',
       ProfileCompleted BIT NOT NULL DEFAULT 0,
       TargetLow DECIMAL(5,1) NOT NULL DEFAULT 90.0,
       TargetHigh DECIMAL(5,1) NOT NULL DEFAULT 130.0,
       UrgentLowThreshold DECIMAL(5,1) NOT NULL DEFAULT 55.0,
       UrgentHighThreshold DECIMAL(5,1) NOT NULL DEFAULT 250.0,
       BedTime NVARCHAR(10) NOT NULL DEFAULT '22:00',
       WakeTime NVARCHAR(10) NOT NULL DEFAULT '07:00',
       NightLowThreshold DECIMAL(5,1) NOT NULL DEFAULT 70.0,
       NightHighThreshold DECIMAL(5,1) NOT NULL DEFAULT 160.0,
       NightAlertsEnabled BIT NOT NULL DEFAULT 1,
       PushNotificationsEnabled BIT NOT NULL DEFAULT 1,
       CriticalGlucoseAlertsEnabled BIT NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
       UpdatedAt DATETIME NULL
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CGMDevices')
     CREATE TABLE CGMDevices (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       DeviceName NVARCHAR(255) NULL,
       DeviceType NVARCHAR(50) NULL,
       DeviceModel NVARCHAR(100) NULL,
       SerialNumber NVARCHAR(255) NULL UNIQUE,
       BleDeviceName NVARCHAR(255) NULL,
       FirmwareVersion NVARCHAR(100) NULL,
       BatteryVoltageMv INT NULL,
       BatteryPercentage DECIMAL(5,2) NULL,
       ConnectionStatus NVARCHAR(50) NOT NULL DEFAULT 'Disconnected',
       LastConnectedAt DATETIME NULL,
       LastCommunicationAt DATETIME NULL,
       IsActive BIT NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
       UpdatedAt DATETIME NULL
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Sensors')
     CREATE TABLE Sensors (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       DeviceId INT NOT NULL,
       SensorIdentifier NVARCHAR(255) NULL,
       Status NVARCHAR(50) NOT NULL DEFAULT 'Inactive',
       StartedAt DATETIME NULL,
       ActivatedAt DATETIME NULL,
       ExpiresAt DATETIME NULL,
       EndedAt DATETIME2(3) NULL,
       LastReadingAt DATETIME NULL,
       IsActive BIT NOT NULL DEFAULT 1
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GlucoseMeasurements')
     CREATE TABLE GlucoseMeasurements (
       SensorId INT NOT NULL,
       MeasurementTime DATETIME2(3) NOT NULL,
       UserId INT NOT NULL,
       DeviceId INT NULL,
       SequenceNumber INT NULL,
       GlucoseValue DECIMAL(10,2) NULL,
       BatteryVoltageMv INT NULL,
       DeviceTemperatureC DECIMAL(10,2) NULL,
       WE1CurrentNa DECIMAL(12,4) NULL,
       IsSynced BIT NOT NULL DEFAULT 0,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
       PRIMARY KEY (SensorId, MeasurementTime)
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Alerts')
     CREATE TABLE Alerts (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       SensorId INT NULL,
       AlertType NVARCHAR(100) NOT NULL,
       Title NVARCHAR(255) NOT NULL,
       Message NVARCHAR(MAX) NOT NULL,
       GlucoseValue DECIMAL(10,2) NULL,
       GlucoseUnit NVARCHAR(20) NULL,
       Severity NVARCHAR(50) NOT NULL,
       IsRead BIT DEFAULT 0,
       AlertTime DATETIME NOT NULL,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AlertRecipients')
     CREATE TABLE AlertRecipients (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       AlertId INT NOT NULL,
       UserId INT NOT NULL,
       IsRead BIT DEFAULT 0,
       ReadAt DATETIME NULL,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AlertQueue')
     CREATE TABLE AlertQueue (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       AlertId INT NOT NULL,
       Status NVARCHAR(50) NOT NULL DEFAULT 'Pending',
       ProcessingStartedAt DATETIME NULL,
       LeaseExpiresAt DATETIME NULL,
       LeaseOwner NVARCHAR(100) NULL,
       RetryCount INT NOT NULL DEFAULT 0,
       NextAttemptAt DATETIME NULL,
       ProcessedAt DATETIME NULL,
       ErrorMessage NVARCHAR(MAX) NULL,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AlertRules')
     CREATE TABLE AlertRules (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       AlertType NVARCHAR(100) NOT NULL,
       MinimumValue DECIMAL(10,2) NULL,
       MaximumValue DECIMAL(10,2) NULL,
       DurationMinutes INT NOT NULL DEFAULT 15,
       Enabled BIT NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NotificationEndpoints')
     CREATE TABLE NotificationEndpoints (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       Channel NVARCHAR(50) NOT NULL,
       Address NVARCHAR(255) NOT NULL,
       Enabled BIT NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
       UpdatedAt DATETIME NULL
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AlertDeliveryHistory')
     CREATE TABLE AlertDeliveryHistory (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       AlertId INT NOT NULL,
       Channel NVARCHAR(50) NOT NULL,
       Destination NVARCHAR(255) NOT NULL,
       SentAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
       DeliveredAt DATETIME NULL,
       Status NVARCHAR(50) NOT NULL,
       FailureReason NVARCHAR(MAX) NULL
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Families')
     CREATE TABLE Families (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       OwnerUserId INT NOT NULL,
       IsActive BIT NOT NULL DEFAULT 1,
       LowGlucoseThreshold DECIMAL(10,2) NULL,
       HighGlucoseThreshold DECIMAL(10,2) NULL,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FamilyMembers')
     CREATE TABLE FamilyMembers (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       FamilyId INT NOT NULL,
       UserId INT NOT NULL,
       Role NVARCHAR(50) NOT NULL DEFAULT 'Member',
       ReceiveAlerts BIT NOT NULL DEFAULT 1,
       Status NVARCHAR(50) NOT NULL DEFAULT 'Active',
       JoinedByReferralCode NVARCHAR(64) NULL,
       JoinedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyGlucoseSummaries')
     CREATE TABLE DailyGlucoseSummaries (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       SummaryDate NVARCHAR(20) NOT NULL,
       ReadingCount INT NOT NULL,
       MeanGlucose DECIMAL(10,2) NOT NULL,
       MedianGlucose DECIMAL(10,2) NOT NULL,
       StandardDeviation DECIMAL(10,2) NOT NULL,
       Gmi DECIMAL(10,4) NOT NULL,
       CvPercentage DECIMAL(10,2) NOT NULL,
       TimeInRangeMinutes INT NOT NULL,
       TimeBelowRangeMinutes INT NOT NULL,
       TimeAboveRangeMinutes INT NOT NULL,
       TimeInRangePercentage DECIMAL(10,2) NOT NULL,
       TimeBelowRangePercentage DECIMAL(10,2) NOT NULL,
       TimeAboveRangePercentage DECIMAL(10,2) NOT NULL,
       LowestGlucose DECIMAL(10,2) NOT NULL,
       HighestGlucose DECIMAL(10,2) NOT NULL,
       HighEventsCount INT NOT NULL,
       LowEventsCount INT NOT NULL,
       GeneratedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailySummaryJobs')
     CREATE TABLE DailySummaryJobs (
       Id BIGINT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       SummaryDate DATE NOT NULL,
       Status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
       RetryCount INT NOT NULL DEFAULT 0,
       NextAttemptAt DATETIME NULL,
       LeaseOwner NVARCHAR(100) NULL,
       LeaseExpiresAt DATETIME NULL,
       RequestedVersion BIGINT NOT NULL DEFAULT 1,
       ProcessedVersion BIGINT NOT NULL DEFAULT 0,
       LastError NVARCHAR(MAX) NULL,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
       UpdatedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_DailySummaryJobs_UserDate UNIQUE (UserId, SummaryDate)
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PasswordResetRequests')
     CREATE TABLE PasswordResetRequests (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       Email NVARCHAR(255) NOT NULL,
       Token NVARCHAR(255) NOT NULL,
       OtpCode NVARCHAR(20) NOT NULL,
       ExpiresAt DATETIME NOT NULL,
       IsUsed BIT NOT NULL DEFAULT 0,
       UsedAt DATETIME NULL,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AppVersions')
     CREATE TABLE AppVersions (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       Platform NVARCHAR(50) NOT NULL,
       VersionName NVARCHAR(50) NOT NULL,
       VersionCode INT NOT NULL,
       MinimumSupportedVersion NVARCHAR(50) NULL,
       DownloadUrl NVARCHAR(1000) NULL,
       IsForceUpdate BIT NOT NULL DEFAULT 0,
       ReleaseNotes NVARCHAR(MAX) NULL,
       ReleaseDate DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Articles')
     CREATE TABLE Articles (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       Title NVARCHAR(255) NOT NULL,
       Category NVARCHAR(100) NULL,
       Content NVARCHAR(MAX) NOT NULL,
       IsPublished BIT NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DictFoods')
     CREATE TABLE DictFoods (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       Name NVARCHAR(255) NOT NULL,
       CarbsPer100g DECIMAL(10,2) NULL
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DictInsulins')
     CREATE TABLE DictInsulins (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       Name NVARCHAR(255) NOT NULL,
       Type NVARCHAR(100) NULL
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DictMoods')
     CREATE TABLE DictMoods (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       Name NVARCHAR(255) NOT NULL
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PhoneHardwareLogs')
     CREATE TABLE PhoneHardwareLogs (
       Id INT IDENTITY(1,1) PRIMARY KEY,
       UserId INT NOT NULL,
       DeviceModel NVARCHAR(255) NULL,
       OsVersion NVARCHAR(100) NULL,
       BluetoothMacAddress NVARCHAR(100) NULL,
       LoggedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'TargetLow')
     ALTER TABLE PatientProfile ADD TargetLow DECIMAL(5,1) NOT NULL DEFAULT 90.0;`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'TargetHigh')
     ALTER TABLE PatientProfile ADD TargetHigh DECIMAL(5,1) NOT NULL DEFAULT 130.0;`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'UrgentLowThreshold')
     ALTER TABLE PatientProfile ADD UrgentLowThreshold DECIMAL(5,1) NOT NULL DEFAULT 55.0;`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'UrgentHighThreshold')
     ALTER TABLE PatientProfile ADD UrgentHighThreshold DECIMAL(5,1) NOT NULL DEFAULT 250.0;`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'BedTime')
     ALTER TABLE PatientProfile ADD BedTime NVARCHAR(10) NOT NULL DEFAULT '22:00';`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'WakeTime')
     ALTER TABLE PatientProfile ADD WakeTime NVARCHAR(10) NOT NULL DEFAULT '07:00';`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'NightLowThreshold')
     ALTER TABLE PatientProfile ADD NightLowThreshold DECIMAL(5,1) NOT NULL DEFAULT 70.0;`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'NightHighThreshold')
     ALTER TABLE PatientProfile ADD NightHighThreshold DECIMAL(5,1) NOT NULL DEFAULT 160.0;`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'NightAlertsEnabled')
     ALTER TABLE PatientProfile ADD NightAlertsEnabled BIT NOT NULL DEFAULT 1;`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'PushNotificationsEnabled')
     ALTER TABLE PatientProfile ADD PushNotificationsEnabled BIT NOT NULL DEFAULT 1;`,

    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PatientProfile') AND name = 'CriticalGlucoseAlertsEnabled')
     ALTER TABLE PatientProfile ADD CriticalGlucoseAlertsEnabled BIT NOT NULL DEFAULT 1;`
  ];

  const mysqlDDL = [
    `CREATE TABLE IF NOT EXISTS Users (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       FullName VARCHAR(150) NOT NULL,
       Email VARCHAR(255) NOT NULL UNIQUE,
       PasswordHash TEXT NULL,
       AuthProvider VARCHAR(30) NOT NULL DEFAULT 'Email',
       GoogleSubjectId VARCHAR(255) NULL,
       AppleSubjectId VARCHAR(255) NULL,
       LastLoginDeviceId VARCHAR(255) NULL,
       LastLoginDeviceInfo TEXT NULL,
       EmailVerified TINYINT(1) NOT NULL DEFAULT 0,
       IsActive TINYINT(1) NOT NULL DEFAULT 1,
       ProfilePictureUrl VARCHAR(500) NULL,
       ReferralCode VARCHAR(64) NULL,
       LastLoginAt DATETIME NULL,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UpdatedAt DATETIME NULL,
       TokenVersion INT NOT NULL DEFAULT 0
     );`,

    `CREATE TABLE IF NOT EXISTS PatientProfile (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL UNIQUE,
       PhoneNumber VARCHAR(50) NULL,
       DateOfBirth DATE NULL,
       Gender VARCHAR(30) NULL,
       ProfilePictureUrl VARCHAR(500) NULL,
       PreferredGlucoseUnit VARCHAR(20) NOT NULL DEFAULT 'mg/dL',
       Language VARCHAR(50) NOT NULL DEFAULT 'English',
       Theme VARCHAR(50) NOT NULL DEFAULT 'System',
       ProfileCompleted TINYINT(1) NOT NULL DEFAULT 0,
       TargetLow DECIMAL(5,1) NOT NULL DEFAULT 90.0,
       TargetHigh DECIMAL(5,1) NOT NULL DEFAULT 130.0,
       UrgentLowThreshold DECIMAL(5,1) NOT NULL DEFAULT 55.0,
       UrgentHighThreshold DECIMAL(5,1) NOT NULL DEFAULT 250.0,
       BedTime VARCHAR(10) NOT NULL DEFAULT '22:00',
       WakeTime VARCHAR(10) NOT NULL DEFAULT '07:00',
       NightLowThreshold DECIMAL(5,1) NOT NULL DEFAULT 70.0,
       NightHighThreshold DECIMAL(5,1) NOT NULL DEFAULT 160.0,
       NightAlertsEnabled TINYINT(1) NOT NULL DEFAULT 1,
       PushNotificationsEnabled TINYINT(1) NOT NULL DEFAULT 1,
       CriticalGlucoseAlertsEnabled TINYINT(1) NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UpdatedAt DATETIME NULL
     );`,

    `CREATE TABLE IF NOT EXISTS CGMDevices (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       DeviceName VARCHAR(255) NULL,
       DeviceType VARCHAR(50) NULL,
       DeviceModel VARCHAR(100) NULL,
       SerialNumber VARCHAR(255) NULL UNIQUE,
       BleDeviceName VARCHAR(255) NULL,
       FirmwareVersion VARCHAR(100) NULL,
       BatteryVoltageMv INT NULL,
       BatteryPercentage DECIMAL(5,2) NULL,
       ConnectionStatus VARCHAR(50) NOT NULL DEFAULT 'Disconnected',
       LastConnectedAt DATETIME NULL,
       LastCommunicationAt DATETIME NULL,
       IsActive TINYINT(1) NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UpdatedAt DATETIME NULL
     );`,

    `CREATE TABLE IF NOT EXISTS Sensors (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       DeviceId INT NOT NULL,
       SensorIdentifier VARCHAR(255) NULL,
       Status VARCHAR(50) NOT NULL DEFAULT 'Inactive',
       StartedAt DATETIME NULL,
       ActivatedAt DATETIME NULL,
       ExpiresAt DATETIME NULL,
       EndedAt DATETIME(3) NULL,
       LastReadingAt DATETIME NULL,
       IsActive TINYINT(1) NOT NULL DEFAULT 1
     );`,

    `CREATE TABLE IF NOT EXISTS GlucoseMeasurements (
       SensorId INT NOT NULL,
       MeasurementTime DATETIME(3) NOT NULL,
       UserId INT NOT NULL,
       DeviceId INT NULL,
       SequenceNumber INT UNSIGNED NULL,
       GlucoseValue DECIMAL(10,2) NULL,
       BatteryVoltageMv INT NULL,
       DeviceTemperatureC DECIMAL(10,2) NULL,
       WE1CurrentNa DECIMAL(12,4) NULL,
       IsSynced TINYINT(1) NOT NULL DEFAULT 0,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (SensorId, MeasurementTime)
     );`,

    `CREATE TABLE IF NOT EXISTS Alerts (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       SensorId INT NULL,
       AlertType VARCHAR(100) NOT NULL,
       Title VARCHAR(255) NOT NULL,
       Message TEXT NOT NULL,
       GlucoseValue DECIMAL(10,2) NULL,
       GlucoseUnit VARCHAR(20) NULL,
       Severity VARCHAR(50) NOT NULL,
       IsRead TINYINT(1) DEFAULT 0,
       AlertTime DATETIME NOT NULL,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,

    `CREATE TABLE IF NOT EXISTS AlertRecipients (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       AlertId INT NOT NULL,
       UserId INT NOT NULL,
       IsRead TINYINT(1) DEFAULT 0,
       ReadAt DATETIME NULL,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_alert_user (AlertId, UserId)
     );`,

    `CREATE TABLE IF NOT EXISTS AlertQueue (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       AlertId INT NOT NULL,
       Status VARCHAR(50) NOT NULL DEFAULT 'Pending',
       ProcessingStartedAt DATETIME NULL,
       LeaseExpiresAt DATETIME NULL,
       LeaseOwner VARCHAR(100) NULL,
       RetryCount INT NOT NULL DEFAULT 0,
       NextAttemptAt DATETIME NULL,
       ProcessedAt DATETIME NULL,
       ErrorMessage TEXT NULL,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,

    `CREATE TABLE IF NOT EXISTS AlertRules (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       AlertType VARCHAR(100) NOT NULL,
       MinimumValue DECIMAL(10,2) NULL,
       MaximumValue DECIMAL(10,2) NULL,
       DurationMinutes INT NOT NULL DEFAULT 15,
       Enabled TINYINT(1) NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,

    `CREATE TABLE IF NOT EXISTS NotificationEndpoints (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       Channel VARCHAR(50) NOT NULL,
       Address VARCHAR(255) NOT NULL,
       Enabled TINYINT(1) NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UpdatedAt DATETIME NULL
     );`,

    `CREATE TABLE IF NOT EXISTS AlertDeliveryHistory (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       AlertId INT NOT NULL,
       Channel VARCHAR(50) NOT NULL,
       Destination VARCHAR(255) NOT NULL,
       SentAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       DeliveredAt DATETIME NULL,
       Status VARCHAR(50) NOT NULL,
       FailureReason TEXT NULL
     );`,

    `CREATE TABLE IF NOT EXISTS Families (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       OwnerUserId INT NOT NULL,
       IsActive TINYINT(1) NOT NULL DEFAULT 1,
       LowGlucoseThreshold DECIMAL(10,2) NULL,
       HighGlucoseThreshold DECIMAL(10,2) NULL,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,

    `CREATE TABLE IF NOT EXISTS FamilyMembers (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       FamilyId INT NOT NULL,
       UserId INT NOT NULL,
       Role VARCHAR(50) NOT NULL DEFAULT 'Member',
       ReceiveAlerts TINYINT(1) NOT NULL DEFAULT 1,
       Status VARCHAR(50) NOT NULL DEFAULT 'Active',
       JoinedByReferralCode VARCHAR(64) NULL,
       JoinedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,

    `CREATE TABLE IF NOT EXISTS DailyGlucoseSummaries (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       SummaryDate VARCHAR(20) NOT NULL,
       ReadingCount INT NOT NULL,
       MeanGlucose DECIMAL(10,2) NOT NULL,
       MedianGlucose DECIMAL(10,2) NOT NULL,
       StandardDeviation DECIMAL(10,2) NOT NULL,
       Gmi DECIMAL(10,4) NOT NULL,
       CvPercentage DECIMAL(10,2) NOT NULL,
       TimeInRangeMinutes INT NOT NULL,
       TimeBelowRangeMinutes INT NOT NULL,
       TimeAboveRangeMinutes INT NOT NULL,
       TimeInRangePercentage DECIMAL(10,2) NOT NULL,
       TimeBelowRangePercentage DECIMAL(10,2) NOT NULL,
       TimeAboveRangePercentage DECIMAL(10,2) NOT NULL,
       LowestGlucose DECIMAL(10,2) NOT NULL,
       HighestGlucose DECIMAL(10,2) NOT NULL,
       HighEventsCount INT NOT NULL,
       LowEventsCount INT NOT NULL,
       GeneratedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_user_date (UserId, SummaryDate)
     );`,

    `CREATE TABLE IF NOT EXISTS DailySummaryJobs (
       Id BIGINT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       SummaryDate DATE NOT NULL,
       Status VARCHAR(20) NOT NULL DEFAULT 'Pending',
       RetryCount INT NOT NULL DEFAULT 0,
       NextAttemptAt DATETIME(6) NULL,
       LeaseOwner VARCHAR(100) NULL,
       LeaseExpiresAt DATETIME(6) NULL,
       RequestedVersion BIGINT UNSIGNED NOT NULL DEFAULT 1,
       ProcessedVersion BIGINT UNSIGNED NOT NULL DEFAULT 0,
       LastError TEXT NULL,
       CreatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
       UpdatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
       UNIQUE KEY uq_daily_summary_jobs_user_date (UserId, SummaryDate),
       KEY idx_daily_summary_jobs_poll (Status, NextAttemptAt, LeaseExpiresAt)
     );`,

    `CREATE TABLE IF NOT EXISTS PasswordResetRequests (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       Email VARCHAR(255) NOT NULL,
       Token VARCHAR(255) NOT NULL,
       OtpCode VARCHAR(20) NOT NULL,
       ExpiresAt DATETIME NOT NULL,
       IsUsed TINYINT(1) NOT NULL DEFAULT 0,
       UsedAt DATETIME NULL,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,

    `CREATE TABLE IF NOT EXISTS AppVersions (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       Platform VARCHAR(50) NOT NULL,
       VersionName VARCHAR(50) NOT NULL,
       VersionCode INT NOT NULL,
       MinimumSupportedVersion VARCHAR(50) NULL,
       DownloadUrl VARCHAR(1000) NULL,
       IsForceUpdate TINYINT(1) NOT NULL DEFAULT 0,
       ReleaseNotes TEXT NULL,
       ReleaseDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,

    `CREATE TABLE IF NOT EXISTS Articles (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       Title VARCHAR(255) NOT NULL,
       Category VARCHAR(100) NULL,
       Content TEXT NOT NULL,
       IsPublished TINYINT(1) NOT NULL DEFAULT 1,
       CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,

    `CREATE TABLE IF NOT EXISTS DictFoods (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       Name VARCHAR(255) NOT NULL,
       CarbsPer100g DECIMAL(10,2) NULL
     );`,

    `CREATE TABLE IF NOT EXISTS DictInsulins (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       Name VARCHAR(255) NOT NULL,
       Type VARCHAR(100) NULL
     );`,

    `CREATE TABLE IF NOT EXISTS DictMoods (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       Name VARCHAR(255) NOT NULL
     );`,

    `CREATE TABLE IF NOT EXISTS PhoneHardwareLogs (
       Id INT AUTO_INCREMENT PRIMARY KEY,
       UserId INT NOT NULL,
       DeviceModel VARCHAR(255) NULL,
       OsVersion VARCHAR(100) NULL,
       BluetoothMacAddress VARCHAR(100) NULL,
       LoggedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`
  ];

  const statements = isMssql ? mssqlDDL : mysqlDDL;
  for (const sql of statements) {
    try {
      await runner.query(sql);
    } catch (e) {
      console.error('Failed to run migration statement:', sql, e);
    }
  }

  const requiredColumns = [
    { table: 'Users', column: 'ProfilePictureUrl', definition: isMssql ? 'NVARCHAR(500) NULL' : 'VARCHAR(500) NULL' },
    { table: 'PatientProfile', column: 'ProfilePictureUrl', definition: isMssql ? 'NVARCHAR(500) NULL' : 'VARCHAR(500) NULL' },
    { table: 'PatientProfile', column: 'PushNotificationsEnabled', definition: isMssql ? 'BIT NOT NULL DEFAULT 1' : 'TINYINT(1) NOT NULL DEFAULT 1' },
    { table: 'PatientProfile', column: 'CriticalGlucoseAlertsEnabled', definition: isMssql ? 'BIT NOT NULL DEFAULT 1' : 'TINYINT(1) NOT NULL DEFAULT 1' },
  ];

  for (const { table, column, definition } of requiredColumns) {
    const result = await runner.query(
      isMssql
        ? `SELECT COUNT(1) AS columnCount FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`
        : `SELECT COUNT(1) AS columnCount FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`,
    );
    const columnCount = Number(result[0]?.columnCount ?? result[0]?.COLUMNCOUNT ?? 0);

    if (columnCount === 0) {
      await runner.query(`ALTER TABLE ${table} ADD ${column} ${definition}`);
    }
  }

  await runner.release();
}
