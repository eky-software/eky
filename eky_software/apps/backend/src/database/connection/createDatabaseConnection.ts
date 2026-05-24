import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const defaultDatabaseFilePath = 'data/eky-dev.sqlite';

export type DatabaseConnection = Database.Database;

function getDatabaseFilePath(): string {
  const configuredPath = process.env.DATABASE_FILE_PATH?.trim();

  if (configuredPath !== undefined && configuredPath !== '') {
    return resolve(process.cwd(), configuredPath);
  }

  return resolve(process.cwd(), defaultDatabaseFilePath);
}

export function createDatabaseConnection(): DatabaseConnection {
  const databaseFilePath = getDatabaseFilePath();
  mkdirSync(dirname(databaseFilePath), { recursive: true });

  const sqliteDatabase = new Database(databaseFilePath);
  sqliteDatabase.pragma('foreign_keys = ON');

  return sqliteDatabase;
}
