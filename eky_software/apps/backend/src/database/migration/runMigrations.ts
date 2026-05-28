import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import type { SchemaMigrationTable } from '../schema.js';

const migrationsDirectory = resolve(process.cwd(), 'src/database/migrations');

export async function runMigrations(database: DatabaseConnection): Promise<void> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      run_at TEXT NOT NULL
    );
  `);

  const appliedMigrations = database
    .prepare<[], Pick<SchemaMigrationTable, 'name'>>('SELECT name FROM schema_migrations')
    .all();

  const appliedMigrationNames = new Set(appliedMigrations.map((migration) => migration.name));
  const migrationFileNames = readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  for (const migrationFileName of migrationFileNames) {
    if (appliedMigrationNames.has(migrationFileName)) {
      continue;
    }

    const migrationSql = readFileSync(resolve(migrationsDirectory, migrationFileName), 'utf8');

    const runMigration = database.transaction(() => {
      database.exec(migrationSql);
      database
        .prepare<[string, string]>(
          'INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)',
        )
        .run(migrationFileName, new Date().toISOString());
    });

    runMigration();
  }
}
