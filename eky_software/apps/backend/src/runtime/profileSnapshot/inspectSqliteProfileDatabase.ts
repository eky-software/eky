import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import Database from 'better-sqlite3';

import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import { readMigrationManifest } from '../../database/migration/migrationManifest.js';
import { inspectMigrationHistory } from '../../database/migration/migrationMetadata.js';

const profileIdentityDomain = 'Eky profile identity v1\0';

export interface SqliteProfileDatabaseInspection {
  migrationChainIdentity: string;
  profileId: string;
}

export function inspectSqliteProfileDatabase(
  databaseFilePath: string,
  migrationsDirectory: string,
  options: { allowHistoricalMigrationPrefix?: boolean } = {},
): SqliteProfileDatabaseInspection {
  if (!isAbsolute(databaseFilePath) || !isAbsolute(migrationsDirectory)) {
    throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
  }

  const database = new Database(databaseFilePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    const integrityResult: unknown = database.pragma('integrity_check', {
      simple: true,
    });
    const foreignKeyRows = database.pragma('foreign_key_check') as unknown[];

    if (integrityResult !== 'ok' || foreignKeyRows.length !== 0) {
      throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
    }

    const expectedMigrations = readMigrationManifest(migrationsDirectory);
    const migrationHistory = inspectMigrationHistory(
      database,
      expectedMigrations,
    );

    if (
      !options.allowHistoricalMigrationPrefix &&
      migrationHistory.appliedMigrationNames.length !==
        expectedMigrations.length
    ) {
      throw new Error('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
    }

    const identity = readLocalRuntimeIdentity(database);

    return {
      migrationChainIdentity: migrationHistory.migrationChainIdentity,
      profileId: createProfileBackupIdentity(identity.companyId),
    };
  } finally {
    database.close();
  }
}

export function createProfileBackupIdentity(companyId: string): string {
  return createHash('sha256')
    .update(profileIdentityDomain, 'utf8')
    .update(companyId, 'utf8')
    .digest('hex');
}
