import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { isSqliteMemoryError } from '../connection/isSqliteMemoryError.js';
import type { MigrationSchemaObject } from './migrationSchemaReference.js';

interface SchemaRow {
  type: unknown;
  name: unknown;
  tbl_name: unknown;
  sql: unknown;
  sql_bytes: number | null;
}

export function readBoundedMigrationSchema(
  database: DatabaseConnection,
  reference: readonly MigrationSchemaObject[],
  scope: 'all' | 'history',
): MigrationSchemaObject[] {
  const limits = {
    type: maximumBytes(reference.map(row => row.type)),
    name: maximumBytes(reference.map(row => row.name)),
    table: maximumBytes(reference.map(row => row.tbl_name)),
    sql: maximumBytes(reference.map(row => row.sql ?? '')),
  };
  try {
    const rows = database.prepare<{
      maxType: number; maxName: number; maxTable: number; maxSql: number;
      historyOnly: number; rowLimit: number;
    }, SchemaRow>(`
      SELECT
        CASE WHEN length(CAST(type AS BLOB)) <= @maxType THEN type END AS type,
        CASE WHEN length(CAST(name AS BLOB)) <= @maxName THEN name END AS name,
        CASE WHEN length(CAST(tbl_name AS BLOB)) <= @maxTable THEN tbl_name END AS tbl_name,
        CASE WHEN length(CAST(sql AS BLOB)) <= @maxSql THEN sql END AS sql,
        length(CAST(sql AS BLOB)) AS sql_bytes
      FROM main.sqlite_schema
      WHERE @historyOnly = 0
        OR tbl_name IN ('schema_migrations', 'schema_migration_metadata')
        OR name IN ('schema_migrations', 'schema_migration_metadata')
      LIMIT @rowLimit
    `).all({
      maxType: limits.type, maxName: limits.name, maxTable: limits.table, maxSql: limits.sql,
      historyOnly: scope === 'history' ? 1 : 0,
      rowLimit: reference.length + 1,
    });
    if (rows.length > reference.length) throw new Error('PROFILE_SCHEMA_UNSUPPORTED');
    return rows.map(row => {
      if (typeof row.type !== 'string' || typeof row.name !== 'string' ||
        typeof row.tbl_name !== 'string' ||
        (row.sql !== null && typeof row.sql !== 'string') ||
        (row.sql_bytes !== null && row.sql_bytes > limits.sql)) {
        throw new Error('PROFILE_SCHEMA_UNSUPPORTED');
      }
      return { type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql };
    });
  } catch (error) {
    if (isSqliteMemoryError(error)) throw error;
    throw new Error('PROFILE_SCHEMA_UNSUPPORTED');
  }
}

function maximumBytes(values: readonly string[]): number {
  return Math.max(0, ...values.map(value => Buffer.byteLength(value, 'utf8')));
}
