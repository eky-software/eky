import { lstatSync, realpathSync } from 'node:fs';
import { relative } from 'node:path';

import {
  createDatabaseConnection,
  resolveDatabaseFilePath,
  type DatabaseConnection,
} from '../connection/createDatabaseConnection.js';
import { withReadOnlyDatabaseConnection } from '../connection/openReadOnlyDatabaseConnection.js';
import { inspectAttestedMigrationHistory } from './inspectAttestedMigrationHistory.js';
import type { MigrationStartupPolicy } from './inspectMigrationStartupState.js';
import { readMigrationManifest, type MigrationManifestEntry } from './migrationManifest.js';
import { MigrationRunError } from './migrationRunError.js';

interface OpenAttestedMigrationDatabaseOptions {
  allowCreate: boolean;
  allowEmpty: boolean;
  databaseFilePath?: string;
  migrationsDirectory: string;
  policy: MigrationStartupPolicy | 'runnerBaseline';
}

export function openAttestedMigrationDatabase(
  options: Readonly<OpenAttestedMigrationDatabaseOptions>,
): DatabaseConnection {
  const databaseFilePath = resolveDatabaseFilePath(options.databaseFilePath);
  const exists = validateExistingDatabaseFile(databaseFilePath);
  if (!exists && !options.allowCreate) throw new Error('MIGRATION_DATABASE_MISSING');

  let manifest: MigrationManifestEntry[];
  try { manifest = readMigrationManifest(options.migrationsDirectory); }
  catch {
    throw new MigrationRunError({
      completedMigrationCount: 0, errorCode: 'MIGRATION_MANIFEST_FAILED', failureStage: 'manifest',
    });
  }
  const attest = (database: DatabaseConnection): void => {
    try {
      inspectAttestedMigrationHistory(database, manifest, {
        allowEmpty: options.allowEmpty,
        ...(options.policy === 'restoreCompatible' ? { legacyPolicy: 'approvedRestore' as const }
          : options.policy === 'runnerBaseline' ? { legacyPolicy: 'runnerBaseline' as const } : {}),
      });
    } catch {
      throw new MigrationRunError({
        completedMigrationCount: 0,
        errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED',
        failureStage: 'historyPreparation',
      });
    }
  };

  if (exists) withReadOnlyDatabaseConnection(databaseFilePath, attest);
  const database = createDatabaseConnection({ databaseFilePath, fileMustExist: exists });
  try {
    // The readonly result never authorizes content reads on a newly opened connection.
    attest(database);
    return database;
  } catch (error) {
    try { database.close(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'MIGRATION_DATABASE_CLOSE_FAILED');
    }
    throw error;
  }
}

function validateExistingDatabaseFile(path: string): boolean {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (metadata === undefined) return false;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
    relative(path, realpathSync(path)) !== '') {
    throw new Error('MIGRATION_DATABASE_FILE_INVALID');
  }
  return true;
}
