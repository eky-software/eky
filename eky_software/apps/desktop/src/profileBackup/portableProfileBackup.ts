import { randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { writeBackupContainer } from './container/backupContainerWriter.js';
import { assertProfileBackupSourceReceipt, createProfileBackupSourceEntries } from './createProfileBackupSourceEntries.js';
import {
  finalizePortableProfileBackup,
  PortableBackupFinalizationError,
} from './finalizePortableProfileBackup.js';
import {
  inspectEncryptedProfileBackup,
  ProfileBackupInspectionError,
  type ProfileBackupInspectionSummary,
} from './inspectEncryptedProfileBackup.js';
import type { ProfileSnapshotInspectionPort } from './profileSnapshotInspectionPort.js';
import { PortableProfileBackupCleanupError, PortableProfileBackupError } from './portableProfileBackupError.js';
export { PortableProfileBackupCleanupError, PortableProfileBackupError, type PortableProfileBackupErrorCode } from './portableProfileBackupError.js';
import type {
  ProfileBackupOperationState,
  ProfileBackupStatus,
} from './portableProfileBackupTypes.js';

const portableBackupExtension = '.ekybackup';
const temporaryFileSuffix = '.partial';
const backupFileNameLabelMaxBytes = 120;

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
    ProfileSnapshotInspectionPort,
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
    | 'withInspectionOperation'
    | 'withProfileSnapshot'
    | 'removeProfileSnapshot'
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
      let sourceCleanup: 'notAttempted' | 'completed' | 'unverified' = 'notAttempted';
      let firstFailure: unknown;
      let cleanupFailure: unknown;

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

        const summary = await this.dependencies.profileSnapshotClient.withProfileSnapshot(
          operationId,
          async receipt => {
            const entries = await createProfileBackupSourceEntries(operationRoot);
            assertProfileBackupSourceReceipt(entries, receipt);
            await writeBackupContainer({
              destinationPath: temporaryPath,
              entries,
              manifest: {
                appVersion: this.dependencies.appVersion,
                createdAtEpochMilliseconds: BigInt(this.now().getTime()),
                migrationChainIdentity: validation.migrationChainIdentity,
                profileId: validation.profileId,
              },
              password: input.password,
            });
            await finalizePortableProfileBackup(temporaryPath, destinationPath);
            finalized = true;
            await fileSystem.rm(temporaryPath, { force: true });

            const inspected = await inspectEncryptedProfileBackup({
              containerPath: destinationPath,
              operationId: inspectionOperationId,
              password: input.password,
              quarantineRoot: this.dependencies.quarantineRoot,
              stagingRoot: this.dependencies.stagingRoot,
              validator: this.dependencies.profileSnapshotClient,
            });
            if (
              inspected.profileMatchStatus !== 'same' ||
              inspected.databaseHealth !== 'healthy' ||
              inspected.documentCount !== validation.artifactCount
            ) {
              throw new Error('PROFILE_BACKUP_SELF_INSPECTION_FAILED');
            }
            return inspected;
          },
        );

        sourceCleanup = 'unverified';
        await this.dependencies.profileSnapshotClient.removeProfileSnapshot(operationId);
        sourceCleanup = 'completed';

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
        firstFailure = error;
        if (
          error instanceof PortableBackupFinalizationError &&
          error.code === 'destinationExists'
        ) {
          throw new PortableProfileBackupError(
            'PROFILE_BACKUP_DESTINATION_INVALID',
            { cause: error },
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
          { cause: error },
        );
      } finally {
        // Preserve uncertain source ownership; do not retry a failed removal.
        if (sourceCleanup === 'notAttempted') {
          sourceCleanup = 'unverified';
          try {
            await this.dependencies.profileSnapshotClient.removeProfileSnapshot(operationId);
            sourceCleanup = 'completed';
          } catch (error) {
            cleanupFailure = error;
          }
        }
        if (maintenanceStarted) {
          await this.dependencies.profileSnapshotClient
            .endMaintenance(operationId)
            .catch(() => undefined);
        }
        await fileSystem
          .rm(temporaryPath, { force: true })
          .catch(() => undefined);
        if (finalized && !completed) {
          await fileSystem
            .rm(destinationPath, { force: true })
            .catch(() => undefined);
        }
        if (sourceCleanup === 'unverified') {
          throw new PortableProfileBackupCleanupError(firstFailure ?? cleanupFailure);
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
          { cause: error },
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
      return await this.dependencies.profileSnapshotClient.withInspectionOperation(operation);
    } catch (error) {
      this.lastSafeErrorCode = readSafeErrorCode(error);
      throw error;
    } finally {
      this.operationState = 'idle';
    }
  }
}

export function createPortableProfileBackupFileName(
  now: Date,
  workspaceLabel?: string,
): string {
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const label = createBackupFileNameLabel(workspaceLabel);
  return `Eky-varmuuskopio-${label === '' ? '' : `${label}-`}${year}-${month}-${day}${portableBackupExtension}`;
}

function createBackupFileNameLabel(workspaceLabel: string | undefined): string {
  const safeLabel = (workspaceLabel ?? '').normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
  let label = '';
  for (const character of safeLabel) {
    if (Buffer.byteLength(label + character, 'utf8') > backupFileNameLabelMaxBytes) break;
    label += character;
  }
  return label.replace(/[. ]+$/gu, '');
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
