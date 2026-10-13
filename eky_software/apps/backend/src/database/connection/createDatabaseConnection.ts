import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const defaultDatabaseFilePath = 'data/eky-dev.sqlite';

export type DatabaseConnection = Database.Database;

export interface CreateDatabaseConnectionOptions {
  databaseFilePath?: string;
  fileMustExist?: boolean;
}

export function resolveDatabaseFilePath(
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
  const databaseFilePath = resolveDatabaseFilePath(options.databaseFilePath);
  if (options.fileMustExist !== true) {
    mkdirSync(dirname(databaseFilePath), { recursive: true });
  }

  const sqliteDatabase = new Database(databaseFilePath, {
    fileMustExist: options.fileMustExist === true,
  });
  sqliteDatabase.pragma('foreign_keys = ON');

  return sqliteDatabase;
}
