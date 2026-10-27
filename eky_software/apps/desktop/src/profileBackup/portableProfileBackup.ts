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
  inspectEncryptedProfileBackupContent,
  type InspectedDeletionBackupContent,
  ProfileBackupInspectionError,
  type ProfileBackupInspectionSummary,
} from './inspectEncryptedProfileBackup.js';
import type { ProfileSnapshotInspectionPort, ProfileDeletionSnapshotEvidencePort } from './profileSnapshotInspectionPort.js';
import type { ProfileInspectionReceipt, ProfileInspectionRequestIdentity } from '../runtime/profileInspectionMessages.js';
import { assertDeletionBackupCorrespondence } from './assertDeletionBackupCorrespondence.js';
import { PortableProfileBackupCleanupError, PortableProfileBackupError } from './portableProfileBackupError.js';
export { PortableProfileBackupCleanupError, PortableProfileBackupError, type PortableProfileBackupErrorCode } from './portableProfileBackupError.js';
import type {
  ProfileBackupOperationState,
  ProfileBackupStatus,
} from './portableProfileBackupTypes.js';

const portableBackupExtension = '.ekybackup';
const temporaryFileSuffix = '.partial';
const backupFileNameLabelMaxBytes = 120;

// Main's caller owns the named fence and exact installation lease for this scope.
export interface DeletionBackupPreparationOwner {
  readonly operationId: string;
  assertCurrent(): Promise<void>;
  assertValid(): void;
}
export interface DeletionBackupContent {
  readonly sourceReceipt: ProfileInspectionReceipt;
  readonly sourceIdentity: ProfileInspectionRequestIdentity;
  readonly exported: InspectedDeletionBackupContent;
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
    ProfileSnapshotInspectionPort,
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
    | 'withInspectionOperation'
    | 'withProfileSnapshot'
    | 'removeProfileSnapshot'
  > & Partial<ProfileDeletionSnapshotEvidencePort>;
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
    return (await this.createShared(input)).summary;
  }

  async createForDeletion(input: { destinationPath: string; password: string },
    owner: DeletionBackupPreparationOwner): Promise<DeletionBackupContent> {
    const result = await this.createShared(input, owner);
    try { owner.assertValid(); }
    catch (error) { throw new PortableProfileBackupError('PROFILE_BACKUP_CREATE_FAILED', { cause: error }); }
    if (result.content === undefined) throw new Error('PROFILE_BACKUP_CONTENT_MISSING');
    return result.content;
  }

  private async createShared(input: { destinationPath: string; password: string },
    owner?: DeletionBackupPreparationOwner): Promise<{
      summary: ProfileBackupInspectionSummary; content?: DeletionBackupContent;
    }> {
    let authorityInvalid = false;
    const assertOwner = async () => {
      if (authorityInvalid) throw new Error('PROFILE_BACKUP_AUTHORITY_INVALID');
      if (owner === undefined) return;
      try { owner.assertValid(); await owner.assertCurrent(); owner.assertValid(); }
      catch (error) { authorityInvalid = true; throw error; }
    };
    return this.runExclusive('creating', async () => {
      await assertOwner();
      const client = this.dependencies.profileSnapshotClient;
      const withEvidence = client.withProfileSnapshotEvidence?.bind(client);
      const validateDeletion = client.validateDeletionProfileSnapshot?.bind(client);
      if (owner !== undefined && (withEvidence === undefined || validateDeletion === undefined)) {
        throw new PortableProfileBackupError('PROFILE_BACKUP_CREATE_FAILED', {
          cause: new Error('PROFILE_BACKUP_EVIDENCE_PORT_MISSING'),
        });
      }
      let sourceIdentity: ProfileInspectionRequestIdentity | undefined;
      // The export has its own inspection ID but shares the caller's write fence.
      const exportValidator = owner === undefined ? undefined : {
        validateProfileSnapshot: (id: string) => validateDeletion!(id, owner.operationId),
        removeProfileSnapshot: client.removeProfileSnapshot.bind(client),
        withProfileSnapshotEvidence: withEvidence!,
      };
      const withSource = <T>(id: string, use: (
        receipt: ProfileInspectionReceipt, assertCurrent?: () => Promise<void>,
      ) => Promise<T>): Promise<T> => owner === undefined
        ? client.withProfileSnapshot(id, receipt => use(receipt))
        : withEvidence!(id, async (evidence, assertCurrent) => {
            sourceIdentity = evidence.identity;
            return use(evidence.receipt, assertCurrent);
          });
      const destinationPath = await resolveSafeDestinationPath(
        input.destinationPath,
        this.dependencies.forbiddenRoots,
      );
      await assertOwner();
      const operationId = owner?.operationId ?? this.createOperationId();
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
      let verifiedExport = false;
      let content: DeletionBackupContent | undefined;
      let sourceCleanup: 'notAttempted' | 'completed' | 'unverified' = 'notAttempted';
      let firstFailure: unknown;
      let cleanupFailure: unknown;

      try {
        if (owner === undefined) {
          await this.dependencies.profileSnapshotClient.beginMaintenance(operationId);
          maintenanceStarted = true;
        }
        await assertOwner();
        await this.dependencies.profileSnapshotClient.createProfileSnapshot(
          operationId,
          'exactCurrentManifest',
        );
        await assertOwner();
        const validation = owner === undefined
          ? await client.validateProfileSnapshot(operationId)
          : await validateDeletion!(operationId, owner.operationId);
        await assertOwner();
        if (!validation.profileMatchesActive) {
          throw new Error('PROFILE_BACKUP_SOURCE_PROFILE_INVALID');
        }

        const summary = await withSource(
          operationId,
          async (receipt, assertSnapshotCurrent) => {
            if (owner !== undefined) {
              if (assertSnapshotCurrent === undefined) throw new Error('PROFILE_BACKUP_EVIDENCE_PORT_MISSING');
              await assertSnapshotCurrent();
              await assertOwner();
              if (receipt.migrationPolicy !== 'exactCurrentManifest' || receipt.profileId !== validation.profileId ||
                  receipt.migrationChainIdentity !== validation.migrationChainIdentity) {
                throw new Error('PROFILE_BACKUP_SOURCE_RECEIPT_INVALID');
              }
            }
            const entries = await createProfileBackupSourceEntries(operationRoot);
            await assertOwner();
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
            await assertOwner();
            await finalizePortableProfileBackup(temporaryPath, destinationPath);
            finalized = true;
            await assertOwner();
            await fileSystem.rm(temporaryPath, { force: true });

            const inspectionInput = {
              containerPath: destinationPath,
              operationId: inspectionOperationId,
              password: input.password,
              quarantineRoot: this.dependencies.quarantineRoot,
              stagingRoot: this.dependencies.stagingRoot,
            };
            const exported = exportValidator === undefined ? undefined
              : await inspectEncryptedProfileBackupContent({ ...inspectionInput, validator: exportValidator,
                  onContentValidated(candidate) {
                    if (sourceIdentity === undefined || sourceIdentity.operationId !== operationId ||
                        candidate.identity.operationId !== inspectionOperationId ||
                        sourceIdentity.generationId === candidate.identity.generationId ||
                        sourceIdentity.runtimeSession === candidate.identity.runtimeSession) {
                      throw new Error('PROFILE_BACKUP_INSPECTION_IDENTITY_INVALID');
                    }
                    if (candidate.receipt.migrationPolicy !== 'restoreCompatible') throw new Error('PROFILE_BACKUP_EXPORT_POLICY_INVALID');
                    assertDeletionBackupCorrespondence(receipt, candidate.receipt);
                    if (candidate.summary.profileMatchStatus !== 'same' || candidate.summary.databaseHealth !== 'healthy' ||
                        candidate.summary.documentCount !== validation.artifactCount) {
                      throw new Error('PROFILE_BACKUP_SELF_INSPECTION_FAILED');
                    }
                    verifiedExport = true;
                  },
                });
            const inspected = exported?.summary ?? await inspectEncryptedProfileBackup({ ...inspectionInput, validator: client });
            if (
              inspected.profileMatchStatus !== 'same' ||
              inspected.databaseHealth !== 'healthy' ||
              inspected.documentCount !== validation.artifactCount
            ) {
              throw new Error('PROFILE_BACKUP_SELF_INSPECTION_FAILED');
            }
            if (exported !== undefined) {
              if (sourceIdentity === undefined) throw new Error('PROFILE_BACKUP_INSPECTION_IDENTITY_INVALID');
              content = Object.freeze({ sourceReceipt: Object.freeze({ ...receipt,
                database: Object.freeze({ ...receipt.database }), artifactCatalog: Object.freeze({ ...receipt.artifactCatalog }) }),
                sourceIdentity, exported: Object.freeze(exported) });
              await assertSnapshotCurrent!();
            }
            await assertOwner();
            return inspected;
          },
        );

        sourceCleanup = 'unverified';
        await this.dependencies.profileSnapshotClient.removeProfileSnapshot(operationId);
        sourceCleanup = 'completed';
        await assertOwner();
        if (owner === undefined) {
          await this.dependencies.profileSnapshotClient.endMaintenance(operationId);
          maintenanceStarted = false;
        }
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
        await assertOwner();
        return { summary, ...(content === undefined ? {} : { content }) };
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
        if (finalized && !completed && !verifiedExport) {
          await fileSystem
            .rm(destinationPath, { force: true })
            .catch(() => undefined);
        }
        if (sourceCleanup === 'unverified') {
          throw new PortableProfileBackupCleanupError(firstFailure ?? cleanupFailure);
        }
      }
    }, owner === undefined ? undefined : assertOwner);
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
    assertSettledOwner?: () => Promise<void>,
  ): Promise<T> {
    if (this.operationState !== 'idle') {
      throw new PortableProfileBackupError('PROFILE_BACKUP_BUSY');
    }
    this.operationState = operationState;
    this.lastSafeErrorCode = undefined;

    try {
      const value = await this.dependencies.profileSnapshotClient.withInspectionOperation(operation);
      // The operation's finally and the inspection scope can both await owned work.
      if (assertSettledOwner !== undefined) {
        try { await assertSettledOwner(); }
        catch (error) { throw new PortableProfileBackupError('PROFILE_BACKUP_CREATE_FAILED', { cause: error }); }
      }
      return value;
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
