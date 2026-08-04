import type { ProfileRestoreActivationJournalStore } from './profileRestoreActivationJournalStore.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';

export type ProfileRestoreStartupMode =
  | 'normal'
  | 'validateRestoredProfile'
  | 'validateRolledBackProfile';

interface ProfileRestoreStartupRecoveryDependencies {
  journalStore: Pick<ProfileRestoreActivationJournalStore, 'read'>;
  transaction: Pick<
    ProfileRestoreActivationTransaction,
    | 'accept'
    | 'advanceToValidation'
    | 'clearRolledBack'
    | 'rollback'
  >;
}

export class ProfileRestoreStartupRecovery {
  constructor(
    private readonly dependencies: ProfileRestoreStartupRecoveryDependencies,
  ) {}

  async prepareBeforeBackend(): Promise<ProfileRestoreStartupMode> {
    const journal = await this.dependencies.journalStore.read();
    if (journal === undefined) {
      return 'normal';
    }
    if (journal.phase === 'failedSafe') {
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
      await this.rollbackOrFail();
      return 'validateRolledBackProfile';
    }

    try {
      await this.dependencies.transaction.advanceToValidation();
      return 'validateRestoredProfile';
    } catch {
      await this.rollbackOrFail();
      return 'validateRolledBackProfile';
    }
  }

  async validateAfterBackend(input: {
    mode: ProfileRestoreStartupMode;
    stopBackend(): Promise<void>;
    validateActiveProfile(): Promise<void>;
  }): Promise<'ready' | 'relaunchRequired'> {
    if (input.mode === 'normal') {
      return 'ready';
    }

    try {
      await input.validateActiveProfile();
      if (input.mode === 'validateRestoredProfile') {
        await this.dependencies.transaction.accept();
      } else {
        await this.dependencies.transaction.clearRolledBack();
      }
      return 'ready';
    } catch {
      await Promise.resolve()
        .then(() => input.stopBackend())
        .catch(() => undefined);
      if (input.mode === 'validateRolledBackProfile') {
        throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
      }
      await this.rollbackOrFail();
      return 'relaunchRequired';
    }
  }

  private async rollbackOrFail(): Promise<void> {
    try {
      await this.dependencies.transaction.rollback();
    } catch {
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
  }
}
