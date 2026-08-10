import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';

const restoreInfrastructureTables = new Set([
  'local_runtime_identity',
  'schema_migration_metadata',
  'schema_migrations',
]);

interface SqliteTableRow {
  name: string;
}

export function isActiveProfileRestoreTargetEmpty(
  database: DatabaseConnection,
): boolean {
  const tables = database
    .prepare<[], SqliteTableRow>(
      `
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all();

  for (const table of tables) {
    if (restoreInfrastructureTables.has(table.name)) {
      continue;
    }

    const escapedTableName = table.name.replaceAll('"', '""');
    const row = database
      .prepare(`SELECT 1 AS present FROM "${escapedTableName}" LIMIT 1`)
      .get();

    if (row !== undefined) {
      return false;
    }
  }

  return true;
}
