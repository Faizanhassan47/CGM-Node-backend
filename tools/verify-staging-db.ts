import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { databaseConfig, parseDotnetConnectionString } from '../src/config/database';

const productionDatabase = 'u683352784_cgmVisole';
const productionHost = 'srv1458.hstgr.io';

async function main() {
  const envPath = process.env.DOTENV_CONFIG_PATH || '.env';
  const loaded = dotenv.config({ path: envPath, override: true });
  if (loaded.error) throw new Error(`Unable to load ${envPath}: ${loaded.error.message}`);

  if (process.env.CGM_STAGING_DATABASE !== 'true') {
    throw new Error('CGM_STAGING_DATABASE=true is required.');
  }

  const expectedDatabase = process.env.CGM_STAGING_DATABASE_NAME;
  const connectionString = process.env.DB_CONNECTION_STRING;
  if (!expectedDatabase || !connectionString) {
    throw new Error('CGM_STAGING_DATABASE_NAME and DB_CONNECTION_STRING are required.');
  }

  const parsed = parseDotnetConnectionString(connectionString);
  const configuredDatabase = parsed.database ?? parsed['initial catalog'];
  const configuredHost = parsed.server ?? parsed.host;
  if (configuredDatabase === productionDatabase) {
    throw new Error('Refusing to verify the production database.');
  }
  if (configuredDatabase !== expectedDatabase) {
    throw new Error('Configured database does not match CGM_STAGING_DATABASE_NAME.');
  }

  const db = new DataSource(databaseConfig(connectionString) as DataSourceOptions);
  try {
    await db.initialize();
    const [identity] = await db.query(
      'SELECT DATABASE() AS ActiveDatabase, CURRENT_USER() AS ConnectedUser, @@hostname AS MySQLServer',
    );

    if (identity.ActiveDatabase !== expectedDatabase) {
      throw new Error(`Connected database is ${identity.ActiveDatabase}, expected ${expectedDatabase}.`);
    }

    const grants = await db.query('SHOW GRANTS FOR CURRENT_USER()');
    const grantText = JSON.stringify(grants);
    if (grantText.includes(productionDatabase)) {
      throw new Error('Staging account has access to the production schema.');
    }

    const tables = await db.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('Users', 'CGMDevices', 'Sensors', 'GlucoseMeasurements', 'DailySummaryJobs', 'DailyGlucoseSummaries')
       ORDER BY TABLE_NAME`,
    );
    const required = ['Users', 'CGMDevices', 'Sensors', 'GlucoseMeasurements', 'DailySummaryJobs', 'DailyGlucoseSummaries'];
    const available = tables.map((row: { TABLE_NAME: string }) => row.TABLE_NAME);
    const missing = required.filter((table) => !available.includes(table));
    if (missing.length) throw new Error(`Missing staging tables: ${missing.join(', ')}`);

    console.log(JSON.stringify({
      identity,
      grants,
      tables: available,
      sharedHostWarning: configuredHost === productionHost
        ? 'Staging shares the production MySQL host; do not run high-volume load tests.'
        : null,
    }, null, 2));
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(`Staging verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
