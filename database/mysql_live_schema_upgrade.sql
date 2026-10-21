-- AIMA CGM - Live MariaDB/MySQL column upgrade
-- Safe to paste into phpMyAdmin after selecting the CGM database.
-- This script preserves existing tables and data.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Social-auth and profile image fields introduced after the original Users table.
ALTER TABLE `Users`
  ADD COLUMN IF NOT EXISTS `ProfilePictureUrl` VARCHAR(500) NULL AFTER `IsActive`;

ALTER TABLE `PatientProfile`
  ADD COLUMN IF NOT EXISTS `ProfilePictureUrl` VARCHAR(500) NULL AFTER `Gender`;

-- Sensors: persist when a sensor session ended.
ALTER TABLE `Sensors`
  ADD COLUMN IF NOT EXISTS `EndedAt` DATETIME(3) NULL AFTER `ExpiresAt`;

-- Glucose measurements: persist the BLE sequence number and retain milliseconds.
ALTER TABLE `GlucoseMeasurements`
  ADD COLUMN IF NOT EXISTS `SequenceNumber` INT UNSIGNED NULL AFTER `DeviceId`,
  MODIFY COLUMN `MeasurementTime` DATETIME(3) NOT NULL;

-- Application versions: fields accepted by the API DTO.
ALTER TABLE `AppVersions`
  ADD COLUMN IF NOT EXISTS `MinimumSupportedVersion` VARCHAR(50) NULL AFTER `VersionCode`,
  ADD COLUMN IF NOT EXISTS `DownloadUrl` VARCHAR(1000) NULL AFTER `MinimumSupportedVersion`;

-- Add useful indexes only when they do not already exist.
SET @sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'GlucoseMeasurements'
      AND INDEX_NAME = 'idx_glucose_sensor_sequence'
  ),
  'SELECT ''idx_glucose_sensor_sequence already exists''',
  'CREATE INDEX `idx_glucose_sensor_sequence` ON `GlucoseMeasurements` (`SensorId`, `SequenceNumber`)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'Sensors'
      AND INDEX_NAME = 'idx_sensors_user_active'
  ),
  'SELECT ''idx_sensors_user_active already exists''',
  'CREATE INDEX `idx_sensors_user_active` ON `Sensors` (`UserId`, `IsActive`)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verification report. All seven rows should be returned.
SELECT
  `TABLE_NAME`,
  `COLUMN_NAME`,
  `COLUMN_TYPE`,
  `IS_NULLABLE`,
  `DATETIME_PRECISION`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (`TABLE_NAME` = 'Users' AND `COLUMN_NAME` = 'ProfilePictureUrl')
    OR (`TABLE_NAME` = 'PatientProfile' AND `COLUMN_NAME` = 'ProfilePictureUrl')
    OR (`TABLE_NAME` = 'Sensors' AND `COLUMN_NAME` = 'EndedAt')
    OR (`TABLE_NAME` = 'GlucoseMeasurements' AND `COLUMN_NAME` IN ('MeasurementTime', 'SequenceNumber'))
    OR (`TABLE_NAME` = 'AppVersions' AND `COLUMN_NAME` IN ('MinimumSupportedVersion', 'DownloadUrl'))
  )
ORDER BY `TABLE_NAME`, `ORDINAL_POSITION`;
