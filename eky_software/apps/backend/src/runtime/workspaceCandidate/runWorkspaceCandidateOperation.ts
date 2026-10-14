import { promises as fileSystem } from 'node:fs';
import { dirname, join, toNamespacedPath } from 'node:path';

import Database from 'better-sqlite3';

import { createDatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import type { OwnedLocalDatabaseRecovery } from '../../database/connection/recoverOwnedLocalDatabase.js';
import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import { inspectMigrationStartupState } from '../../database/migration/inspectMigrationStartupState.js';
import { openAttestedMigrationDatabase } from '../../database/migration/openAttestedMigrationDatabase.js';
import type { MigrationStartupPolicy } from '../../database/migration/inspectMigrationStartupState.js';
import { runMigrations } from '../../database/migration/runMigrations.js';
import { materializeValidatedProfileArtifacts } from '../profileSnapshot/materializeValidatedProfileArtifacts.js';
import { createProfileBackupIdentity, inspectSqliteProfileConnection } from '../profileSnapshot/inspectSqliteProfileDatabase.js';
import { CurrentActiveProfileValidationService } from '../profileSnapshot/validateActiveProfile.js';
import { validateProfileArtifactCatalog } from '../profileSnapshot/validateProfileArtifactCatalog.js';
import { selectInvoiceBackupArtifactCatalogSchema } from '../../modules/invoicing/infrastructure/selectInvoiceBackupArtifactCatalogSchema.js';
import {
  inspectPublishedWorkspaceMigration,
  type PublishedWorkspaceMigrationInspection,
} from './inspectPublishedWorkspaceMigration.js';
import {
  assertWorkspaceCandidateContainedPath,
  resolveAbsoluteWorkspaceCandidatePath,
  validatePrivateWorkspaceDirectory,
  validateTrustedReadOnlyCodeDirectory,
  workspaceCandidatePathsAreEqual,
} from './workspaceCandidatePathPolicy.js';
import { assertCopiedWorkspaceDatabaseUnchanged, copyAttestedWorkspaceDatabase } from './copyAttestedWorkspaceDatabase.js';

const profileDatabaseFileName = 'profile.sqlite';
const sha256Pattern = /^[0-9a-f]{64}$/;
const boundedReleaseValuePattern = /^[0-9A-Za-z.+_-]{1,100}$/;

interface WorkspaceCandidateCommonInput {
  readonly appVersion: string;
  readonly artifactRoot: string;
  readonly buildRevision: string;
  readonly candidateRoot: string;
  readonly databaseFilePath: string;
  readonly migrationsDirectory: string;
}

interface WorkspaceMigrationInspectionInput {
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
  readonly migrationsDirectory: string;
  readonly operation: 'inspectPublishedMigration';
  readonly publishedRoot: string;
}

export type WorkspaceCandidateOperation =
  | WorkspaceMigrationInspectionInput
  | (WorkspaceCandidateCommonInput & {
      readonly operation: 'bootstrapEmpty';
    })
  | (WorkspaceCandidateCommonInput & {
      readonly expectedProfileId: string;
      readonly expectedSourceMigrationChainIdentity: string;
      readonly importStagingRoot: string;
      readonly inspectionRoot: string;
      readonly operation: 'migrateBackup';
    })
  | (WorkspaceCandidateCommonInput & {
      readonly expectedProfileId: string;
      readonly importStagingRoot: string;
      readonly operation: 'validateAndMaterialize';
    })
  | (WorkspaceCandidateCommonInput & {
      readonly expectedProfileId?: string;
      readonly operation: 'validatePublished';
    })
  | (WorkspaceCandidateCommonInput & {
      readonly expectedProfileId: string;
      readonly operation: 'validateHistoricalPublished';
    });

export interface WorkspaceCandidateMigrationResult {
  readonly kind: 'migration';
  readonly migrationChainIdentity: string;
  readonly profileId: string;
}

export interface WorkspaceCandidateReadinessResult {
  readonly actorId: 'local-owner';
  readonly artifactRootHealth: 'ready';
  readonly companyId: string;
  readonly databaseHealth: 'healthy';
  readonly foreignKeyHealth: 'healthy';
  readonly kind: 'readiness';
  readonly migrationChainIdentity: string;
  readonly profileId: string;
}

export interface WorkspaceCandidateHistoricalReadinessResult {
  readonly actorId: 'local-owner';
  readonly artifactRootHealth: 'ready';
  readonly companyId: string;
  readonly databaseHealth: 'healthy';
  readonly foreignKeyHealth: 'healthy';
  readonly kind: 'historicalReadiness';
  readonly migrationChainIdentity: string;
  readonly profileId: string;
}

export type WorkspaceCandidateOperationResult =
  | PublishedWorkspaceMigrationInspection
  | WorkspaceCandidateMigrationResult
  | WorkspaceCandidateHistoricalReadinessResult
  | WorkspaceCandidateReadinessResult;

export interface WorkspaceCandidateOperationControl {
  readonly ownedLocalDatabaseRecovery?: Readonly<OwnedLocalDatabaseRecovery>;
  readonly reportInspectionClosed?: () => void;
  readonly signal?: AbortSignal;
}

const commonOperationKeys = [
  'appVersion',
  'artifactRoot',
  'buildRevision',
  'candidateRoot',
  'databaseFilePath',
  'migrationsDirectory',
] as const;

export async function runWorkspaceCandidateOperation(
  input: Readonly<WorkspaceCandidateOperation>,
  control: Readonly<WorkspaceCandidateOperationControl> = {},
): Promise<Readonly<WorkspaceCandidateOperationResult>> {
  try {
    const operation = validateOperationInput(input);
    throwIfCancelled(control.signal);
    if (operation.operation === 'inspectPublishedMigration') {
      return await inspectPublishedWorkspaceMigration(
        operation,
        control.signal,
        control.ownedLocalDatabaseRecovery,
      );
    }
    if (control.ownedLocalDatabaseRecovery !== undefined) {
      throw new Error('WORKSPACE_CANDIDATE_OPERATION_INVALID');
    }
    const paths = await validateCommonInput(operation);
    throwIfCancelled(control.signal);
    if (operation.operation === 'bootstrapEmpty') {
      await assertPathMissing(paths.databaseFilePath);
      throwIfCancelled(control.signal);
      const database = createDatabaseConnection({
        databaseFilePath: paths.databaseFilePath,
      });
      try {
        await runMigrations(database, {
          migrationsDirectory: paths.migrationsDirectory,
          releaseIdentity: readReleaseIdentity(operation),
        });
        throwIfCancelled(control.signal);
        return await readReadiness(database, paths, {
          kind: 'readiness',
          migrationPolicy: 'exactCurrentManifest',
          requirePendingMigrations: false,
          ...(control.signal === undefined ? {} : { signal: control.signal }),
        });
      } finally {
        database.close();
      }
    }

    if (operation.operation === 'migrateBackup') {
      validateSha256(operation.expectedProfileId);
      validateSha256(operation.expectedSourceMigrationChainIdentity);
      const importStagingRoot = await validatePrivateWorkspaceDirectory(
        operation.importStagingRoot,
      );
      throwIfCancelled(control.signal);
      await assertPathMissing(paths.databaseFilePath);
      const inspectionRoot = await validatePrivateWorkspaceDirectory(operation.inspectionRoot);
      if (!workspaceCandidatePathsAreEqual(dirname(inspectionRoot), paths.candidateRoot) ||
          workspaceCandidatePathsAreEqual(inspectionRoot, paths.artifactRoot) ||
          workspaceCandidatePathsAreEqual(inspectionRoot, importStagingRoot)) {
        throw new Error('WORKSPACE_CANDIDATE_INPUT_INVALID');
      }
      await assertEmptyPrivateDirectory(inspectionRoot);
      const inspectionPath = join(inspectionRoot, profileDatabaseFileName);
      const inspectedBytes = await copyAttestedWorkspaceDatabase({
        destinationPath: inspectionPath,
        sourcePath: join(importStagingRoot, profileDatabaseFileName),
        ...(control.signal === undefined ? {} : { signal: control.signal }),
      });
      await assertCopiedWorkspaceDatabaseUnchanged(inspectionPath, inspectedBytes, control.signal);
      const readOnlyDatabase = new Database(toNamespacedPath(inspectionPath), {
        fileMustExist: true, readonly: true,
      });
      let inspectionFailure: unknown;
      try {
        const source = inspectSqliteProfileConnection(readOnlyDatabase, paths.migrationsDirectory, 'restoreCompatible');
        if (source.profileId !== operation.expectedProfileId ||
            source.migrationChainIdentity !== operation.expectedSourceMigrationChainIdentity) {
          throw new Error('WORKSPACE_CANDIDATE_SOURCE_MISMATCH');
        }
        await validateProfileArtifactCatalog({
          database: readOnlyDatabase,
          operationRoot: importStagingRoot,
          schema: selectInvoiceBackupArtifactCatalogSchema(source),
        });
      } catch (error) {
        inspectionFailure = error;
        throw error;
      } finally {
        try { readOnlyDatabase.close(); }
        catch (error) {
          throw new AggregateError(
            [...(inspectionFailure === undefined ? [] : [inspectionFailure]), error],
            'WORKSPACE_CANDIDATE_DATABASE_CLOSE_FAILED',
          );
        }
        control.reportInspectionClosed?.();
      }
      // Never reopen the source or migration target read-only: a WAL snapshot
      // can create sidecars even on a read-only connection.
      const copied = await copyAttestedWorkspaceDatabase({
        destinationPath: paths.databaseFilePath,
        sourcePath: join(importStagingRoot, profileDatabaseFileName),
        expectedBytes: inspectedBytes,
        ...(control.signal === undefined ? {} : { signal: control.signal }),
      });
      await assertCopiedWorkspaceDatabaseUnchanged(paths.databaseFilePath, copied, control.signal);
      const database = createDatabaseConnection({
        databaseFilePath: paths.databaseFilePath,
        fileMustExist: true,
      });
      try {
        const source = inspectMigrationStartupState(
          database,
          paths.migrationsDirectory,
          'restoreCompatible',
        );
        const sourceProfileId = createProfileBackupIdentity(
          readLocalRuntimeIdentity(database).companyId,
        );
        if (
          source.migrationChainIdentity !==
            operation.expectedSourceMigrationChainIdentity ||
          sourceProfileId !== operation.expectedProfileId
        ) {
          throw new Error('WORKSPACE_CANDIDATE_SOURCE_MISMATCH');
        }
        throwIfCancelled(control.signal);
        await runMigrations(database, {
          migrationsDirectory: paths.migrationsDirectory,
          releaseIdentity: readReleaseIdentity(operation),
        });
        throwIfCancelled(control.signal);
        const current = inspectMigrationStartupState(
          database,
          paths.migrationsDirectory,
        );
        const profileId = createProfileBackupIdentity(
          readLocalRuntimeIdentity(database).companyId,
        );
        if (
          current.pendingMigrationCount !== 0 ||
          profileId !== operation.expectedProfileId
        ) {
          throw new Error('WORKSPACE_CANDIDATE_MIGRATION_INVALID');
        }
        return Object.freeze({
          kind: 'migration',
          migrationChainIdentity: current.migrationChainIdentity,
          profileId,
        });
      } finally {
        database.close();
      }
    }

    const expectedProfileId = operation.expectedProfileId;
    if (expectedProfileId !== undefined) validateSha256(expectedProfileId);
    throwIfCancelled(control.signal);
    // Attest before writable admission; the normal close still owns WAL cleanup.
    const database = openAttestedMigrationDatabase({
      allowCreate: false,
      allowEmpty: false,
      databaseFilePath: paths.databaseFilePath,
      migrationsDirectory: paths.migrationsDirectory,
      policy: operation.operation === 'validateHistoricalPublished'
        ? 'restoreCompatible' : 'exactCurrentManifest',
    });
    let validationFailed = false;
    let validationFailure: unknown;
    try {
      if (operation.operation === 'validateHistoricalPublished') {
        const readiness = await readReadiness(database, paths, {
          kind: 'historicalReadiness',
          migrationPolicy: 'restoreCompatible',
          requirePendingMigrations: true,
          ...(control.signal === undefined
            ? {}
            : { signal: control.signal }),
        });
        if (readiness.profileId !== expectedProfileId) {
          throw new Error('WORKSPACE_CANDIDATE_PROFILE_MISMATCH');
        }
        return readiness;
      }

      const current = inspectMigrationStartupState(
        database,
        paths.migrationsDirectory,
      );
      if (current.pendingMigrationCount !== 0) {
        throw new Error('WORKSPACE_CANDIDATE_MIGRATIONS_PENDING');
      }
      throwIfCancelled(control.signal);

      if (operation.operation === 'validateAndMaterialize') {
        const importStagingRoot = await validatePrivateWorkspaceDirectory(
          operation.importStagingRoot,
        );
        await assertEmptyPrivateDirectory(paths.artifactRoot);
        throwIfCancelled(control.signal);
        const artifacts = await validateProfileArtifactCatalog({
          database,
          operationRoot: importStagingRoot,
          schema: selectInvoiceBackupArtifactCatalogSchema(current),
        });
        throwIfCancelled(control.signal);
        await materializeValidatedProfileArtifacts({
          artifacts: artifacts.artifacts,
          destinationRoot: paths.artifactRoot,
          sourceRoot: importStagingRoot,
        });
        throwIfCancelled(control.signal);
      }

      const readiness = await readReadiness(database, paths, {
        kind: 'readiness',
        migrationPolicy: 'exactCurrentManifest',
        requirePendingMigrations: false,
        ...(control.signal === undefined ? {} : { signal: control.signal }),
      });
      if (
        expectedProfileId !== undefined &&
        readiness.profileId !== expectedProfileId
      ) {
        throw new Error('WORKSPACE_CANDIDATE_PROFILE_MISMATCH');
      }
      return readiness;
    } catch (error) {
      validationFailed = true;
      validationFailure = error;
      throw error;
    } finally {
      try { database.close(); }
      catch (error) {
        throw new AggregateError(
          validationFailed ? [validationFailure, error] : [error],
          'WORKSPACE_CANDIDATE_DATABASE_CLOSE_FAILED',
          { cause: validationFailed ? validationFailure : error },
        );
      }
    }
  } catch (error) {
    throw new Error('WORKSPACE_CANDIDATE_OPERATION_FAILED', { cause: error });
  }
}

function validateOperationInput(
  input: unknown,
): Readonly<WorkspaceCandidateOperation> {
  if (!isRecord(input)) {
    throw new Error('WORKSPACE_CANDIDATE_INPUT_INVALID');
  }

  const operationKeys = (() => {
    switch (input.operation) {
      case 'bootstrapEmpty':
        return [...commonOperationKeys, 'operation'];
      case 'migrateBackup':
        return [
          ...commonOperationKeys,
          'expectedProfileId',
          'expectedSourceMigrationChainIdentity',
          'importStagingRoot',
          'inspectionRoot',
          'operation',
        ];
      case 'validateAndMaterialize':
        return [
          ...commonOperationKeys,
          'expectedProfileId',
          'importStagingRoot',
          'operation',
        ];
      case 'validatePublished':
        return 'expectedProfileId' in input
          ? [...commonOperationKeys, 'expectedProfileId', 'operation']
          : [...commonOperationKeys, 'operation'];
      case 'validateHistoricalPublished':
        return [...commonOperationKeys, 'expectedProfileId', 'operation'];
      case 'inspectPublishedMigration':
        return [
          'appVersion',
          'buildRevision',
          'databaseFilePath',
          'expectedProfileId',
          'migrationsDirectory',
          'operation',
          'publishedRoot',
        ];
      default:
        throw new Error('WORKSPACE_CANDIDATE_OPERATION_INVALID');
    }
  })();

  if (!hasExactKeys(input, operationKeys)) {
    throw new Error('WORKSPACE_CANDIDATE_INPUT_INVALID');
  }
  return input as unknown as Readonly<WorkspaceCandidateOperation>;
}

async function readReadiness(
  database: DatabaseConnection,
  paths: Readonly<ValidatedCandidatePaths>,
  options: Readonly<{
    kind: 'historicalReadiness' | 'readiness';
    migrationPolicy: MigrationStartupPolicy;
    requirePendingMigrations: boolean;
    signal?: AbortSignal;
  }> = {
    kind: 'readiness',
    migrationPolicy: 'exactCurrentManifest',
    requirePendingMigrations: false,
  },
): Promise<
  Readonly<
    | WorkspaceCandidateHistoricalReadinessResult
    | WorkspaceCandidateReadinessResult
  >
> {
  throwIfCancelled(options.signal);
  const migration = inspectMigrationStartupState(
    database,
    paths.migrationsDirectory,
    options.migrationPolicy,
  );
  if (
    (options.requirePendingMigrations &&
      (migration.profileState !== 'existing' ||
        migration.pendingMigrationCount === 0)) ||
    (!options.requirePendingMigrations && migration.pendingMigrationCount !== 0)
  ) {
    throw new Error('WORKSPACE_CANDIDATE_MIGRATIONS_PENDING');
  }
  const identity = readLocalRuntimeIdentity(database);
  if (identity.actorId !== 'local-owner') {
    throw new Error('WORKSPACE_CANDIDATE_IDENTITY_INVALID');
  }
  const active = await new CurrentActiveProfileValidationService(
    database,
    paths.artifactRoot,
    () => migration,
  ).validateActiveProfile();
  throwIfCancelled(options.signal);
  const profileId = createProfileBackupIdentity(identity.companyId);
  if (active.profileId !== profileId) {
    throw new Error('WORKSPACE_CANDIDATE_PROFILE_INVALID');
  }
  return Object.freeze({
    actorId: 'local-owner',
    artifactRootHealth: 'ready',
    companyId: identity.companyId,
    databaseHealth: 'healthy',
    foreignKeyHealth: 'healthy',
    kind: options.kind,
    migrationChainIdentity: migration.migrationChainIdentity,
    profileId,
  });
}

interface ValidatedCandidatePaths {
  readonly artifactRoot: string;
  readonly candidateRoot: string;
  readonly databaseFilePath: string;
  readonly migrationsDirectory: string;
}

async function validateCommonInput(
  input: Readonly<WorkspaceCandidateCommonInput>,
): Promise<Readonly<ValidatedCandidatePaths>> {
  if (
    typeof input.appVersion !== 'string' ||
    typeof input.buildRevision !== 'string' ||
    !boundedReleaseValuePattern.test(input.appVersion) ||
    !boundedReleaseValuePattern.test(input.buildRevision)
  ) {
    throw new Error('WORKSPACE_CANDIDATE_RELEASE_INVALID');
  }
  const candidateRoot = await validatePrivateWorkspaceDirectory(
    input.candidateRoot,
  );
  const migrationsDirectory = await validateTrustedReadOnlyCodeDirectory(
    input.migrationsDirectory,
  );
  const databaseFilePath = resolveAbsoluteWorkspaceCandidatePath(
    input.databaseFilePath,
  );
  const artifactRoot = await validatePrivateWorkspaceDirectory(
    input.artifactRoot,
  );
  assertWorkspaceCandidateContainedPath(candidateRoot, databaseFilePath);
  assertWorkspaceCandidateContainedPath(candidateRoot, artifactRoot);
  return Object.freeze({
    artifactRoot,
    candidateRoot,
    databaseFilePath,
    migrationsDirectory,
  });
}

function readReleaseIdentity(input: Readonly<WorkspaceCandidateCommonInput>) {
  return Object.freeze({
    appVersion: input.appVersion,
    buildRevision: input.buildRevision,
  });
}

async function assertEmptyPrivateDirectory(path: string): Promise<void> {
  const directory = await validatePrivateWorkspaceDirectory(path);
  if ((await fileSystem.readdir(directory)).length !== 0) {
    throw new Error('WORKSPACE_CANDIDATE_ARTIFACT_ROOT_NOT_EMPTY');
  }
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await fileSystem.lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('WORKSPACE_CANDIDATE_PATH_EXISTS');
}

function validateSha256(value: string): void {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    throw new Error('WORKSPACE_CANDIDATE_IDENTITY_INVALID');
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error('WORKSPACE_CANDIDATE_OPERATION_CANCELLED');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
