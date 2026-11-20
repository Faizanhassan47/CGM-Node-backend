-- Run on production MySQL in phpMyAdmin (same DB History/Reports already use).
-- Do NOT create a new table — GlucoseMeasurements stays the source of truth.

-- A) Add phone receive time + source (skip a statement if "Duplicate column" appears)
ALTER TABLE GlucoseMeasurements
  ADD COLUMN ReceivedAt DATETIME(3) NULL AFTER CreatedAt;

ALTER TABLE GlucoseMeasurements
  ADD COLUMN Source VARCHAR(20) NULL AFTER ReceivedAt;

-- B) Remove older duplicate sequences so UNIQUE can be added
DELETE g1 FROM GlucoseMeasurements g1
INNER JOIN GlucoseMeasurements g2
  ON g1.SensorId = g2.SensorId
 AND g1.SequenceNumber = g2.SequenceNumber
 AND g1.SequenceNumber IS NOT NULL
 AND g1.MeasurementTime < g2.MeasurementTime;

-- C) One row per (SensorId, SequenceNumber) — live value can overwrite fill rows
--    Skip if "Duplicate key name" appears
ALTER TABLE GlucoseMeasurements
  ADD UNIQUE KEY uq_glucose_sensor_seq (SensorId, SequenceNumber);

-- D) Verify (replace ids if needed)
SELECT SequenceNumber, GlucoseValue, MeasurementTime, ReceivedAt, Source, WE1CurrentNa, CreatedAt
FROM GlucoseMeasurements
WHERE UserId = 28 AND SensorId = 39
ORDER BY MeasurementTime DESC
LIMIT 40;
