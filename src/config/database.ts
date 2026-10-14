import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function parseDotnetConnectionString(value: string): Record<string, string> {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  return Object.fromEntries(normalized.split(';').filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [item.slice(0, index).trim().toLowerCase(), item.slice(index + 1).trim()];
  }));
}

export function databaseConfig(connectionString: string): TypeOrmModuleOptions {
  const c = parseDotnetConnectionString(connectionString);
  const sslMode = (c.sslmode ?? '').toLowerCase();
  const isMssql = 'trusted_connection' in c || 'trustservercertificate' in c;
  return {
    type: isMssql ? 'mssql' : 'mysql',
    driver: isMssql ? require('mssql/msnodesqlv8') : undefined,
    host: c.server ?? c.host ?? '127.0.0.1',
    port: c.port ? Number(c.port) : (isMssql ? undefined : 3306),
    username: c.user ?? c['user id'] ?? c.uid,
    password: c.password ?? c.pwd,
    database: c.database ?? c['initial catalog'],
    autoLoadEntities: true,
    synchronize: isMssql,
    logging: false,
    timezone: 'Z',
    retryAttempts: 3,
    extra: isMssql
      ? { connectionString: connectionString.includes('Driver=') ? connectionString : `Driver={ODBC Driver 18 for SQL Server};${connectionString}` }
      : {
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
          waitForConnections: true,
          connectionLimit: 10,
          ...(sslMode && sslMode !== 'none' && sslMode !== 'disabled'
              ? { ssl: { rejectUnauthorized: sslMode === 'verifyca' || sslMode === 'verifyfull' } }
              : {}),
        },
  };
}
