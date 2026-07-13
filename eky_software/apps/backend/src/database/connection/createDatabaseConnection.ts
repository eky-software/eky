import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const defaultDatabaseFilePath = 'data/eky-dev.sqlite';

export type DatabaseConnection = Database.Database;

export interface CreateDatabaseConnectionOptions {
  databaseFilePath?: string;
}

function getDatabaseFilePath(
  configuredPath = process.env.DATABASE_FILE_PATH,
): string {
  const trimmedPath = configuredPath?.trim();

  if (trimmedPath !== undefined && trimmedPath !== '') {
    return resolve(process.cwd(), trimmedPath);
  }

  return resolve(process.cwd(), defaultDatabaseFilePath);
}

export function createDatabaseConnection(
  options: CreateDatabaseConnectionOptions = {},
): DatabaseConnection {
  const databaseFilePath = getDatabaseFilePath(options.databaseFilePath);
  mkdirSync(dirname(databaseFilePath), { recursive: true });

  const sqliteDatabase = new Database(databaseFilePath);
  sqliteDatabase.pragma('foreign_keys = ON');

  return sqliteDatabase;
}
