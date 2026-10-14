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

  let inspectionFailed = false;
  let inspectionFailure: unknown;
  try {
    return inspect(database);
  } catch (error) {
    inspectionFailed = true;
    inspectionFailure = error;
    throw error;
  } finally {
    try { database.close(); }
    catch (error) {
      throw new AggregateError(
        inspectionFailed ? [inspectionFailure, error] : [error],
        'READ_ONLY_DATABASE_CLOSE_FAILED',
        { cause: inspectionFailed ? inspectionFailure : error },
      );
    }
  }
}
