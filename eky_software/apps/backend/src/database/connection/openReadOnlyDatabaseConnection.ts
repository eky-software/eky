import { isAbsolute, resolve } from 'node:path';

import Database from 'better-sqlite3';

import type { DatabaseConnection } from './createDatabaseConnection.js';

export function withReadOnlyDatabaseConnection<T>(
  databaseFilePath: string,
  inspect: (database: DatabaseConnection) => T,
): T {
  if (
    !isAbsolute(databaseFilePath) ||
    resolve(databaseFilePath) !== databaseFilePath
  ) {
    throw new Error('READ_ONLY_DATABASE_PATH_INVALID');
  }

  const database = new Database(databaseFilePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    return inspect(database);
  } finally {
    database.close();
  }
}
