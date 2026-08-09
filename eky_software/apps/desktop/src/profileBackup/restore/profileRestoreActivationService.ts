import type { ProfileSnapshotBrokerClient } from '../profileSnapshotBrokerClient.js';
import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
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
  ) {
    super(code);
    this.name = 'ProfileRestoreActivationError';
  }
}

interface ProfileRestoreActivationServiceDependencies {
  observer?: ProfileRecoveryOperationalObserver;
  profileSnapshotClient: Pick<
    ProfileSnapshotBrokerClient,
    | 'beginMaintenance'
    | 'endMaintenance'
    | 'prepareProfileRestoreActivation'
    | 'validateProfileSnapshot'
  >;
  relaunchApplication(): void;
  stagingService: Pick<
    ProfileRestoreStagingService,
    'getPreparedRestore'
  >;
  stopBusinessRuntime(): Promise<void>;
  transaction: Pick<
    ProfileRestoreActivationTransaction,
    'advanceToValidation' | 'prepare' | 'rollback'
  >;
}

export class ProfileRestoreActivationService {
  private active = false;

  constructor(
    private readonly dependencies: ProfileRestoreActivationServiceDependencies,
  ) {}

  async activate(operationId: string): Promise<'relaunching'> {
    if (this.active) {
      throw new ProfileRestoreActivationError(
        'PROFILE_RESTORE_ACTIVATION_FAILED',
      );
    }
    const prepared =
      this.dependencies.stagingService.getPreparedRestore(operationId);
    if (prepared === undefined) {
      throw new ProfileRestoreActivationError(
        'PROFILE_RESTORE_ACTIVATION_NOT_PREPARED',
      );
    }

    this.active = true;
    this.observe({
      correlationId: operationId,
      eventName: 'restore.activationStarted',
      stage: 'activation',
    });
    let maintenanceActive = false;
    let transactionPrepared = false;
    let runtimeStopped = false;

    try {
      await this.dependencies.profileSnapshotClient.beginMaintenance(
        operationId,
      );
      maintenanceActive = true;
      const validation =
        await this.dependencies.profileSnapshotClient.validateProfileSnapshot(
          operationId,
        );
      assertPreparedTargetStillValid(prepared, validation);
      await this.dependencies.profileSnapshotClient.prepareProfileRestoreActivation(
        operationId,
      );
      await this.dependencies.transaction.prepare(operationId);
      transactionPrepared = true;

      await this.dependencies.stopBusinessRuntime();
      runtimeStopped = true;
      maintenanceActive = false;
      await this.dependencies.transaction.advanceToValidation();
      this.dependencies.relaunchApplication();
      return 'relaunching';
    } catch {
      if (maintenanceActive) {
        await this.dependencies.profileSnapshotClient
          .endMaintenance(operationId)
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
          await this.dependencies.transaction.rollback();
          this.observe({
            correlationId: operationId,
            durationMs: Date.now() - rollbackStartedAt,
            eventName: 'restore.rollbackCompleted',
            stage: 'activationRollback',
          });
          this.dependencies.relaunchApplication();
          return 'relaunching';
        } catch {
          this.observe({
            correlationId: operationId,
            durationMs: Date.now() - rollbackStartedAt,
            errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
            eventName: 'restore.rollbackFailed',
            retryable: false,
            sideEffectState: 'unknown',
            stage: 'activationRollback',
          });
          throw new ProfileRestoreActivationError(
            'PROFILE_RESTORE_RECOVERY_REQUIRED',
          );
        }
      }
      throw new ProfileRestoreActivationError(
        'PROFILE_RESTORE_ACTIVATION_FAILED',
      );
    } finally {
      this.active = false;
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
