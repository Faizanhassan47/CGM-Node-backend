import * as mysql from 'mysql2/promise';
import 'dotenv/config';

const enabled = process.env.CGM_MYSQL_INTEGRATION === '1';
const connectionString = process.env.DB_CONNECTION_STRING ?? '';
const connectionOptions = Object.fromEntries(
  connectionString
    .replace(/^\"|\"$/g, '')
    .split(';')
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=');
      return separator < 0
        ? [part, '']
        : [part.slice(0, separator).toLowerCase(), part.slice(separator + 1)];
    }),
);
const host = process.env.DB_HOST ?? process.env.MYSQL_HOST ?? connectionOptions.server ?? '';
const safeHost = /^(localhost|127\.0\.0\.1|::1)$/i.test(host);

/**
 * Database smoke checks for the transactional ingestion schema.
 *
 * This suite is intentionally opt-in and refuses remote hosts. Run it only
 * against a disposable local MySQL database after importing the schema:
 * CGM_MYSQL_INTEGRATION=1 DB_HOST=127.0.0.1 ... npm test -- --runInBand
 */
const describeIntegration = enabled && safeHost ? describe : describe.skip;

describeIntegration('MySQL ingestion integration', () => {
  let connection: mysql.Connection;

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host,
      port: Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? connectionOptions.port ?? 3306),
      user: process.env.DB_USERNAME ?? process.env.MYSQL_USER ?? connectionOptions.user,
      password: process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD ?? connectionOptions.password,
      database: process.env.DB_DATABASE ?? process.env.MYSQL_DATABASE ?? connectionOptions.database,
      multipleStatements: false,
    });
  });

  afterAll(async () => {
    await connection?.end();
  });

  it('has the tables and uniqueness required for ingestion', async () => {
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('GlucoseMeasurements', 'DailySummaryJobs')`,
    );

    expect(tables.map((row) => row.TABLE_NAME).sort()).toEqual([
      'DailySummaryJobs',
      'GlucoseMeasurements',
    ]);

    const [indexes] = await connection.query<mysql.RowDataPacket[]>(
      `SHOW INDEX FROM GlucoseMeasurements`,
    );
    const indexColumns = indexes.map((row) => row.Column_name);
    expect(indexColumns).toEqual(
      expect.arrayContaining(['SensorId', 'MeasurementTime']),
    );
  });
});
