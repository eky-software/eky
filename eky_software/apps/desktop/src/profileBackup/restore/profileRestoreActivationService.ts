import { readProfileInspectionFailureCause } from '../../runtime/profileInspectionFailure.js';
import type { ProfileRestoreSnapshotInspectionPort } from '../profileSnapshotInspectionPort.js';
import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import { captureProfileRestoreActivationJournal, type ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';
import type { PreparedProfileRestoreClaim } from './preparedProfileRestoreOwner.js';
import type {
  PreparedProfileRestore,
  ProfileRestoreStagingService,
} from './profileRestoreStagingService.js';

export class ProfileRestoreActivationError extends Error {
  constructor(
    readonly code:
      | 'PROFILE_RESTORE_ACTIVATION_FAILED'
      | 'PROFILE_RESTORE_ACTIVATION_NOT_PREPARED'
      | 'PROFILE_RESTORE_RECOVERY_REQUIRED',
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ProfileRestoreActivationError';
  }
}

interface ProfileRestoreActivationServiceDependencies {
  assertRuntimeAuthority?(runtimeStopped: boolean): Promise<void>;
  observer?: ProfileRecoveryOperationalObserver;
  profileSnapshotClient: ProfileRestoreSnapshotInspectionPort;
  relaunchApplication(): void;
  stagingService: Pick<
    ProfileRestoreStagingService,
    'claimPreparedRestore'
  >;
  stopBusinessRuntime(operationId: string): Promise<void>;
  transaction: Pick<
    ProfileRestoreActivationTransaction,
    'advanceToValidation' | 'prepare' | 'readPreparation' | 'readOwnForwardProgress' | 'rollback'
  >;
}

export class ProfileRestoreActivationService {
  private active = false;

  constructor(
    private readonly dependencies: ProfileRestoreActivationServiceDependencies,
  ) {}

  async activate(operationId: string, assertAuthority?: () => Promise<void>): Promise<'relaunching'> {
    if (this.active) {
      throw new ProfileRestoreActivationError(
        'PROFILE_RESTORE_ACTIVATION_FAILED',
      );
    }
    const claim =
      this.dependencies.stagingService.claimPreparedRestore(operationId);
    if (claim === undefined) {
      throw new ProfileRestoreActivationError(
        'PROFILE_RESTORE_ACTIVATION_NOT_PREPARED',
      );
    }

    this.active = true;
    try {
      return await this.activateClaimed(operationId, claim, assertAuthority);
    } finally {
      claim.release();
      this.active = false;
    }
  }

  private async activateClaimed(
    operationId: string,
    claim: PreparedProfileRestoreClaim,
    assertAuthority?: () => Promise<void>,
  ): Promise<'relaunching'> {
    const prepared = claim.prepared;
    const activationStartedAt = Date.now();
    this.observe({
      correlationId: operationId,
      eventName: 'restore.activationStarted',
      stage: 'activation',
    });
    let maintenanceActive = false;
    let transactionPrepared = false;
    let preparationReadbackFailure: { error: unknown } | undefined;
    let runtimeStopped = false;
    let preparedJournal: Readonly<ProfileRestoreActivationJournal> | undefined;
    const assertCurrent = async () => {
      await assertAuthority?.();
      await this.dependencies.assertRuntimeAuthority?.(runtimeStopped);
      if (maintenanceActive) {
        await this.dependencies.profileSnapshotClient.assertRestoreMaintenance(operationId);
      }
      await assertAuthority?.();
    };

    try {
      await assertCurrent();
      await this.dependencies.profileSnapshotClient.beginRestoreMaintenance(
        operationId,
      );
      maintenanceActive = true;
      const validation =
        await this.dependencies.profileSnapshotClient.prepareProfileRestoreSnapshot(
          operationId,
        );
      assertPreparedTargetStillValid(prepared, validation);
      await this.dependencies.profileSnapshotClient.assertRestoreMaintenance(operationId);
      this.dependencies.profileSnapshotClient.retainProfileSnapshotForRecovery(operationId);
      let preparationWriteFailure: { error: unknown } | undefined;
      try {
        await this.dependencies.transaction.prepare(operationId, assertCurrent, journal => {
          preparedJournal = captureProfileRestoreActivationJournal(journal);
        });
      } catch (error) {
        preparationWriteFailure = { error };
      }
      // An acknowledgement alone cannot transfer staging; a rejection may have committed.
      try {
        const preparation = await this.dependencies.transaction.readPreparation(operationId, preparedJournal, assertCurrent);
        if (preparation === 'prepared' && preparedJournal !== undefined) {
          transactionPrepared = true;
          claim.preserveForRecovery();
        } else if (preparation === 'notPrepared' && preparationWriteFailure !== undefined) {
          await assertCurrent();
          await this.dependencies.profileSnapshotClient.cancelProfileRestoreRetention(operationId);
          maintenanceActive = false;
        } else {
          throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
        }
      } catch (readbackError) {
        claim.preserveForRecovery();
        preparationReadbackFailure = { error: readbackError };
      }
      if (preparationWriteFailure !== undefined) throw preparationWriteFailure.error;
      if (preparationReadbackFailure !== undefined) throw preparationReadbackFailure.error;

      await assertCurrent();
      await this.dependencies.profileSnapshotClient.releaseProfileSnapshot(operationId);
      await assertCurrent();
      await this.dependencies.stopBusinessRuntime(operationId);
      runtimeStopped = true;
      maintenanceActive = false;
      await assertCurrent();
      await this.dependencies.transaction.advanceToValidation(preparedJournal!, assertCurrent);
      await assertCurrent();
      this.dependencies.relaunchApplication();
      return 'relaunching';
    } catch (error) {
      this.observe({
        correlationId: operationId,
        durationMs: Date.now() - activationStartedAt,
        errorCode: readProfileInspectionFailureCause(error) ??
          readSafeActivationErrorCode(error),
        eventName: 'restore.activationFailed',
        retryable: false,
        sideEffectState:
          transactionPrepared || runtimeStopped ||
          preparationReadbackFailure !== undefined ? 'unknown' : 'none',
        stage: 'activation',
      });
      if (
        maintenanceActive && !transactionPrepared &&
        preparationReadbackFailure === undefined
      ) {
        await assertCurrent().then(() => this.dependencies.profileSnapshotClient
          .endRestoreMaintenance(operationId))
          .catch((cleanupError: unknown) => {
            claim.preserveForRecovery();
            preparationReadbackFailure = { error: cleanupError };
          });
      }
      if (maintenanceActive && (transactionPrepared || preparationReadbackFailure !== undefined)) {
        await this.dependencies.profileSnapshotClient.invalidateRestoreMaintenance(operationId)
          .catch(() => undefined);
      }
      if (transactionPrepared && runtimeStopped) {
        const rollbackStartedAt = Date.now();
        this.observe({
          correlationId: operationId,
          eventName: 'restore.rollbackStarted',
          stage: 'activationRollback',
        });
        try {
          await assertCurrent();
          const ownProgress = await this.dependencies.transaction.readOwnForwardProgress(preparedJournal!, assertCurrent);
          await assertCurrent();
          await this.dependencies.transaction.rollback(ownProgress, assertCurrent);
          await assertCurrent();
          this.observe({
            correlationId: operationId,
            durationMs: Date.now() - rollbackStartedAt,
            eventName: 'restore.rollbackCompleted',
            stage: 'activationRollback',
          });
          this.dependencies.relaunchApplication();
          return 'relaunching';
        } catch (rollbackError) {
          this.observe({
            correlationId: operationId,
            durationMs: Date.now() - rollbackStartedAt,
            errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
            eventName: 'restore.rollbackFailed',
            retryable: false,
            sideEffectState: 'unknown',
            stage: 'activationRollback',
          });
          this.observe({
            correlationId: operationId,
            errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
            eventName: 'restore.recoveryRequired',
            retryable: false,
            sideEffectState: 'unknown',
            stage: 'activationRollback',
          });
          throw new ProfileRestoreActivationError(
            'PROFILE_RESTORE_RECOVERY_REQUIRED',
            {
              cause: new AggregateError(
                [error, rollbackError],
                'PROFILE_RESTORE_RECOVERY_REQUIRED',
              ),
            },
          );
        }
      }
      if (transactionPrepared || preparationReadbackFailure !== undefined) {
        this.observe({
          correlationId: operationId,
          errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
          eventName: 'restore.recoveryRequired',
          retryable: false,
          sideEffectState: 'unknown',
          stage: 'activation',
        });
        throw new ProfileRestoreActivationError(
          'PROFILE_RESTORE_RECOVERY_REQUIRED',
          {
            cause: preparationReadbackFailure === undefined || preparationReadbackFailure.error === error
              ? error
              : new AggregateError(
                  [error, preparationReadbackFailure.error],
                  'PROFILE_RESTORE_RECOVERY_REQUIRED',
                ),
          },
        );
      }
      throw new ProfileRestoreActivationError(
        'PROFILE_RESTORE_ACTIVATION_FAILED',
        { cause: error },
      );
    }
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
}

function readSafeActivationErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
  ) {
    return error.message;
  }
  return 'PROFILE_RESTORE_ACTIVATION_FAILED';
}

function assertPreparedTargetStillValid(
  prepared: PreparedProfileRestore,
  validation: {
    activeProfileIsEmpty: boolean;
    profileMatchesActive: boolean;
  },
): void {
  const targetIsValid =
    prepared.targetDisposition === 'replaceActiveProfile'
      ? validation.profileMatchesActive
      : !validation.profileMatchesActive &&
        validation.activeProfileIsEmpty;
  if (!targetIsValid) {
    throw new ProfileRestoreActivationError(
      'PROFILE_RESTORE_ACTIVATION_FAILED',
    );
  }
}
