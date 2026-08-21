import { promises as fileSystem } from 'node:fs';

import { withReadOnlyDatabaseConnection } from '../../database/connection/openReadOnlyDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import { inspectMigrationStartupState } from '../../database/migration/inspectMigrationStartupState.js';
import { createProfileBackupIdentity } from '../profileSnapshot/inspectSqliteProfileDatabase.js';
import {
  assertWorkspaceCandidateContainedPath,
  resolveAbsoluteWorkspaceCandidatePath,
  validatePrivateWorkspaceDirectory,
  validateTrustedReadOnlyCodeDirectory,
  workspaceCandidatePathsAreEqual,
} from './workspaceCandidatePathPolicy.js';

const boundedReleaseValuePattern = /^[0-9A-Za-z.+_-]{1,100}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export type PublishedWorkspaceMigrationStatus =
  | 'compatiblePending'
  | 'current'
  | 'invalidHistory';

export interface PublishedWorkspaceMigrationInspection {
  readonly appliedMigrationCount: number;
  readonly kind: 'migrationInspection';
  readonly pendingMigrationCount: number;
  readonly status: PublishedWorkspaceMigrationStatus;
}

export interface PublishedWorkspaceMigrationInspectionInput {
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
  readonly migrationsDirectory: string;
  readonly publishedRoot: string;
}

export async function inspectPublishedWorkspaceMigration(
  input: Readonly<PublishedWorkspaceMigrationInspectionInput>,
  signal?: AbortSignal,
): Promise<Readonly<PublishedWorkspaceMigrationInspection>> {
  validateReleaseAndProfileIdentity(input);
  throwIfCancelled(signal);
  const publishedRoot = await validatePrivateWorkspaceDirectory(
    input.publishedRoot,
  );
  const migrationsDirectory = await validateTrustedReadOnlyCodeDirectory(
    input.migrationsDirectory,
  );
  const databaseFilePath = resolveAbsoluteWorkspaceCandidatePath(
    input.databaseFilePath,
  );
  assertWorkspaceCandidateContainedPath(publishedRoot, databaseFilePath);
  await validatePublishedDatabaseFile(databaseFilePath);
  throwIfCancelled(signal);

  return withReadOnlyDatabaseConnection(databaseFilePath, (database) => {
    throwIfCancelled(signal);
    let integrityResult: unknown;
    try {
      integrityResult = database.pragma('integrity_check', {
        simple: true,
      });
    } catch {
      return invalidHistory();
    }

    throwIfCancelled(signal);
    let profileId: string;
    try {
      profileId = createProfileBackupIdentity(
        readLocalRuntimeIdentity(database).companyId,
      );
    } catch {
      if (integrityResult !== 'ok') return invalidHistory();
      throw new Error('WORKSPACE_MIGRATION_PROFILE_IDENTITY_INVALID');
    }
    if (profileId !== input.expectedProfileId) {
      throw new Error('WORKSPACE_MIGRATION_PROFILE_MISMATCH');
    }
    throwIfCancelled(signal);

    if (integrityResult !== 'ok') return invalidHistory();

    let migration: ReturnType<typeof inspectMigrationStartupState>;
    try {
      const foreignKeyRows = database.pragma('foreign_key_check') as unknown[];
      if (foreignKeyRows.length !== 0) return invalidHistory();
      migration = inspectMigrationStartupState(
        database,
        migrationsDirectory,
      );
    } catch {
      return invalidHistory();
    }
    throwIfCancelled(signal);

    return Object.freeze({
      appliedMigrationCount: migration.appliedMigrationCount,
      kind: 'migrationInspection',
      pendingMigrationCount: migration.pendingMigrationCount,
      status:
        migration.pendingMigrationCount === 0
          ? ('current' as const)
          : ('compatiblePending' as const),
    });
  });
}

async function validatePublishedDatabaseFile(path: string): Promise<void> {
  const metadata = await fileSystem.lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    !workspaceCandidatePathsAreEqual(await fileSystem.realpath(path), path)
  ) {
    throw new Error('WORKSPACE_MIGRATION_DATABASE_INVALID');
  }
}

function validateReleaseAndProfileIdentity(
  input: Readonly<PublishedWorkspaceMigrationInspectionInput>,
): void {
  if (
    !boundedReleaseValuePattern.test(input.appVersion) ||
    !boundedReleaseValuePattern.test(input.buildRevision) ||
    !sha256Pattern.test(input.expectedProfileId)
  ) {
    throw new Error('WORKSPACE_MIGRATION_INPUT_INVALID');
  }
}

function invalidHistory(): Readonly<PublishedWorkspaceMigrationInspection> {
  return Object.freeze({
    appliedMigrationCount: 0,
    kind: 'migrationInspection',
    pendingMigrationCount: 0,
    status: 'invalidHistory',
  });
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error('WORKSPACE_MIGRATION_INSPECTION_CANCELLED');
  }
}
