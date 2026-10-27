-- AIMA/Circle CGM wellness migration for an existing MySQL database.
-- Copy/paste this entire script after selecting the existing application database.
-- It is additive and safe to rerun. It does not create, drop, or select a database.

CREATE TABLE IF NOT EXISTS `WellnessReminderSettings` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `UserId` INT UNSIGNED NOT NULL,
  `MealEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `WaterEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `WaterIntervalMinutes` INT NOT NULL DEFAULT 120,
  `DailyWaterGoalMl` INT NULL,
  `QuietHoursEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `QuietStart` VARCHAR(5) NOT NULL DEFAULT '22:00',
  `QuietEnd` VARCHAR(5) NOT NULL DEFAULT '07:00',
  `TimeZoneId` VARCHAR(80) NOT NULL DEFAULT 'UTC',
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UpdatedAt` DATETIME NULL,
  PRIMARY KEY (`Id`), UNIQUE KEY `uq_wellness_settings_user` (`UserId`),
  CONSTRAINT `fk_wellness_settings_user` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MealReminderSchedules` (
  `Id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `UserId` INT UNSIGNED NOT NULL,
  `MealType` VARCHAR(40) NOT NULL, `CustomName` VARCHAR(100) NULL,
  `ReminderTime` VARCHAR(5) NOT NULL, `DaysOfWeek` VARCHAR(20) NOT NULL DEFAULT '0,1,2,3,4,5,6',
  `Enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `UpdatedAt` DATETIME NULL,
  PRIMARY KEY (`Id`), KEY `idx_meal_schedule_user` (`UserId`,`Enabled`),
  CONSTRAINT `fk_meal_schedule_user` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MealLogs` (
  `Id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `UserId` INT UNSIGNED NOT NULL,
  `MealType` VARCHAR(40) NOT NULL, `FoodDescription` TEXT NOT NULL,
  `CarbohydratesGrams` DECIMAL(8,2) NULL, `PhotoUrl` VARCHAR(500) NULL, `Notes` TEXT NULL,
  `OccurredAtUtc` DATETIME NOT NULL, `ClientEventId` VARCHAR(100) NOT NULL,
  `DeletedAt` DATETIME NULL, `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `UpdatedAt` DATETIME NULL,
  PRIMARY KEY (`Id`), UNIQUE KEY `uq_meal_logs_client_event` (`UserId`,`ClientEventId`),
  KEY `idx_meal_logs_user_time` (`UserId`,`OccurredAtUtc`),
  CONSTRAINT `fk_meal_logs_user` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WaterIntakeLogs` (
  `Id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `UserId` INT UNSIGNED NOT NULL,
  `AmountMl` INT NOT NULL, `OccurredAtUtc` DATETIME NOT NULL, `ClientEventId` VARCHAR(100) NOT NULL,
  `DeletedAt` DATETIME NULL, `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `UpdatedAt` DATETIME NULL,
  PRIMARY KEY (`Id`), UNIQUE KEY `uq_water_logs_client_event` (`UserId`,`ClientEventId`),
  KEY `idx_water_logs_user_time` (`UserId`,`OccurredAtUtc`),
  CONSTRAINT `fk_water_logs_user` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- phpMyAdmin/shared-hosting-safe verification.
-- Run these only after selecting the application database in phpMyAdmin.
SHOW TABLES LIKE 'WellnessReminderSettings';
SHOW TABLES LIKE 'MealReminderSchedules';
SHOW TABLES LIKE 'MealLogs';
SHOW TABLES LIKE 'WaterIntakeLogs';
