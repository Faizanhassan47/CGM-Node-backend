"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const typeorm_1 = require("typeorm");
const database_1 = require("../src/config/database");
const schema_initializer_1 = require("../src/database/schema-initializer");
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
async function main() {
    const envPath = process.env.DOTENV_CONFIG_PATH || '.env.staging';
    const loaded = dotenv.config({ path: envPath, override: true });
    if (loaded.error) {
        throw new Error(`Unable to load ${envPath}: ${loaded.error.message}`);
    }
    if (process.env.CGM_STAGING_DATABASE !== 'true') {
        throw new Error('Refusing to initialize: CGM_STAGING_DATABASE=true is required.');
    }
    const expectedDatabase = process.env.CGM_STAGING_DATABASE_NAME;
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (expectedDatabase !== stagingDatabase) {
        throw new Error(`Refusing to initialize unexpected database: ${expectedDatabase ?? '(missing)'}`);
    }
    if (!connectionString) {
        throw new Error('DB_CONNECTION_STRING is missing.');
    }
    const parsed = (0, database_1.parseDotnetConnectionString)(connectionString);
    const configuredDatabase = parsed.database ?? parsed['initial catalog'];
    if (configuredDatabase === productionDatabase) {
        throw new Error('Refusing to initialize the production database.');
    }
    if (configuredDatabase !== stagingDatabase) {
        throw new Error(`Refusing to initialize configured database: ${configuredDatabase ?? '(missing)'}`);
    }
    const db = new typeorm_1.DataSource((0, database_1.databaseConfig)(connectionString));
    try {
        await db.initialize();
        const [identity] = await db.query('SELECT DATABASE() AS ActiveDatabase, CURRENT_USER() AS ConnectedUser, @@hostname AS MySQLServer');
        if (identity.ActiveDatabase !== stagingDatabase) {
            throw new Error(`Connected database is ${identity.ActiveDatabase}; expected ${stagingDatabase}.`);
        }
        const grants = await db.query('SHOW GRANTS FOR CURRENT_USER()');
        const grantText = JSON.stringify(grants);
        if (grantText.includes(productionDatabase)) {
            throw new Error('Refusing to initialize: staging account has production-schema access.');
        }
        console.log(`Initializing staging database ${identity.ActiveDatabase} as ${identity.ConnectedUser}.`);
        await (0, schema_initializer_1.ensureTablesExist)(db);
        const rows = await db.query(`SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (${requiredTables.map(() => '?').join(', ')})
       ORDER BY TABLE_NAME`, requiredTables);
        const available = rows.map((row) => row.TABLE_NAME);
        const missing = requiredTables.filter((table) => !available.includes(table));
        if (missing.length > 0) {
            throw new Error(`Schema initialization incomplete. Missing tables: ${missing.join(', ')}`);
        }
        console.log(`Staging schema ready. Verified ${available.length} required tables.`);
        console.log(JSON.stringify({ identity, tables: available }, null, 2));
    }
    finally {
        if (db.isInitialized) {
            await db.destroy();
        }
    }
}
main().catch((error) => {
    console.error('Staging initialization failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
//# sourceMappingURL=initialize-staging-db.js.map