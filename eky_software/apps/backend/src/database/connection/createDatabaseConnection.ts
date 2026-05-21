import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { DatabaseSchema } from '../schema.js';

const defaultDatabaseFilePath = 'data/eky-dev.sqlite';

function getDatabaseFilePath(): string {
  const configuredPath = process.env.DATABASE_FILE_PATH?.trim();

  if (configuredPath !== undefined && configuredPath !== '') {
    return resolve(process.cwd(), configuredPath);
  }

  return resolve(process.cwd(), defaultDatabaseFilePath);
}

export function createDatabaseConnection(): Kysely<DatabaseSchema> {
  const databaseFilePath = getDatabaseFilePath();
  mkdirSync(dirname(databaseFilePath), { recursive: true });

  const sqliteDatabase = new Database(databaseFilePath);
  sqliteDatabase.pragma('foreign_keys = ON');

  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: sqliteDatabase,
    }),
  });
}
