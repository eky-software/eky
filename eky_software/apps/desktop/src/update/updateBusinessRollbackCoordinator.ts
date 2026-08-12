import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type { MigrationStartupInspection } from './firstStartUpdateCoordinator.js';
import type { UpdateProfileProtection } from './profileProtectionComposition.js';
import {
  transitionUpdateJournal,
  type UpdateJournal,
} from './updateJournal.js';
import type { UpdateJournalStore } from './updateJournalStore.js';

interface UpdateBusinessRollbackCoordinatorDependencies {
  journalStore: Pick<UpdateJournalStore, 'read' | 'write'>;
  now?(): Date;
  profileProtection: Pick<
    UpdateProfileProtection,
    'restoreRecoveryPoint' | 'validateActiveProfile'
  >;
  releaseInfo: Readonly<DesktopReleaseInfo>;
}

export class UpdateBusinessRollbackError extends Error {
  constructor() {
    super('The update business profile rollback requires recovery.');
    this.name = 'UpdateBusinessRollbackError';
  }
}

export class UpdateBusinessRollbackCoordinator {
  constructor(
    private readonly dependencies: UpdateBusinessRollbackCoordinatorDependencies,
  ) {}

  async startIfRequired(
    inspection?: Readonly<MigrationStartupInspection>,
  ): Promise<'notRequired' | 'relaunching' | 'validationRequired'> {
    const journal = await this.dependencies.journalStore.read();
    if (
      journal === undefined ||
      (journal.state !== 'rollbackRequired' &&
        journal.state !== 'businessRollbackStarting')
    ) {
      return 'notRequired';
    }

    this.assertRunningTarget(journal);
    if (
      journal.recoveryPointReference === undefined ||
      journal.preUpdateMigrationChainIdentity === undefined
    ) {
      await this.failSafe(journal);
      throw new UpdateBusinessRollbackError();
    }

    const starting =
      journal.state === 'businessRollbackStarting'
        ? journal
        : transitionUpdateJournal(journal, {
            at: this.now(),
            state: 'businessRollbackStarting',
          });
    if (starting !== journal) {
      await this.dependencies.journalStore.write(starting);
    }

    if (
      inspection !== undefined &&
      inspection.profileState === 'existing' &&
      inspection.migrationChainIdentity ===
        starting.preUpdateMigrationChainIdentity
    ) {
      return 'validationRequired';
    }

    try {
      return await this.dependencies.profileProtection.restoreRecoveryPoint({
        expectedMigrationChainIdentity:
          starting.preUpdateMigrationChainIdentity!,
        operationId: starting.correlationId,
        recoveryPointReference: starting.recoveryPointReference!,
      });
    } catch {
      await this.failSafe(starting);
      throw new UpdateBusinessRollbackError();
    }
  }

  async completeAfterProfileValidation(input: {
    inspection: Readonly<MigrationStartupInspection>;
  }): Promise<void> {
    const journal = await this.dependencies.journalStore.read();
    if (
      journal?.state !== 'businessRollbackStarting' &&
      journal?.state !== 'businessRollbackCompleted'
    ) {
      throw new UpdateBusinessRollbackError();
    }
    this.assertRunningTarget(journal);

    try {
      const expectedMigrationChainIdentity =
        journal.preUpdateMigrationChainIdentity;
      if (
        expectedMigrationChainIdentity === undefined ||
        input.inspection.profileState !== 'existing' ||
        input.inspection.migrationChainIdentity !==
          expectedMigrationChainIdentity
      ) {
        throw new UpdateBusinessRollbackError();
      }
      const validation =
        await this.dependencies.profileProtection.validateActiveProfile();
      if (
        validation.databaseHealth !== 'healthy' ||
        validation.migrationChainIdentity !== expectedMigrationChainIdentity
      ) {
        throw new UpdateBusinessRollbackError();
      }
      if (journal.state === 'businessRollbackStarting') {
        await this.dependencies.journalStore.write(
          transitionUpdateJournal(journal, {
            at: this.now(),
            state: 'businessRollbackCompleted',
          }),
        );
      }
    } catch {
      await this.requireRecovery(journal);
      throw new UpdateBusinessRollbackError();
    }
  }

  async requireRecoveryAfterRestoreRollback(): Promise<never> {
    const journal = await this.dependencies.journalStore.read();
    if (journal?.state !== 'businessRollbackStarting') {
      throw new UpdateBusinessRollbackError();
    }
    this.assertRunningTarget(journal);
    await this.requireRecovery(journal);
    throw new UpdateBusinessRollbackError();
  }

  private assertRunningTarget(journal: Readonly<UpdateJournal>): void {
    if (
      journal.targetVersion !== this.dependencies.releaseInfo.appVersion ||
      journal.candidatePackageIdentity.buildRevision !==
        this.dependencies.releaseInfo.buildRevision ||
      journal.releaseChannel !== this.dependencies.releaseInfo.releaseChannel
    ) {
      throw new UpdateBusinessRollbackError();
    }
  }

  private async failSafe(journal: Readonly<UpdateJournal>): Promise<void> {
    if (
      journal.state !== 'rollbackRequired' &&
      journal.state !== 'businessRollbackStarting'
    ) {
      return;
    }
    await this.dependencies.journalStore.write(
      transitionUpdateJournal(journal, {
        at: this.now(),
        state: 'failedSafe',
      }),
    );
  }

  private async requireRecovery(journal: Readonly<UpdateJournal>): Promise<void> {
    if (
      journal.state !== 'businessRollbackStarting' &&
      journal.state !== 'businessRollbackCompleted'
    ) {
      return;
    }
    await this.dependencies.journalStore
      .write(
        transitionUpdateJournal(journal, {
          at: this.now(),
          state: 'recoveryRequired',
        }),
      )
      .catch(() => undefined);
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}
