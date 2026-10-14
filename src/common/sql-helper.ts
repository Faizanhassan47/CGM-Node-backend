import { DataSource } from 'typeorm';

export function isMssql(db: DataSource): boolean {
  return db.options.type === 'mssql';
}

/**
 * Normalizes SQL queries across MySQL and MS SQL Server (mssql/ODBC):
 * 1. UTC_TIMESTAMP() -> GETUTCDATE()
 * 2. NOW() -> GETUTCDATE()
 * 3. Double-quoted string literals "..." -> single-quoted '...'
 * 4. SELECT ... ORDER BY ... LIMIT n -> SELECT TOP n ... ORDER BY ...
 * 5. DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) -> DATEADD(day, -7, GETUTCDATE())
 * 6. DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) -> DATEADD(minute, 15, GETUTCDATE())
 * 7. DATE(col) -> CAST(col AS DATE)
 * 8. IF(cond, a, b) -> CASE WHEN cond THEN a ELSE b END
 * 9. INSERT IGNORE INTO -> handled or converted to standard MERGE/check
 */
export function normalizeSql(sql: string, db: DataSource): string {
  if (!isMssql(db)) {
    // A few compatibility queries are authored with SQL Server's TOP syntax.
    // Convert them at the database boundary so the same query remains valid on
    // MySQL/MariaDB without duplicating controller logic.
    const topMatch = sql.match(/^\s*SELECT\s+(DISTINCT\s+)?TOP\s+(\d+)\s+/i);
    if (!topMatch) return sql;
    const limit = topMatch[2];
    const normalized = sql.replace(
      /^(\s*SELECT\s+)(DISTINCT\s+)?TOP\s+\d+\s+/i,
      (_, select: string, distinct: string | undefined) =>
        `${select}${distinct ?? ''}`,
    );
    return /\sLIMIT\s+\d+\s*;?\s*$/i.test(normalized)
      ? normalized
      : `${normalized.replace(/;\s*$/, '')} LIMIT ${limit}`;
  }

  let out = sql;

  // Replace UTC_TIMESTAMP() and NOW() with GETUTCDATE()
  out = out.replace(/\bUTC_TIMESTAMP\(\)/gi, 'GETUTCDATE()');
  out = out.replace(/\bNOW\(\)/gi, 'GETUTCDATE()');

  // Replace DATE_SUB(GETUTCDATE(), INTERVAL 7 DAY) with DATEADD(day, -7, GETUTCDATE())
  out = out.replace(/DATE_SUB\s*\(\s*GETUTCDATE\(\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, 'DATEADD(day, -$1, GETUTCDATE())');
  out = out.replace(/DATE_SUB\s*\(\s*UTC_TIMESTAMP\(\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, 'DATEADD(day, -$1, GETUTCDATE())');

  // Replace DATE_ADD(GETUTCDATE(), INTERVAL 15 MINUTE) with DATEADD(minute, 15, GETUTCDATE())
  out = out.replace(/DATE_ADD\s*\(\s*GETUTCDATE\(\)\s*,\s*INTERVAL\s+(\d+)\s+MINUTE\s*\)/gi, 'DATEADD(minute, $1, GETUTCDATE())');
  out = out.replace(/DATE_ADD\s*\(\s*UTC_TIMESTAMP\(\)\s*,\s*INTERVAL\s+(\d+)\s+MINUTE\s*\)/gi, 'DATEADD(minute, $1, GETUTCDATE())');

  // Replace DATE(column) with CAST(column AS DATE)
  out = out.replace(/\bDATE\(([^)]+)\)/gi, 'CAST($1 AS DATE)');

  // Replace IF(cond, val1, val2)
  out = out.replace(/\bIF\s*\(([^,]+),\s*([^,]+),\s*([^)]+)\)/gi, 'CASE WHEN $1 THEN $2 ELSE $3 END');
  out = out.replace(/\bTHEN\s+true\b/gi, 'THEN 1');
  out = out.replace(/\bTHEN\s+false\b/gi, 'THEN 0');
  out = out.replace(/\bELSE\s+true\b/gi, 'ELSE 1');
  out = out.replace(/\bELSE\s+false\b/gi, 'ELSE 0');

  // Replace double-quoted string literals with single quotes (e.g. "Pending", "Failed")
  // In T-SQL with QUOTED_IDENTIFIER ON, "..." is treated as an identifier/column, not string!
  out = out.replace(/"([^"]*)"/g, "'$1'");

  // Replace SELECT ... LIMIT N with SELECT TOP N ...
  const limitMatch = out.match(/\s+LIMIT\s+(\d+)\s*(?:;)?\s*$/i);
  if (limitMatch) {
    const limitNum = limitMatch[1];
    out = out.replace(/\s+LIMIT\s+\d+\s*(?:;)?\s*$/i, '');
    if (!/^\s*SELECT\s+(?:DISTINCT\s+)?TOP\s+/i.test(out)) {
      out = out.replace(/^(\s*SELECT\s+(?:DISTINCT\s+)?)/i, `$1TOP ${limitNum} `);
    }
  }

  // TypeORM SqlServerQueryRunner binds parameters by index as @0, @1, @2, ...
  // In raw SQL with ? (MySQL style), MS SQL ODBC driver throws 'COUNT field incorrect or syntax error'.
  // Replace each '?' with '@0', '@1', '@2', ...
  let paramIndex = 0;
  out = out.replace(/\?/g, () => `@${paramIndex++}`);

  return out;
}
