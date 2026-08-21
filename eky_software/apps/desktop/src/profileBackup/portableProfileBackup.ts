import { randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { writeBackupContainer } from './container/backupContainerWriter.js';
import { createProfileBackupSourceEntries } from './createProfileBackupSourceEntries.js';
import {
  finalizePortableProfileBackup,
  PortableBackupFinalizationError,
} from './finalizePortableProfileBackup.js';
import {
  inspectEncryptedProfileBackup,
  ProfileBackupInspectionError,
  type ProfileBackupInspectionSummary,
} from './inspectEncryptedProfileBackup.js';
import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import type {
  ProfileBackupOperationState,
  ProfileBackupStatus,
} from './portableProfileBackupTypes.js';

const portableBackupExtension = '.ekybackup';
const temporaryFileSuffix = '.partial';

export type PortableProfileBackupErrorCode =
  | 'PROFILE_BACKUP_BUSY'
  | 'PROFILE_BACKUP_CREATE_FAILED'
  | 'PROFILE_BACKUP_DESTINATION_INVALID'
  | 'PROFILE_BACKUP_INSPECTION_FAILED';

export class PortableProfileBackupError extends Error {
  constructor(readonly code: PortableProfileBackupErrorCode) {
    super(code);
    this.name = 'PortableProfileBackupError';
  }
}

interface PortableProfileBackupDependencies {
  appVersion: string;
  forbiddenRoots: readonly string[];
  initialLatestSuccessfulPortableBackupAt?: string;
  now?(): Date;
  operationIdFactory?(): string;
  recordSuccessfulBackup?(input: {
    appVersion: string;
    backupFormatVersion: 1;
    completedAt: string;
    validationStatus: 'validated';
  }): Promise<void>;
  profileSnapshotClient: Pick<
    ProfileSnapshotBrokerClient,
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
  >;
  quarantineRoot: string;
  stagingRoot: string;
}

export class PortableProfileBackupService {
  private lastSafeErrorCode: string | undefined;
  private latestSuccessfulPortableBackupAt: string | undefined;
  private operationState: ProfileBackupOperationState = 'idle';

  constructor(
    private readonly dependencies: PortableProfileBackupDependencies,
  ) {
    this.latestSuccessfulPortableBackupAt =
      dependencies.initialLatestSuccessfulPortableBackupAt;
  }

  async create(input: {
    destinationPath: string;
    password: string;
  }): Promise<ProfileBackupInspectionSummary> {
    return this.runExclusive('creating', async () => {
      const destinationPath = await resolveSafeDestinationPath(
        input.destinationPath,
        this.dependencies.forbiddenRoots,
      );
      const operationId = this.createOperationId();
      const inspectionOperationId = this.createOperationId();
      const operationRoot = join(
        this.dependencies.stagingRoot,
        operationId,
      );
      const temporaryPath = join(
        dirname(destinationPath),
        `.${basename(destinationPath)}.${this.createOperationId()}${temporaryFileSuffix}`,
      );
      let maintenanceStarted = false;
      let finalized = false;
      let completed = false;

      try {
        await this.dependencies.profileSnapshotClient.beginMaintenance(
          operationId,
        );
        maintenanceStarted = true;
        await this.dependencies.profileSnapshotClient.createProfileSnapshot(
          operationId,
          'exactCurrentManifest',
        );
        const validation =
          await this.dependencies.profileSnapshotClient.validateProfileSnapshot(
            operationId,
          );
        if (!validation.profileMatchesActive) {
          throw new Error('PROFILE_BACKUP_SOURCE_PROFILE_INVALID');
        }

        const entries =
          await createProfileBackupSourceEntries(operationRoot);
        await writeBackupContainer({
          destinationPath: temporaryPath,
          entries,
          manifest: {
            appVersion: this.dependencies.appVersion,
            createdAtEpochMilliseconds: BigInt(this.now().getTime()),
            migrationChainIdentity:
              validation.migrationChainIdentity,
            profileId: validation.profileId,
          },
          password: input.password,
        });
        await finalizePortableProfileBackup(
          temporaryPath,
          destinationPath,
        );
        finalized = true;
        await fileSystem.rm(temporaryPath, { force: true });

        const summary = await inspectEncryptedProfileBackup({
          containerPath: destinationPath,
          operationId: inspectionOperationId,
          password: input.password,
          quarantineRoot: this.dependencies.quarantineRoot,
          stagingRoot: this.dependencies.stagingRoot,
          validator: this.dependencies.profileSnapshotClient,
        });
        if (
          summary.profileMatchStatus !== 'same' ||
          summary.databaseHealth !== 'healthy' ||
          summary.documentCount !== validation.artifactCount
        ) {
          throw new Error('PROFILE_BACKUP_SELF_INSPECTION_FAILED');
        }

        await this.dependencies.profileSnapshotClient.endMaintenance(
          operationId,
        );
        maintenanceStarted = false;
        completed = true;
        const completedAt = this.now().toISOString();
        this.latestSuccessfulPortableBackupAt = completedAt;
        await this.dependencies
          .recordSuccessfulBackup?.({
            appVersion: summary.appVersion,
            backupFormatVersion: summary.formatVersion,
            completedAt,
            validationStatus: 'validated',
          })
          .catch(() => undefined);
        return summary;
      } catch (error) {
        if (
          error instanceof PortableBackupFinalizationError &&
          error.code === 'destinationExists'
        ) {
          throw new PortableProfileBackupError(
            'PROFILE_BACKUP_DESTINATION_INVALID',
          );
        }
        if (
          error instanceof PortableProfileBackupError ||
          error instanceof ProfileBackupInspectionError
        ) {
          throw error;
        }
        throw new PortableProfileBackupError(
          'PROFILE_BACKUP_CREATE_FAILED',
        );
      } finally {
        if (maintenanceStarted) {
          await this.dependencies.profileSnapshotClient
            .endMaintenance(operationId)
            .catch(() => undefined);
        }
        await Promise.all([
          fileSystem
            .rm(operationRoot, { force: true, recursive: true })
            .catch(() => undefined),
          fileSystem
            .rm(temporaryPath, { force: true })
            .catch(() => undefined),
        ]);
        if (finalized && !completed) {
          await fileSystem
            .rm(destinationPath, { force: true })
            .catch(() => undefined);
        }
      }
    });
  }

  getStatus(): ProfileBackupStatus {
    return {
      ...(this.lastSafeErrorCode === undefined
        ? {}
        : { lastSafeErrorCode: this.lastSafeErrorCode }),
      ...(this.latestSuccessfulPortableBackupAt === undefined
        ? {}
        : {
            latestSuccessfulPortableBackupAt:
              this.latestSuccessfulPortableBackupAt,
          }),
      operationState: this.operationState,
    };
  }

  async inspect(input: {
    containerPath: string;
    password: string;
  }): Promise<ProfileBackupInspectionSummary> {
    return this.runExclusive('inspecting', async () => {
      try {
        return await inspectEncryptedProfileBackup({
          containerPath: input.containerPath,
          operationId: this.createOperationId(),
          password: input.password,
          quarantineRoot: this.dependencies.quarantineRoot,
          stagingRoot: this.dependencies.stagingRoot,
          validator: this.dependencies.profileSnapshotClient,
        });
      } catch (error) {
        if (error instanceof ProfileBackupInspectionError) {
          throw error;
        }
        throw new PortableProfileBackupError(
          'PROFILE_BACKUP_INSPECTION_FAILED',
        );
      }
    });
  }

  private createOperationId(): string {
    return this.dependencies.operationIdFactory?.() ?? randomUUID();
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }

  private async runExclusive<T>(
    operationState: Exclude<ProfileBackupOperationState, 'idle'>,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.operationState !== 'idle') {
      throw new PortableProfileBackupError('PROFILE_BACKUP_BUSY');
    }
    this.operationState = operationState;
    this.lastSafeErrorCode = undefined;

    try {
      return await operation();
    } catch (error) {
      this.lastSafeErrorCode = readSafeErrorCode(error);
      throw error;
    } finally {
      this.operationState = 'idle';
    }
  }
}

export function createPortableProfileBackupFileName(now: Date): string {
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `Eky-varmuuskopio-${year}-${month}-${day}${portableBackupExtension}`;
}

export function ensurePortableProfileBackupExtension(path: string): string {
  return path.toLowerCase().endsWith(portableBackupExtension)
    ? path
    : `${path}${portableBackupExtension}`;
}

async function resolveSafeDestinationPath(
  selectedPath: string,
  forbiddenRoots: readonly string[],
): Promise<string> {
  if (!isAbsolute(selectedPath)) {
    throw new PortableProfileBackupError(
      'PROFILE_BACKUP_DESTINATION_INVALID',
    );
  }
  const destinationPath = resolve(
    ensurePortableProfileBackupExtension(selectedPath),
  );
  const destinationDirectory = dirname(destinationPath);
  const directoryMetadata = await fileSystem
    .lstat(destinationDirectory)
    .catch(() => undefined);
  if (
    directoryMetadata === undefined ||
    !directoryMetadata.isDirectory() ||
    directoryMetadata.isSymbolicLink()
  ) {
    throw new PortableProfileBackupError(
      'PROFILE_BACKUP_DESTINATION_INVALID',
    );
  }
  const realDirectory = await fileSystem.realpath(destinationDirectory);
  if (!pathsAreEqual(realDirectory, destinationDirectory)) {
    throw new PortableProfileBackupError(
      'PROFILE_BACKUP_DESTINATION_INVALID',
    );
  }
  if (
    forbiddenRoots.some((root) =>
      isAtOrBelow(root, destinationPath),
    )
  ) {
    throw new PortableProfileBackupError(
      'PROFILE_BACKUP_DESTINATION_INVALID',
    );
  }

  try {
    await fileSystem.lstat(destinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return destinationPath;
    }
    throw new PortableProfileBackupError(
      'PROFILE_BACKUP_DESTINATION_INVALID',
    );
  }
  throw new PortableProfileBackupError(
    'PROFILE_BACKUP_DESTINATION_INVALID',
  );
}

function isAtOrBelow(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== '..' &&
      !isAbsolute(relativePath))
  );
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

function readSafeErrorCode(error: unknown): string {
  if (
    error instanceof PortableProfileBackupError ||
    error instanceof ProfileBackupInspectionError
  ) {
    return error.code;
  }
  return 'PROFILE_BACKUP_OPERATION_FAILED';
}
