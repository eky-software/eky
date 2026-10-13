import { createHash } from 'node:crypto';
import { isAbsolute, toNamespacedPath } from 'node:path';

import Database from 'better-sqlite3';

import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import { readMigrationManifest } from '../../database/migration/migrationManifest.js';
import type { MigrationHistoryInspection } from '../../database/migration/migrationMetadata.js';
import { inspectAttestedMigrationHistoryWithReferences } from '../../database/migration/inspectAttestedMigrationHistory.js';
import {
  getMigrationSchemaReference,
  getMigrationTechnicalSchema,
  type MigrationSchemaReferences,
} from '../../database/migration/migrationSchemaReference.js';
import { configureProfileInspectionConnection } from './profileInspectionSqlite.js';
import { profileInspectionSqliteError } from './profileInspectionSqliteError.js';

const profileIdentityDomain = 'Eky profile identity v1\0';

export interface SqliteProfileDatabaseInspection extends MigrationHistoryInspection {
  profileId: string;
}

export type ProfileMigrationInspectionPolicy =
  | 'exactCurrentManifest'
  | 'compatibleHistoricalPrefix'
  | 'restoreCompatible';

export function isProfileMigrationInspectionPolicy(value: unknown): value is ProfileMigrationInspectionPolicy {
  return value === 'exactCurrentManifest' || value === 'compatibleHistoricalPrefix' || value === 'restoreCompatible';
}

export function inspectSqliteProfileDatabase(
  databaseFilePath: string,
  migrationsDirectory: string,
  migrationPolicy: ProfileMigrationInspectionPolicy =
    'exactCurrentManifest',
): SqliteProfileDatabaseInspection {
  if (!isAbsolute(databaseFilePath) || !isAbsolute(migrationsDirectory)) {
    throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
  }

  const database = new Database(toNamespacedPath(databaseFilePath), {
    fileMustExist: true,
    readonly: true,
  });

  try {
    return inspectSqliteProfileConnection(database, migrationsDirectory, migrationPolicy);
  } finally {
    database.close();
  }
}

// The caller owns this readonly connection through both schema and content
// validation, avoiding a second unvalidated open between those steps.
export function inspectSqliteProfileConnection(
  database: DatabaseConnection,
  migrationsDirectory: string,
  migrationPolicy: ProfileMigrationInspectionPolicy = 'exactCurrentManifest',
): SqliteProfileDatabaseInspection {
  return inspectSqliteProfileConnectionWithReferences(database, migrationsDirectory, migrationPolicy, {
    getTechnicalSchema: getMigrationTechnicalSchema,
    getSchemaReference: getMigrationSchemaReference,
  });
}

export function inspectSqliteProfileConnectionWithReferences(
  database: DatabaseConnection,
  migrationsDirectory: string,
  migrationPolicy: ProfileMigrationInspectionPolicy,
  references: MigrationSchemaReferences,
): SqliteProfileDatabaseInspection {
  if (!database.readonly || !isAbsolute(migrationsDirectory) || !isProfileMigrationInspectionPolicy(migrationPolicy)) {
    throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
  }
  try {
    configureProfileInspectionConnection(database);
    const expectedMigrations = readMigrationManifest(migrationsDirectory);
    const migrationHistory = inspectAttestedMigrationHistoryWithReferences(database, expectedMigrations, references, {
      ...(migrationPolicy === 'restoreCompatible' ? { legacyPolicy: 'approvedRestore' } as const : {}),
    });
    const integrityResult: unknown = database.pragma('integrity_check', {
      simple: true,
    });
    const foreignKeyFailure = database.prepare('PRAGMA foreign_key_check').get();

    if (integrityResult !== 'ok' || foreignKeyFailure !== undefined) {
      throw new Error('PROFILE_SNAPSHOT_DATABASE_INVALID');
    }

    if (
      migrationPolicy === 'exactCurrentManifest' &&
      migrationHistory.appliedMigrationNames.length !== expectedMigrations.length
    ) {
      throw new Error('PROFILE_SNAPSHOT_MIGRATIONS_INVALID');
    }

    const identity = readLocalRuntimeIdentity(database);

    return {
      appliedMigrationNames: Object.freeze([...migrationHistory.appliedMigrationNames]),
      migrationChainIdentity: migrationHistory.migrationChainIdentity,
      profileId: createProfileBackupIdentity(identity.companyId),
    };
  } catch (error) {
    throw profileInspectionSqliteError(error);
  }
}

export function createProfileBackupIdentity(companyId: string): string {
  return createHash('sha256')
    .update(profileIdentityDomain, 'utf8')
    .update(companyId, 'utf8')
    .digest('hex');
}
