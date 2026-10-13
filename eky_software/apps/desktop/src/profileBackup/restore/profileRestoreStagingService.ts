import { randomUUID } from 'node:crypto';
import { readProfileInspectionFailureCause } from '../../runtime/profileInspectionFailure.js';
import { inspectEncryptedProfileBackupWithIdentity } from '../inspectEncryptedProfileBackup.js';
import { OwnedProfileBackupInspectionError } from '../inspectOwnedEncryptedProfileBackup.js';
import type { OwnedProfileSnapshotValidator } from '../profileSnapshotInspectionPort.js';
import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import type { RecoveryPointService } from '../recoveryPoint/recoveryPointService.js';
import type { ProfileBackupInspectionSummary } from '../profileBackupInspectionTypes.js';
import { stageValidatedProfileBackup } from '../stageValidatedProfileBackup.js';
import {
  PreparedProfileRestoreOwner,
  PreparedProfileRestoreBusyError,
  type PreparedProfileRestoreClaim,
} from './preparedProfileRestoreOwner.js';

const inspectionLifetimeMilliseconds = 10 * 60_000;
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProfileRestoreStagingErrorCode =
  | 'PROFILE_RESTORE_BUSY'
  | 'PROFILE_RESTORE_INSPECTION_EXPIRED'
  | 'PROFILE_RESTORE_SOURCE_CHANGED'
  | 'PROFILE_RESTORE_STAGING_FAILED'
  | 'PROFILE_RESTORE_TARGET_NOT_EMPTY';

export class ProfileRestoreStagingError extends Error {
  constructor(
    readonly code: ProfileRestoreStagingErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ProfileRestoreStagingError';
  }
}

export interface ProfileRestoreInspection {
  inspectionId: string;
  summary: ProfileBackupInspectionSummary;
}

export interface PreparedProfileRestore {
  operationId: string;
  summary: ProfileBackupInspectionSummary;
  targetDisposition: 'replaceActiveProfile' | 'replaceEmptyProfile';
}

interface PendingInspection {
  containerPath: string;
  containerSha256: string;
  expiresAt: number;
  summary: ProfileBackupInspectionSummary;
}

interface ProfileRestoreStagingDependencies {
  now?(): Date;
  operationIdFactory?(): string;
  observer?: ProfileRecoveryOperationalObserver;
  profileSnapshotClient: Pick<
    OwnedProfileSnapshotValidator,
    'withInspectionOperation' | 'withProfileSnapshot' |
    'removeProfileSnapshot' | 'validateProfileSnapshot'
  >;
  quarantineRoot: string;
  recoveryPointService: Pick<
    RecoveryPointService,
    'createPreRestore'
  >;
  stagingRoot: string;
}

export class ProfileRestoreStagingService {
  private busy = false;
  private cleanupUnverified = false;
  private pendingInspection:
    | (PendingInspection & { inspectionId: string })
    | undefined;
  private readonly preparedOwner = new PreparedProfileRestoreOwner();

  constructor(
    private readonly dependencies: ProfileRestoreStagingDependencies,
  ) {}

  async inspect(input: {
    containerPath: string;
    password: string;
  }): Promise<ProfileRestoreInspection> {
    const correlationId = this.createOperationId();
    const startedAt = Date.now();
    try {
      const result = await this.dependencies.profileSnapshotClient.withInspectionOperation(() => this.runExclusive(async () => {
        const inspected = await inspectEncryptedProfileBackupWithIdentity({
          containerPath: input.containerPath,
          operationId: correlationId,
          password: input.password,
          quarantineRoot: this.dependencies.quarantineRoot,
          stagingRoot: this.dependencies.stagingRoot,
          validator: this.dependencies.profileSnapshotClient,
        });

        const inspectionId = this.createOperationId();
        this.pendingInspection = {
          containerPath: input.containerPath,
          containerSha256: inspected.containerSha256,
          expiresAt: this.now().getTime() + inspectionLifetimeMilliseconds,
          inspectionId,
          summary: inspected.summary,
        };
        return { inspectionId, summary: inspected.summary };
      }));
      this.observe({
        correlationId,
        durationMs: Date.now() - startedAt,
        eventName: 'restore.inspectionCompleted',
        stage: 'inspection',
      });
      return result;
    } catch (error) {
      if (error instanceof OwnedProfileBackupInspectionError && error.cleanupStatus === 'unverified') {
        this.cleanupUnverified = true;
      }
      this.observe({
        correlationId,
        durationMs: Date.now() - startedAt,
        errorCode: readProfileInspectionFailureCause(error) ??
          readSafeStagingErrorCode(error),
        eventName: 'restore.inspectionFailed',
        retryable: false,
        sideEffectState: this.cleanupUnverified ? 'unknown' : 'none',
        stage: 'inspection',
      });
      throw error;
    }
  }

  async stage(input: {
    inspectionId: string;
    password: string;
  }): Promise<PreparedProfileRestore> {
    const correlationId = this.createOperationId();
    const startedAt = Date.now();
    try {
      const result = await this.dependencies.profileSnapshotClient.withInspectionOperation(() => this.runExclusive(async () => {
        this.withPreparedOwner(() => this.preparedOwner.assertCanStage());
        const inspection = this.takeInspection(input.inspectionId);

        await this.dependencies.recoveryPointService.createPreRestore();

        try {
          const staged = await stageValidatedProfileBackup({
            containerPath: inspection.containerPath,
            operationId: correlationId,
            password: input.password,
            quarantineRoot: this.dependencies.quarantineRoot,
            stagingRoot: this.dependencies.stagingRoot,
            validator: this.dependencies.profileSnapshotClient,
          });
          const prepared = await this.dependencies.profileSnapshotClient.withProfileSnapshot(correlationId, async () => {
            if (staged.containerSha256 !== inspection.containerSha256) {
              throw new ProfileRestoreStagingError('PROFILE_RESTORE_SOURCE_CHANGED');
            }
            if (!staged.validation.profileMatchesActive && !staged.validation.activeProfileIsEmpty) {
              throw new ProfileRestoreStagingError('PROFILE_RESTORE_TARGET_NOT_EMPTY');
            }

            const result: PreparedProfileRestore = {
              operationId: correlationId,
              summary: staged.summary,
              targetDisposition: staged.validation.profileMatchesActive
                ? 'replaceActiveProfile' : 'replaceEmptyProfile',
            };
            return result;
          });
          return this.preparedOwner.set(prepared);
        } catch (error) {
          try {
            await this.dependencies.profileSnapshotClient.removeProfileSnapshot(correlationId);
          } catch (cleanupError) {
            this.cleanupUnverified = true;
            throw new ProfileRestoreStagingError('PROFILE_RESTORE_STAGING_FAILED', {
              cause: new AggregateError([error, cleanupError], 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
            });
          }
          if (error instanceof ProfileRestoreStagingError) {
            throw error;
          }
          throw new ProfileRestoreStagingError(
            'PROFILE_RESTORE_STAGING_FAILED',
            { cause: error },
          );
        }
      }));
      this.observe({
        correlationId,
        durationMs: Date.now() - startedAt,
        eventName: 'restore.stagingCompleted',
        stage: 'staging',
      });
      return result;
    } catch (error) {
      this.observe({
        correlationId,
        durationMs: Date.now() - startedAt,
        errorCode: readProfileInspectionFailureCause(error) ??
          readSafeStagingErrorCode(error),
        eventName: 'restore.stagingFailed',
        retryable: false,
        sideEffectState: this.cleanupUnverified ? 'unknown' : 'none',
        stage: 'staging',
      });
      throw error;
    }
  }

  getPreparedRestore(
    operationId: string,
  ): PreparedProfileRestore | undefined {
    if (this.cleanupUnverified) return undefined;
    return this.preparedOwner.get(operationId);
  }

  claimPreparedRestore(
    operationId: string,
  ): PreparedProfileRestoreClaim | undefined {
    if (this.busy || this.cleanupUnverified) throw new ProfileRestoreStagingError('PROFILE_RESTORE_BUSY');
    return this.withPreparedOwner(() => this.preparedOwner.claim(operationId));
  }

  async discardPreparedRestore(operationId: string): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.dependencies.profileSnapshotClient.withInspectionOperation(() => this.runExclusive(async () => {
        if (this.preparedOwner.get(operationId) === undefined) {
          return;
        }
        try {
          await this.dependencies.profileSnapshotClient.removeProfileSnapshot(operationId);
        } catch (error) {
          this.cleanupUnverified = true;
          throw new ProfileRestoreStagingError('PROFILE_RESTORE_STAGING_FAILED', { cause: error });
        }
        this.preparedOwner.clear(operationId);
      }));
    } catch (error) {
      this.observe({
        correlationId: operationId,
        durationMs: Date.now() - startedAt,
        errorCode: readProfileInspectionFailureCause(error) ??
          readSafeStagingErrorCode(error),
        eventName: 'restore.stagingFailed',
        retryable: false,
        sideEffectState: this.cleanupUnverified ? 'unknown' : 'none',
        stage: 'staging',
      });
      throw error;
    }
  }

  private createOperationId(): string {
    const operationId =
      this.dependencies.operationIdFactory?.() ?? randomUUID();
    if (!operationIdPattern.test(operationId)) {
      throw new ProfileRestoreStagingError(
        'PROFILE_RESTORE_STAGING_FAILED',
      );
    }
    return operationId;
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }

  private observe(
    event: Parameters<ProfileRecoveryOperationalObserver['observe']>[0],
  ): void {
    observeProfileRecoverySafely(
      this.dependencies.observer ??
        noOpProfileRecoveryOperationalObserver,
      event,
    );
  }

  private takeInspection(inspectionId: string): PendingInspection {
    const inspection = this.pendingInspection;
    this.pendingInspection = undefined;

    if (
      inspection === undefined ||
      inspection.inspectionId !== inspectionId ||
      inspection.expiresAt < this.now().getTime()
    ) {
      throw new ProfileRestoreStagingError(
        'PROFILE_RESTORE_INSPECTION_EXPIRED',
      );
    }
    return inspection;
  }

  private async runExclusive<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.busy || this.cleanupUnverified) {
      throw new ProfileRestoreStagingError('PROFILE_RESTORE_BUSY');
    }
    this.withPreparedOwner(() => this.preparedOwner.assertIdle());
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }

  private withPreparedOwner<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof PreparedProfileRestoreBusyError) {
        throw new ProfileRestoreStagingError('PROFILE_RESTORE_BUSY', { cause: error });
      }
      throw error;
    }
  }
}

function readSafeStagingErrorCode(error: unknown): string {
  if (error instanceof ProfileRestoreStagingError) {
    return error.code;
  }
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
  ) {
    return error.message;
  }
  return 'PROFILE_RESTORE_STAGING_FAILED';
}
