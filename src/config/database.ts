import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/** Hostinger MySQL hostname moves; keep known old → current remaps here. */
const HOSTINGER_MYSQL_HOST_REMAP: Record<string, string> = {
  'srv1458.hstgr.io': 'srv2092.hstgr.io',
};

export function parseDotnetConnectionString(value: string): Record<string, string> {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  return Object.fromEntries(normalized.split(';').filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [item.slice(0, index).trim().toLowerCase(), item.slice(index + 1).trim()];
  }));
}

/**
 * Rewrite stale Hostinger MySQL hosts in DB_CONNECTION_STRING so production
 * keeps working after a panel hostname change without a stuck "Starting" state.
 */
export function normalizeDbConnectionString(value: string): {
  connectionString: string;
  remappedFrom?: string;
  remappedTo?: string;
} {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  const parts = parseDotnetConnectionString(trimmed);
  const host = (parts.server ?? parts.host ?? '').toLowerCase();
  const mapped = HOSTINGER_MYSQL_HOST_REMAP[host];
  if (!mapped) {
    return { connectionString: trimmed };
  }
  const rewritten = trimmed.replace(new RegExp(host.replace(/\./g, '\\.'), 'ig'), mapped);
  return {
    connectionString: rewritten,
    remappedFrom: host,
    remappedTo: mapped,
  };
}

export function databaseConfig(connectionString: string): TypeOrmModuleOptions {
  const c = parseDotnetConnectionString(
    normalizeDbConnectionString(connectionString).connectionString,
  );
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
    synchronize: false,
    logging: false,
    timezone: 'Z',
    retryAttempts: 3,
    extra: isMssql
      ? { connectionString: connectionString.includes('Driver=') ? connectionString : `Driver={ODBC Driver 18 for SQL Server};${connectionString}` }
      : {
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
          waitForConnections: true,
          connectionLimit: 20,
          ...(sslMode && sslMode !== 'none' && sslMode !== 'disabled'
              ? { ssl: { rejectUnauthorized: sslMode === 'verifyca' || sslMode === 'verifyfull' } }
              : {}),
        },
  };
}
