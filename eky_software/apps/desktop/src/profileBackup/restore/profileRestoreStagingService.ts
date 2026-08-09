import { randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { join } from 'node:path';

import type { ProfileSnapshotBrokerClient } from '../profileSnapshotBrokerClient.js';
import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import type { RecoveryPointService } from '../recoveryPoint/recoveryPointService.js';
import type { ProfileBackupInspectionSummary } from '../profileBackupInspectionTypes.js';
import { stageValidatedProfileBackup } from '../stageValidatedProfileBackup.js';

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
  constructor(readonly code: ProfileRestoreStagingErrorCode) {
    super(code);
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
    ProfileSnapshotBrokerClient,
    'validateProfileSnapshot'
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
  private pendingInspection:
    | (PendingInspection & { inspectionId: string })
    | undefined;
  private preparedRestore: PreparedProfileRestore | undefined;

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
      const result = await this.runExclusive(async () => {
        const staged = await stageValidatedProfileBackup({
          containerPath: input.containerPath,
          operationId: correlationId,
          password: input.password,
          quarantineRoot: this.dependencies.quarantineRoot,
          stagingRoot: this.dependencies.stagingRoot,
          validator: this.dependencies.profileSnapshotClient,
        });

        try {
          const inspectionId = this.createOperationId();
          this.pendingInspection = {
            containerPath: input.containerPath,
            containerSha256: staged.containerSha256,
            expiresAt:
              this.now().getTime() + inspectionLifetimeMilliseconds,
            inspectionId,
            summary: staged.summary,
          };
          return {
            inspectionId,
            summary: staged.summary,
          };
        } finally {
          await fileSystem.rm(staged.operationRoot, {
            force: true,
            recursive: true,
          });
        }
      });
      this.observe({
        correlationId,
        durationMs: Date.now() - startedAt,
        eventName: 'restore.inspectionCompleted',
        stage: 'inspection',
      });
      return result;
    } catch (error) {
      this.observe({
        correlationId,
        durationMs: Date.now() - startedAt,
        errorCode: readSafeStagingErrorCode(error),
        eventName: 'restore.inspectionFailed',
        retryable: false,
        sideEffectState: 'none',
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
      const result = await this.runExclusive(async () => {
        if (this.preparedRestore !== undefined) {
          throw new ProfileRestoreStagingError('PROFILE_RESTORE_BUSY');
        }
        const inspection = this.takeInspection(input.inspectionId);

        await this.dependencies.recoveryPointService.createPreRestore();

        let stagedOperationRoot: string | undefined;

        try {
          const staged = await stageValidatedProfileBackup({
            containerPath: inspection.containerPath,
            operationId: correlationId,
            password: input.password,
            quarantineRoot: this.dependencies.quarantineRoot,
            stagingRoot: this.dependencies.stagingRoot,
            validator: this.dependencies.profileSnapshotClient,
          });
          stagedOperationRoot = staged.operationRoot;

          if (staged.containerSha256 !== inspection.containerSha256) {
            throw new ProfileRestoreStagingError(
              'PROFILE_RESTORE_SOURCE_CHANGED',
            );
          }
          if (
            !staged.validation.profileMatchesActive &&
            !staged.validation.activeProfileIsEmpty
          ) {
            throw new ProfileRestoreStagingError(
              'PROFILE_RESTORE_TARGET_NOT_EMPTY',
            );
          }

          const prepared: PreparedProfileRestore = {
            operationId: correlationId,
            summary: staged.summary,
            targetDisposition: staged.validation.profileMatchesActive
              ? 'replaceActiveProfile'
              : 'replaceEmptyProfile',
          };
          this.preparedRestore = prepared;
          return prepared;
        } catch (error) {
          if (stagedOperationRoot !== undefined) {
            await fileSystem
              .rm(stagedOperationRoot, {
                force: true,
                recursive: true,
              })
              .catch(() => undefined);
          }
          if (error instanceof ProfileRestoreStagingError) {
            throw error;
          }
          throw new ProfileRestoreStagingError(
            'PROFILE_RESTORE_STAGING_FAILED',
          );
        }
      });
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
        errorCode: readSafeStagingErrorCode(error),
        eventName: 'restore.stagingFailed',
        retryable: false,
        sideEffectState: 'none',
        stage: 'staging',
      });
      throw error;
    }
  }

  getPreparedRestore(
    operationId: string,
  ): PreparedProfileRestore | undefined {
    return this.preparedRestore?.operationId === operationId
      ? this.preparedRestore
      : undefined;
  }

  async discardPreparedRestore(operationId: string): Promise<void> {
    await this.runExclusive(async () => {
      if (this.preparedRestore?.operationId !== operationId) {
        return;
      }
      this.preparedRestore = undefined;
      await fileSystem.rm(
        join(this.dependencies.stagingRoot, operationId),
        {
          force: true,
          recursive: true,
        },
      );
    });
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
    if (this.busy) {
      throw new ProfileRestoreStagingError('PROFILE_RESTORE_BUSY');
    }
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
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
