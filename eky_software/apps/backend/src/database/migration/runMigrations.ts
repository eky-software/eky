import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, type Kysely } from 'kysely';

import type { DatabaseSchema } from '../schema.js';

const migrationsDirectory = resolve(process.cwd(), 'src/database/migrations');

export async function runMigrations(database: Kysely<DatabaseSchema>): Promise<void> {
  await database.schema
    .createTable('schema_migrations')
    .ifNotExists()
    .addColumn('name', 'text', (column) => column.primaryKey())
    .addColumn('run_at', 'text', (column) => column.notNull())
    .execute();

  const appliedMigrations = await database
    .selectFrom('schema_migrations')
    .select('name')
    .execute();

  const appliedMigrationNames = new Set(appliedMigrations.map((migration) => migration.name));
  const migrationFileNames = readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  for (const migrationFileName of migrationFileNames) {
    if (appliedMigrationNames.has(migrationFileName)) {
      continue;
    }

    const migrationSql = readFileSync(resolve(migrationsDirectory, migrationFileName), 'utf8');

    await database.transaction().execute(async (transaction) => {
      await sql.raw(migrationSql).execute(transaction);

      await transaction
        .insertInto('schema_migrations')
        .values({
          name: migrationFileName,
          run_at: new Date().toISOString(),
        })
        .execute();
    });
  }
}
