import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { vi } from 'vitest';

export function failMigrationWrite(
  database: DatabaseConnection,
  table: 'schema_migrations' | 'schema_migration_metadata',
  migrationName: string,
  observeBeforeFailure: () => boolean,
) {
  const observe = vi.fn(observeBeforeFailure);
  const prepare = database.prepare.bind(database);
  const target = new RegExp(`^\\s*INSERT INTO ${table}\\s*\\(`);
  vi.spyOn(database, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (target.test(sql)) {
      const run = statement.run.bind(statement);
      vi.spyOn(statement, 'run').mockImplementation((...parameters) => {
        if (parameters[0] === migrationName) {
          observe();
          throw new Error('SYNTHETIC_MIGRATION_WRITE_FAILURE');
        }
        return run(...parameters);
      });
    }
    return statement;
  });
  return observe;
}
