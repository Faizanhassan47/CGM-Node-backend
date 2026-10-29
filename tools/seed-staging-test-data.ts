import * as dotenv from 'dotenv';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import * as mysql from 'mysql2/promise';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { parseDotnetConnectionString } from '../src/config/database';

const stagingDatabase = 'u683352784_Visole_2';
const productionDatabase = 'u683352784_cgmVisole';

const requiredTables = [
  'Users',
  'CGMDevices',
  'Sensors',
  'GlucoseMeasurements',
  'DailySummaryJobs',
  'DailyGlucoseSummaries',
];

const fixtures = [
  {
    key: 'A',
    fullName: 'AIMA Staging User A',
    email: 'aima-staging-user-a@example.invalid',
    serial: 'AIMA-STAGING-DEVICE-A',
    sensor: 'AIMA-STAGING-SENSOR-A',
  },
  {
    key: 'B',
    fullName: 'AIMA Staging User B',
    email: 'aima-staging-user-b@example.invalid',
    serial: 'AIMA-STAGING-DEVICE-B',
    sensor: 'AIMA-STAGING-SENSOR-B',
  },
] as const;

type IndexRow = RowDataPacket & {
  Key_name: string;
  Non_unique: number;
  Seq_in_index: number;
  Column_name: string;
};

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  return `${salt.toString('base64')}.${hash.toString('base64')}`;
}

function connectionOptions(connectionString: string) {
  const parsed = parseDotnetConnectionString(connectionString);
  const sslMode = (parsed.sslmode ?? '').toLowerCase();

  return {
    host: parsed.server ?? parsed.host,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: parsed.user ?? parsed['user id'] ?? parsed.uid,
    password: parsed.password ?? parsed.pwd,
    database: parsed.database ?? parsed['initial catalog'],
    ssl: sslMode === 'none' || sslMode === 'disabled' ? undefined : { rejectUnauthorized: true },
    connectTimeout: 10_000,
  };
}

async function tablePreflight(connection: Connection): Promise<void> {
  const [tables] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${requiredTables.map(() => '?').join(', ')})`,
    requiredTables,
  );

  const available = new Set(tables.map((row) => String(row.TABLE_NAME)));
  const missing = requiredTables.filter((table) => !available.has(table));
  if (missing.length > 0) {
    throw new Error(`Missing required tables: ${missing.join(', ')}`);
  }

  const expectedIndexes = [
    { table: 'GlucoseMeasurements', name: 'PRIMARY', columns: ['SensorId', 'MeasurementTime'] },
    { table: 'DailySummaryJobs', name: 'uq_daily_summary_jobs_user_date', columns: ['UserId', 'SummaryDate'] },
    { table: 'DailyGlucoseSummaries', name: 'uq_user_date', columns: ['UserId', 'SummaryDate'] },
  ];

  for (const expected of expectedIndexes) {
    const [rows] = await connection.query<IndexRow[]>(`SHOW INDEX FROM \`${expected.table}\``);
    const actual = rows
      .filter((row) => row.Key_name === expected.name)
      .sort((a, b) => a.Seq_in_index - b.Seq_in_index)
      .map((row) => row.Column_name);

    if (actual.join('|') !== expected.columns.join('|')) {
      throw new Error(
        `Required index ${expected.name} on ${expected.table} is missing or has unexpected columns.`,
      );
    }
  }

  const [foreignKeys] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()`,
  );

  if (Number(foreignKeys[0]?.count ?? 0) === 0) {
    console.warn(
      '[STAGING] No foreign keys are defined. Ownership is currently enforced by application code.',
    );
  }
}

async function upsertUser(connection: Connection, fixture: (typeof fixtures)[number], passwordHash: string): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO Users
       (FullName, Email, PasswordHash, AuthProvider, EmailVerified, IsActive, ReferralCode, CreatedAt, TokenVersion)
     VALUES (?, ?, ?, 'Email', 1, 1, ?, UTC_TIMESTAMP(), 0)
     ON DUPLICATE KEY UPDATE
       Id = LAST_INSERT_ID(Id),
       FullName = VALUES(FullName),
       PasswordHash = VALUES(PasswordHash),
       AuthProvider = 'Email',
       EmailVerified = 1,
       IsActive = 1,
       ReferralCode = VALUES(ReferralCode),
       UpdatedAt = UTC_TIMESTAMP(),
       TokenVersion = TokenVersion + 1`,
    [fixture.fullName, fixture.email, passwordHash, `STAGING-${fixture.key}`],
  );

  return Number(result.insertId);
}

async function upsertProfile(connection: Connection, userId: number): Promise<void> {
  await connection.execute(
    `INSERT INTO PatientProfile
       (UserId, PreferredGlucoseUnit, ProfileCompleted, CreatedAt)
     VALUES (?, 'mg/dL', 1, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       PreferredGlucoseUnit = 'mg/dL',
       ProfileCompleted = 1,
       UpdatedAt = UTC_TIMESTAMP()`,
    [userId],
  );
}

async function upsertDevice(connection: Connection, fixture: (typeof fixtures)[number], userId: number): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO CGMDevices
       (UserId, DeviceName, DeviceType, DeviceModel, SerialNumber, BleDeviceName,
        FirmwareVersion, BatteryVoltageMv, ConnectionStatus, LastConnectedAt,
        LastCommunicationAt, IsActive, CreatedAt)
     VALUES (?, ?, 'Staging', 'AIMA-Synthetic', ?, ?, 'staging', 3000,
             'Connected', UTC_TIMESTAMP(), UTC_TIMESTAMP(), 1, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       Id = LAST_INSERT_ID(Id),
       UserId = VALUES(UserId),
       DeviceName = VALUES(DeviceName),
       DeviceType = VALUES(DeviceType),
       DeviceModel = VALUES(DeviceModel),
       BleDeviceName = VALUES(BleDeviceName),
       FirmwareVersion = VALUES(FirmwareVersion),
       BatteryVoltageMv = VALUES(BatteryVoltageMv),
       ConnectionStatus = 'Connected',
       LastConnectedAt = UTC_TIMESTAMP(),
       LastCommunicationAt = UTC_TIMESTAMP(),
       IsActive = 1,
       UpdatedAt = UTC_TIMESTAMP()`,
    [userId, `AIMA Staging Device ${fixture.key}`, fixture.serial, fixture.serial],
  );

  return Number(result.insertId);
}

async function upsertSensor(
  connection: Connection,
  fixture: (typeof fixtures)[number],
  userId: number,
  deviceId: number,
): Promise<{ id: number; startedAt: string; expiresAt: string }> {
  const [existing] = await connection.execute<RowDataPacket[]>(
    'SELECT Id FROM Sensors WHERE SensorIdentifier = ? LIMIT 1 FOR UPDATE',
    [fixture.sensor],
  );

  const [result] = existing.length
    ? await connection.execute<ResultSetHeader>(
        `UPDATE Sensors
            SET UserId = ?, DeviceId = ?, Status = 'Active',
                StartedAt = UTC_TIMESTAMP(), ActivatedAt = UTC_TIMESTAMP(),
                ExpiresAt = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY),
                EndedAt = NULL, LastReadingAt = NULL, IsActive = 1
          WHERE Id = ?`,
        [userId, deviceId, existing[0].Id],
      )
    : await connection.execute<ResultSetHeader>(
        `INSERT INTO Sensors
           (UserId, DeviceId, SensorIdentifier, Status, StartedAt, ActivatedAt, ExpiresAt, IsActive)
         VALUES (?, ?, ?, 'Active', UTC_TIMESTAMP(), UTC_TIMESTAMP(),
                 DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY), 1)`,
        [userId, deviceId, fixture.sensor],
      );

  const sensorId = existing.length ? Number(existing[0].Id) : Number(result.insertId);
  await connection.execute(
    `UPDATE Sensors
        SET Status = 'Expired', IsActive = 0, EndedAt = UTC_TIMESTAMP(3)
      WHERE UserId = ? AND IsActive = 1 AND Id <> ?`,
    [userId, sensorId],
  );

  const [sensorRows] = await connection.execute<RowDataPacket[]>(
    'SELECT Id, StartedAt, ExpiresAt FROM Sensors WHERE Id = ?',
    [sensorId],
  );

  return {
    id: sensorId,
    startedAt: String(sensorRows[0].StartedAt),
    expiresAt: String(sensorRows[0].ExpiresAt),
  };
}

async function main(): Promise<void> {
  const envPath = process.env.DOTENV_CONFIG_PATH || '.env.staging';
  const loaded = dotenv.config({ path: envPath, override: true });
  if (loaded.error) throw new Error(`Unable to load ${envPath}: ${loaded.error.message}`);

  if (process.env.CGM_STAGING_DATABASE !== 'true') {
    throw new Error('Refusing to seed: CGM_STAGING_DATABASE=true is required.');
  }

  if (process.env.CGM_STAGING_DATABASE_NAME !== stagingDatabase) {
    throw new Error('Refusing to seed: staging database name does not match the approved database.');
  }

  const connectionString = process.env.DB_CONNECTION_STRING;
  const fixturePassword = process.env.CGM_FIXTURE_PASSWORD;
  if (!connectionString) throw new Error('DB_CONNECTION_STRING is missing.');
  if (!fixturePassword || fixturePassword.length < 6) {
    throw new Error('Set CGM_FIXTURE_PASSWORD in the current PowerShell session; it is not stored by this script.');
  }

  const parsed = parseDotnetConnectionString(connectionString);
  const configuredDatabase = parsed.database ?? parsed['initial catalog'];
  if (configuredDatabase === productionDatabase || configuredDatabase !== stagingDatabase) {
    throw new Error('Refusing to seed a non-staging database.');
  }

  const connection = await mysql.createConnection(connectionOptions(connectionString));

  try {
    const [identityRows] = await connection.query<RowDataPacket[]>(
      'SELECT DATABASE() AS ActiveDatabase, CURRENT_USER() AS ConnectedUser, @@hostname AS MySQLServer',
    );
    const identity = identityRows[0];
    if (identity.ActiveDatabase !== stagingDatabase) {
      throw new Error(`Connected database is ${identity.ActiveDatabase}; expected ${stagingDatabase}.`);
    }

    const [grants] = await connection.query<RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()');
    if (JSON.stringify(grants).includes(productionDatabase)) {
      throw new Error('Refusing to seed: staging account has production-schema access.');
    }

    await tablePreflight(connection);
    await connection.beginTransaction();

    const results: Array<{ email: string; userId: number; deviceId: number; sensorId: number; sensorStartUtc: string; sensorEndUtc: string }> = [];
    for (const fixture of fixtures) {
      const userId = await upsertUser(connection, fixture, hashPassword(fixturePassword));
      await upsertProfile(connection, userId);
      const deviceId = await upsertDevice(connection, fixture, userId);
      const sensor = await upsertSensor(connection, fixture, userId, deviceId);
      results.push({
        email: fixture.email,
        userId,
        deviceId,
        sensorId: sensor.id,
        sensorStartUtc: sensor.startedAt,
        sensorEndUtc: sensor.expiresAt,
      });
    }

    await connection.commit();
    console.log('Staging fixtures created or refreshed. Password was not printed or stored by this script.');
    console.log(JSON.stringify({ identity, fixtures: results }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('Staging fixture generation failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
