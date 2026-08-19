import {
  constants as fileSystemConstants,
  promises as fileSystem,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { createDatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import { inspectMigrationStartupState } from '../../database/migration/inspectMigrationStartupState.js';
import { runMigrations } from '../../database/migration/runMigrations.js';
import { materializeValidatedProfileArtifacts } from '../profileSnapshot/materializeValidatedProfileArtifacts.js';
import { createProfileBackupIdentity } from '../profileSnapshot/inspectSqliteProfileDatabase.js';
import { CurrentActiveProfileValidationService } from '../profileSnapshot/validateActiveProfile.js';
import { validateProfileArtifactCatalog } from '../profileSnapshot/validateProfileArtifactCatalog.js';
import {
  assertWorkspaceCandidateContainedPath,
  resolveAbsoluteWorkspaceCandidatePath,
  validatePrivateWorkspaceDirectory,
  validateTrustedReadOnlyCodeDirectory,
  workspaceCandidatePathsAreEqual,
} from './workspaceCandidatePathPolicy.js';

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

export type WorkspaceCandidateOperation =
  | (WorkspaceCandidateCommonInput & {
      readonly operation: 'bootstrapEmpty';
    })
  | (WorkspaceCandidateCommonInput & {
      readonly expectedProfileId: string;
      readonly expectedSourceMigrationChainIdentity: string;
      readonly importStagingRoot: string;
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

export type WorkspaceCandidateOperationResult =
  | WorkspaceCandidateMigrationResult
  | WorkspaceCandidateReadinessResult;

export interface WorkspaceCandidateOperationControl {
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
        return await readReadiness(database, paths, control.signal);
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
      await copyPrivateDatabase({
        destinationPath: paths.databaseFilePath,
        sourcePath: join(importStagingRoot, profileDatabaseFileName),
      });
      throwIfCancelled(control.signal);
      const database = createDatabaseConnection({
        databaseFilePath: paths.databaseFilePath,
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
    const database = createDatabaseConnection({
      databaseFilePath: paths.databaseFilePath,
    });
    try {
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
        });
        throwIfCancelled(control.signal);
        await materializeValidatedProfileArtifacts({
          artifacts: artifacts.artifacts,
          destinationRoot: paths.artifactRoot,
          sourceRoot: importStagingRoot,
        });
        throwIfCancelled(control.signal);
      }

      const readiness = await readReadiness(
        database,
        paths,
        control.signal,
      );
      if (
        expectedProfileId !== undefined &&
        readiness.profileId !== expectedProfileId
      ) {
        throw new Error('WORKSPACE_CANDIDATE_PROFILE_MISMATCH');
      }
      return readiness;
    } finally {
      database.close();
    }
  } catch {
    throw new Error('WORKSPACE_CANDIDATE_OPERATION_FAILED');
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
  signal?: AbortSignal,
): Promise<Readonly<WorkspaceCandidateReadinessResult>> {
  throwIfCancelled(signal);
  const migration = inspectMigrationStartupState(
    database,
    paths.migrationsDirectory,
  );
  if (migration.pendingMigrationCount !== 0) {
    throw new Error('WORKSPACE_CANDIDATE_MIGRATIONS_PENDING');
  }
  const identity = readLocalRuntimeIdentity(database);
  if (identity.actorId !== 'local-owner') {
    throw new Error('WORKSPACE_CANDIDATE_IDENTITY_INVALID');
  }
  const active = await new CurrentActiveProfileValidationService(
    database,
    paths.artifactRoot,
    () => migration.migrationChainIdentity,
  ).validateActiveProfile();
  throwIfCancelled(signal);
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
    kind: 'readiness',
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

async function copyPrivateDatabase(input: {
  readonly destinationPath: string;
  readonly sourcePath: string;
}): Promise<void> {
  const sourcePath = resolveAbsoluteWorkspaceCandidatePath(input.sourcePath);
  const sourceMetadata = await fileSystem.lstat(sourcePath);
  if (
    !sourceMetadata.isFile() ||
    sourceMetadata.isSymbolicLink() ||
    sourceMetadata.nlink !== 1 ||
    sourceMetadata.size < 1 ||
    !workspaceCandidatePathsAreEqual(
      await fileSystem.realpath(sourcePath),
      sourcePath,
    )
  ) {
    throw new Error('WORKSPACE_CANDIDATE_DATABASE_INVALID');
  }

  await createPrivateDirectoryTree(dirname(input.destinationPath));
  let completed = false;
  try {
    const source = await fileSystem.open(
      sourcePath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    );
    try {
      const destination = await fileSystem.open(
        input.destinationPath,
        fileSystemConstants.O_CREAT |
          fileSystemConstants.O_EXCL |
          fileSystemConstants.O_WRONLY,
        0o600,
      );
      try {
        for await (const chunk of source.createReadStream({
          autoClose: false,
        })) {
          await writeCompleteBuffer(destination, chunk as Buffer);
        }
        await destination.sync();
      } finally {
        await destination.close();
      }
    } finally {
      await source.close();
    }

    const destinationMetadata = await fileSystem.lstat(
      input.destinationPath,
    );
    if (
      !destinationMetadata.isFile() ||
      destinationMetadata.isSymbolicLink() ||
      destinationMetadata.nlink !== 1 ||
      destinationMetadata.size !== sourceMetadata.size
    ) {
      throw new Error('WORKSPACE_CANDIDATE_DATABASE_INVALID');
    }
    completed = true;
  } finally {
    if (!completed) {
      await fileSystem
        .rm(input.destinationPath, { force: true })
        .catch(() => undefined);
    }
  }
}

async function writeCompleteBuffer(
  destination: Awaited<ReturnType<typeof fileSystem.open>>,
  content: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < content.byteLength) {
    const { bytesWritten } = await destination.write(
      content,
      offset,
      content.byteLength - offset,
    );
    if (bytesWritten < 1) {
      throw new Error('WORKSPACE_CANDIDATE_DATABASE_INVALID');
    }
    offset += bytesWritten;
  }
}

async function createPrivateDirectoryTree(path: string): Promise<void> {
  await fileSystem.mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await fileSystem.chmod(path, 0o700);
  await validatePrivateWorkspaceDirectory(path);
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
