import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import type { ProfileRestoreActivationJournalStore } from './profileRestoreActivationJournalStore.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';

export type ProfileRestoreStartupMode =
  | 'normal'
  | 'validateRestoredProfile'
  | 'validateRolledBackProfile';

interface ProfileRestoreStartupRecoveryDependencies {
  journalStore: Pick<ProfileRestoreActivationJournalStore, 'read'>;
  observer?: ProfileRecoveryOperationalObserver;
  transaction: Pick<
    ProfileRestoreActivationTransaction,
    | 'accept'
    | 'advanceToValidation'
    | 'clearRolledBack'
    | 'rollback'
  >;
}

export class ProfileRestoreStartupRecovery {
  private activeCorrelationId: string | undefined;

  constructor(
    private readonly dependencies: ProfileRestoreStartupRecoveryDependencies,
  ) {}

  async prepareBeforeBackend(): Promise<ProfileRestoreStartupMode> {
    const journal = await this.dependencies.journalStore.read();
    if (journal === undefined) {
      this.activeCorrelationId = undefined;
      return 'normal';
    }
    this.activeCorrelationId = journal.operationId;
    if (journal.phase === 'failedSafe') {
      this.observeRecoveryRequired('failedSafeJournal');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
    if (journal.phase === 'accepted') {
      await this.dependencies.transaction.accept();
      return 'normal';
    }
    if (journal.phase === 'rolledBack') {
      return 'validateRolledBackProfile';
    }
    if (journal.phase === 'rollbackStarting') {
      await this.rollbackOrFail('startupRollback');
      return 'validateRolledBackProfile';
    }

    try {
      await this.dependencies.transaction.advanceToValidation();
      return 'validateRestoredProfile';
    } catch {
      await this.rollbackOrFail('startupRollback');
      return 'validateRolledBackProfile';
    }
  }

  async validateAfterBackend(input: {
    mode: ProfileRestoreStartupMode;
    stopBackend(): Promise<void>;
    validateActiveProfile(): Promise<void>;
  }): Promise<'ready' | 'relaunchRequired'> {
    if (input.mode === 'normal') {
      this.activeCorrelationId = undefined;
      return 'ready';
    }

    const startedAt = Date.now();
    try {
      await input.validateActiveProfile();
      if (input.mode === 'validateRestoredProfile') {
        await this.dependencies.transaction.accept();
      } else {
        await this.dependencies.transaction.clearRolledBack();
      }
      this.observeValidation({
        durationMs: Date.now() - startedAt,
        eventName: 'restore.validationCompleted',
        stage: input.mode === 'validateRestoredProfile'
          ? 'restoredProfile'
          : 'rolledBackProfile',
      });
      this.activeCorrelationId = undefined;
      return 'ready';
    } catch (error) {
      this.observeValidation({
        durationMs: Date.now() - startedAt,
        errorCode: readSafeStartupRecoveryErrorCode(error),
        eventName: 'restore.validationFailed',
        retryable: false,
        sideEffectState: 'unknown',
        stage: input.mode === 'validateRestoredProfile'
          ? 'restoredProfile'
          : 'rolledBackProfile',
      });
      await Promise.resolve()
        .then(() => input.stopBackend())
        .catch(() => undefined);
      if (input.mode === 'validateRolledBackProfile') {
        this.observeRecoveryRequired('rolledBackProfile');
        throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
      }
      await this.rollbackOrFail('startupRollback');
      return 'relaunchRequired';
    }
  }

  async recoverFromBackendStartupFailure(input: {
    mode: ProfileRestoreStartupMode;
  }): Promise<'notRequired' | 'relaunchRequired'> {
    if (input.mode !== 'validateRestoredProfile') {
      return 'notRequired';
    }

    const journal = await this.dependencies.journalStore.read();
    if (journal === undefined || journal.phase === 'accepted') {
      this.activeCorrelationId = undefined;
      return 'notRequired';
    }
    if (
      this.activeCorrelationId === undefined ||
      journal.operationId !== this.activeCorrelationId ||
      ![
        'rollbackStarting',
        'rolledBack',
        'validationStarting',
      ].includes(journal.phase)
    ) {
      this.observeRecoveryRequired('startupRollback');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }

    await this.rollbackOrFail('startupRollback');
    return 'relaunchRequired';
  }

  private async rollbackOrFail(
    stage: 'startupRollback',
  ): Promise<void> {
    const correlationId = this.activeCorrelationId;
    const startedAt = Date.now();
    if (correlationId !== undefined) {
      this.observe({
        correlationId,
        eventName: 'restore.rollbackStarted',
        stage,
      });
    }
    try {
      await this.dependencies.transaction.rollback();
      if (correlationId !== undefined) {
        this.observe({
          correlationId,
          durationMs: Date.now() - startedAt,
          eventName: 'restore.rollbackCompleted',
          stage,
        });
      }
    } catch {
      if (correlationId !== undefined) {
        this.observe({
          correlationId,
          durationMs: Date.now() - startedAt,
          errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
          eventName: 'restore.rollbackFailed',
          retryable: false,
          sideEffectState: 'unknown',
          stage,
        });
        this.observeRecoveryRequired(stage);
      }
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
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

  private observeValidation(
    event:
      | Omit<
          Extract<
            Parameters<ProfileRecoveryOperationalObserver['observe']>[0],
            { eventName: 'restore.validationCompleted' }
          >,
          'correlationId'
        >
      | Omit<
          Extract<
            Parameters<ProfileRecoveryOperationalObserver['observe']>[0],
            { eventName: 'restore.validationFailed' }
          >,
          'correlationId'
        >,
  ): void {
    if (this.activeCorrelationId !== undefined) {
      this.observe({
        ...event,
        correlationId: this.activeCorrelationId,
      } as Parameters<ProfileRecoveryOperationalObserver['observe']>[0]);
    }
  }

  private observeRecoveryRequired(
    stage:
      | 'failedSafeJournal'
      | 'rolledBackProfile'
      | 'startupRollback',
  ): void {
    if (this.activeCorrelationId !== undefined) {
      this.observe({
        correlationId: this.activeCorrelationId,
        errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        eventName: 'restore.recoveryRequired',
        retryable: false,
        sideEffectState: 'unknown',
        stage,
      });
    }
  }
}

function readSafeStartupRecoveryErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
  ) {
    return error.message;
  }
  return 'PROFILE_RESTORE_VALIDATION_FAILED';
}
