-- AIMA CGM - Complete MySQL schema for phpMyAdmin
-- MySQL 8.0+
--
-- Shared-hosting usage (Hostinger/phpMyAdmin):
--   1. Create the database in the hosting control panel if it does not exist.
--   2. Open phpMyAdmin and click that database in the left sidebar.
--   3. Confirm the database name is shown at the top of the page.
--   4. Open Import (recommended) or SQL, load this file, and run it once.
--
-- This file intentionally does not run CREATE DATABASE or USE. Shared-hosting
-- database users usually do not have permission to create arbitrary databases.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 01. Users
CREATE TABLE IF NOT EXISTS `Users` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `FullName` VARCHAR(150) NOT NULL,
  `Email` VARCHAR(255) NOT NULL,
  `PasswordHash` TEXT NULL,
  `AuthProvider` VARCHAR(30) NOT NULL DEFAULT 'Email',
  `GoogleSubjectId` VARCHAR(255) NULL,
  `AppleSubjectId` VARCHAR(255) NULL,
  `LastLoginDeviceId` VARCHAR(255) NULL,
  `LastLoginDeviceInfo` TEXT NULL,
  `EmailVerified` TINYINT(1) NOT NULL DEFAULT 0,
  `IsActive` TINYINT(1) NOT NULL DEFAULT 1,
  `ProfilePictureUrl` VARCHAR(500) NULL,
  `ReferralCode` VARCHAR(64) NULL,
  `LastLoginAt` DATETIME NULL,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UpdatedAt` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `TokenVersion` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `uq_users_email` (`Email`),
  UNIQUE KEY `uq_users_google_subject` (`GoogleSubjectId`),
  UNIQUE KEY `uq_users_apple_subject` (`AppleSubjectId`),
  UNIQUE KEY `uq_users_referral_code` (`ReferralCode`),
  KEY `idx_users_active` (`IsActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 02. Patient profile
CREATE TABLE IF NOT EXISTS `PatientProfile` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `UserId` INT UNSIGNED NOT NULL,
  `PhoneNumber` VARCHAR(50) NULL,
  `DateOfBirth` DATE NULL,
  `Gender` VARCHAR(30) NULL,
  `ProfilePictureUrl` VARCHAR(500) NULL,
  `PreferredGlucoseUnit` VARCHAR(20) NOT NULL DEFAULT 'mg/dL',
  `Language` VARCHAR(50) NOT NULL DEFAULT 'English',
  `Theme` VARCHAR(50) NOT NULL DEFAULT 'System',
  `ProfileCompleted` TINYINT(1) NOT NULL DEFAULT 0,
  `TargetLow` DECIMAL(5,1) NOT NULL DEFAULT 90.0,
  `TargetHigh` DECIMAL(5,1) NOT NULL DEFAULT 130.0,
  `UrgentLowThreshold` DECIMAL(5,1) NOT NULL DEFAULT 55.0,
  `UrgentHighThreshold` DECIMAL(5,1) NOT NULL DEFAULT 250.0,
  `BedTime` VARCHAR(10) NOT NULL DEFAULT '22:00',
  `WakeTime` VARCHAR(10) NOT NULL DEFAULT '07:00',
  `NightLowThreshold` DECIMAL(5,1) NOT NULL DEFAULT 70.0,
  `NightHighThreshold` DECIMAL(5,1) NOT NULL DEFAULT 160.0,
  `NightAlertsEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `PushNotificationsEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `CriticalGlucoseAlertsEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UpdatedAt` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `uq_patient_profile_user` (`UserId`),
  CONSTRAINT `fk_patient_profile_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 03. CGM devices
CREATE TABLE IF NOT EXISTS `CGMDevices` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `UserId` INT UNSIGNED NOT NULL,
  `DeviceName` VARCHAR(255) NULL,
  `DeviceType` VARCHAR(50) NULL,
  `DeviceModel` VARCHAR(100) NULL,
  `SerialNumber` VARCHAR(255) NULL,
  `BleDeviceName` VARCHAR(255) NULL,
  `FirmwareVersion` VARCHAR(100) NULL,
  `BatteryVoltageMv` INT NULL,
  `BatteryPercentage` DECIMAL(5,2) NULL,
  `ConnectionStatus` VARCHAR(50) NOT NULL DEFAULT 'Disconnected',
  `LastConnectedAt` DATETIME NULL,
  `LastCommunicationAt` DATETIME NULL,
  `IsActive` TINYINT(1) NOT NULL DEFAULT 1,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UpdatedAt` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `uq_cgm_devices_serial` (`SerialNumber`),
  KEY `idx_cgm_devices_user_active` (`UserId`, `IsActive`),
  CONSTRAINT `fk_cgm_devices_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 04. Sensors
CREATE TABLE IF NOT EXISTS `Sensors` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `UserId` INT UNSIGNED NOT NULL,
  `DeviceId` INT UNSIGNED NOT NULL,
  `SensorIdentifier` VARCHAR(255) NULL,
  `Status` VARCHAR(50) NOT NULL DEFAULT 'Inactive',
  `StartedAt` DATETIME NULL,
  `ActivatedAt` DATETIME NULL,
  `ExpiresAt` DATETIME NULL,
  `EndedAt` DATETIME NULL,
  `LastReadingAt` DATETIME NULL,
  `IsActive` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`Id`),
  KEY `idx_sensors_user_active` (`UserId`, `IsActive`),
  KEY `idx_sensors_device` (`DeviceId`),
  KEY `idx_sensors_identifier` (`SensorIdentifier`),
  CONSTRAINT `fk_sensors_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_sensors_device`
    FOREIGN KEY (`DeviceId`) REFERENCES `CGMDevices` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 05. Glucose measurements
CREATE TABLE IF NOT EXISTS `GlucoseMeasurements` (
  `SensorId` INT UNSIGNED NOT NULL,
  `MeasurementTime` DATETIME NOT NULL,
  `UserId` INT UNSIGNED NOT NULL,
  `DeviceId` INT UNSIGNED NULL,
  `SequenceNumber` INT UNSIGNED NULL,
  `GlucoseValue` DECIMAL(10,2) NULL,
  `BatteryVoltageMv` INT NULL,
  `DeviceTemperatureC` DECIMAL(10,2) NULL,
  `WE1CurrentNa` DECIMAL(12,4) NULL,
  `IsSynced` TINYINT(1) NOT NULL DEFAULT 0,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`SensorId`, `MeasurementTime`),
  KEY `idx_glucose_user_time` (`UserId`, `MeasurementTime`),
  KEY `idx_glucose_device_time` (`DeviceId`, `MeasurementTime`),
  KEY `idx_glucose_sensor_sequence` (`SensorId`, `SequenceNumber`),
  CONSTRAINT `fk_glucose_sensor`
    FOREIGN KEY (`SensorId`) REFERENCES `Sensors` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_glucose_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_glucose_device`
    FOREIGN KEY (`DeviceId`) REFERENCES `CGMDevices` (`Id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 06. Alerts
CREATE TABLE IF NOT EXISTS `Alerts` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `UserId` INT UNSIGNED NOT NULL,
  `SensorId` INT UNSIGNED NULL,
  `AlertType` VARCHAR(100) NOT NULL,
  `Title` VARCHAR(255) NOT NULL,
  `Message` TEXT NOT NULL,
  `GlucoseValue` DECIMAL(10,2) NULL,
  `GlucoseUnit` VARCHAR(20) NULL,
  `Severity` VARCHAR(50) NOT NULL,
  `IsRead` TINYINT(1) NOT NULL DEFAULT 0,
  `AlertTime` DATETIME NOT NULL,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  KEY `idx_alerts_user_time` (`UserId`, `AlertTime`),
  KEY `idx_alerts_sensor` (`SensorId`),
  CONSTRAINT `fk_alerts_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_alerts_sensor`
    FOREIGN KEY (`SensorId`) REFERENCES `Sensors` (`Id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 07. Alert recipients
CREATE TABLE IF NOT EXISTS `AlertRecipients` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `AlertId` INT UNSIGNED NOT NULL,
  `UserId` INT UNSIGNED NOT NULL,
  `IsRead` TINYINT(1) NOT NULL DEFAULT 0,
  `ReadAt` DATETIME NULL,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `uq_alert_recipient` (`AlertId`, `UserId`),
  KEY `idx_alert_recipients_user_read` (`UserId`, `IsRead`),
  CONSTRAINT `fk_alert_recipients_alert`
    FOREIGN KEY (`AlertId`) REFERENCES `Alerts` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_alert_recipients_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 08. Alert delivery queue
CREATE TABLE IF NOT EXISTS `AlertQueue` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `AlertId` INT UNSIGNED NOT NULL,
  `Status` VARCHAR(50) NOT NULL DEFAULT 'Pending',
  `ProcessingStartedAt` DATETIME NULL,
  `LeaseExpiresAt` DATETIME NULL,
  `LeaseOwner` VARCHAR(100) NULL,
  `RetryCount` INT NOT NULL DEFAULT 0,
  `NextAttemptAt` DATETIME NULL,
  `ProcessedAt` DATETIME NULL,
  `ErrorMessage` TEXT NULL,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  KEY `idx_alert_queue_work` (`Status`, `NextAttemptAt`, `CreatedAt`),
  KEY `idx_alert_queue_lease` (`Status`, `LeaseExpiresAt`),
  KEY `idx_alert_queue_alert` (`AlertId`),
  CONSTRAINT `fk_alert_queue_alert`
    FOREIGN KEY (`AlertId`) REFERENCES `Alerts` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 09. Alert rules
CREATE TABLE IF NOT EXISTS `DailySummaryJobs` (
  `Id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `UserId` INT UNSIGNED NOT NULL,
  `SummaryDate` DATE NOT NULL,
  `Status` VARCHAR(20) NOT NULL DEFAULT 'Pending',
  `RetryCount` INT NOT NULL DEFAULT 0,
  `NextAttemptAt` DATETIME(6) NULL,
  `LeaseOwner` VARCHAR(100) NULL,
  `LeaseExpiresAt` DATETIME(6) NULL,
  `RequestedVersion` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `ProcessedVersion` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `LastError` TEXT NULL,
  `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `UpdatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`Id`),
  UNIQUE KEY `uq_daily_summary_jobs_user_date` (`UserId`, `SummaryDate`),
  KEY `idx_daily_summary_jobs_poll` (`Status`, `NextAttemptAt`, `LeaseExpiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Alert rules
CREATE TABLE IF NOT EXISTS `AlertRules` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `UserId` INT UNSIGNED NOT NULL,
  `AlertType` VARCHAR(100) NOT NULL,
  `MinimumValue` DECIMAL(10,2) NULL,
  `MaximumValue` DECIMAL(10,2) NULL,
  `DurationMinutes` INT NOT NULL DEFAULT 15,
  `Enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  KEY `idx_alert_rules_user_enabled` (`UserId`, `Enabled`),
  CONSTRAINT `fk_alert_rules_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Notification endpoints
CREATE TABLE IF NOT EXISTS `NotificationEndpoints` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `UserId` INT UNSIGNED NOT NULL,
  `Channel` VARCHAR(50) NOT NULL,
  `Address` VARCHAR(255) NOT NULL,
  `Enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UpdatedAt` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `uq_notification_endpoint` (`UserId`, `Channel`, `Address`),
  CONSTRAINT `fk_notification_endpoints_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Wellness reminders and event logs
CREATE TABLE IF NOT EXISTS `WellnessReminderSettings` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `UserId` INT UNSIGNED NOT NULL,
  `MealEnabled` TINYINT(1) NOT NULL DEFAULT 1, `WaterEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `WaterIntervalMinutes` INT NOT NULL DEFAULT 120, `DailyWaterGoalMl` INT NULL,
  `QuietHoursEnabled` TINYINT(1) NOT NULL DEFAULT 1, `QuietStart` VARCHAR(5) NOT NULL DEFAULT '22:00',
  `QuietEnd` VARCHAR(5) NOT NULL DEFAULT '07:00', `TimeZoneId` VARCHAR(80) NOT NULL DEFAULT 'UTC',
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `UpdatedAt` DATETIME NULL,
  PRIMARY KEY (`Id`), UNIQUE KEY `uq_wellness_settings_user` (`UserId`),
  CONSTRAINT `fk_wellness_settings_user` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MealReminderSchedules` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `UserId` INT UNSIGNED NOT NULL,
  `MealType` VARCHAR(40) NOT NULL, `CustomName` VARCHAR(100) NULL, `ReminderTime` VARCHAR(5) NOT NULL,
  `DaysOfWeek` VARCHAR(20) NOT NULL DEFAULT '0,1,2,3,4,5,6', `Enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `UpdatedAt` DATETIME NULL,
  PRIMARY KEY (`Id`), KEY `idx_meal_schedule_user` (`UserId`,`Enabled`),
  CONSTRAINT `fk_meal_schedule_user` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MealLogs` (
  `Id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `UserId` INT UNSIGNED NOT NULL, `MealType` VARCHAR(40) NOT NULL,
  `FoodDescription` TEXT NOT NULL, `CarbohydratesGrams` DECIMAL(8,2) NULL, `PhotoUrl` VARCHAR(500) NULL,
  `Notes` TEXT NULL, `OccurredAtUtc` DATETIME NOT NULL, `ClientEventId` VARCHAR(100) NOT NULL,
  `DeletedAt` DATETIME NULL, `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `UpdatedAt` DATETIME NULL,
  PRIMARY KEY (`Id`), UNIQUE KEY `uq_meal_logs_client_event` (`UserId`,`ClientEventId`), KEY `idx_meal_logs_user_time` (`UserId`,`OccurredAtUtc`),
  CONSTRAINT `fk_meal_logs_user` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WaterIntakeLogs` (
  `Id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `UserId` INT UNSIGNED NOT NULL, `AmountMl` INT NOT NULL,
  `OccurredAtUtc` DATETIME NOT NULL, `ClientEventId` VARCHAR(100) NOT NULL, `DeletedAt` DATETIME NULL,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `UpdatedAt` DATETIME NULL,
  PRIMARY KEY (`Id`), UNIQUE KEY `uq_water_logs_client_event` (`UserId`,`ClientEventId`), KEY `idx_water_logs_user_time` (`UserId`,`OccurredAtUtc`),
  CONSTRAINT `fk_water_logs_user` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Verification: should return 21 rows when all tables were created.
SELECT `TABLE_NAME`
FROM `information_schema`.`TABLES`
WHERE `TABLE_SCHEMA` = DATABASE()
ORDER BY `TABLE_NAME`;
