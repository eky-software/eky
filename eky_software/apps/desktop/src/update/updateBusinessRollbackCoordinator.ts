import { isDeepStrictEqual } from 'node:util';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type { MigrationStartupInspection } from './firstStartUpdateCoordinator.js';
import type { UpdateProfileProtection } from './profileProtectionComposition.js';
import {
  transitionUpdateJournal,
  parseUpdateJournal,
  type UpdateJournal,
} from './updateJournal.js';
import {
  assertUpdateJournalAuthority,
  type UpdateJournalStore,
} from './updateJournalStore.js';
import {
  noOpUpdateOperationalObserver,
  type UpdateOperationalObserver,
} from './updateOperationalObserver.js';

interface UpdateBusinessRollbackCoordinatorDependencies {
  journalStore: Pick<UpdateJournalStore, 'read' | 'readForLiveOwner' | 'write'>;
  now?(): Date;
  observer?: UpdateOperationalObserver;
  profileProtection: Pick<
    UpdateProfileProtection,
    'restoreRecoveryPoint' | 'validateActiveProfileForRollback'
  >;
  releaseInfo: Readonly<DesktopReleaseInfo>;
}

export class UpdateBusinessRollbackError extends Error {
  constructor(options?: ErrorOptions) {
    super('The update business profile rollback requires recovery.', options);
    this.name = 'UpdateBusinessRollbackError';
  }
}

export interface UpdateBusinessRollbackStartResult {
  readonly status: 'notRequired' | 'relaunching' | 'validationRequired';
  readonly selectedJournal: Readonly<UpdateJournal> | undefined;
}

export interface UpdateBusinessRollbackStartupAdmission {
  readonly migrationStartupPolicy: 'restoreCompatible';
  readonly selectedJournal: Readonly<UpdateJournal>;
  assertCurrent(): Promise<void>;
}

function assertRunningTarget(journal: Readonly<UpdateJournal>, release: Readonly<DesktopReleaseInfo>): void {
  if (journal.targetVersion !== release.appVersion ||
      journal.candidatePackageIdentity.buildRevision !== release.buildRevision ||
      journal.releaseChannel !== release.releaseChannel) throw new UpdateBusinessRollbackError();
}

async function assertSelectedJournal(store: Pick<UpdateJournalStore, 'readForLiveOwner'>,
  journal: Readonly<UpdateJournal> | undefined, assertAuthority?: () => void): Promise<void> {
  assertUpdateJournalAuthority(assertAuthority);
  const current = await store.readForLiveOwner();
  assertUpdateJournalAuthority(assertAuthority);
  if (!isDeepStrictEqual(current, journal)) throw new Error('UPDATE_JOURNAL_CONFLICT');
}

/** Read-only C selection, usable before forward workspace preparation. */
export async function prepareUpdateBusinessRollbackStartupAdmission(input: {
  journalStore: Pick<UpdateJournalStore, 'readForLiveOwner'>;
  releaseInfo: Readonly<DesktopReleaseInfo>;
  selectedJournal: Readonly<UpdateJournal> | undefined;
  assertAuthority(): void;
}): Promise<Readonly<UpdateBusinessRollbackStartupAdmission> | undefined> {
  const journal = input.selectedJournal === undefined ? undefined : parseUpdateJournal(input.selectedJournal);
  const assertCurrent = () => assertSelectedJournal(input.journalStore, journal, input.assertAuthority);
  await assertCurrent();
  if (journal === undefined || (journal.state !== 'rollbackRequired' &&
      journal.state !== 'businessRollbackStarting' && journal.state !== 'businessRollbackCompleted')) return undefined;
  assertRunningTarget(journal, input.releaseInfo);
  if (journal.recoveryPointReference === undefined || journal.preUpdateMigrationChainIdentity === undefined) {
    throw new UpdateBusinessRollbackError();
  }
  return Object.freeze({ migrationStartupPolicy: 'restoreCompatible', selectedJournal: journal, assertCurrent });
}

export class UpdateBusinessRollbackCoordinator {
  constructor(
    private readonly dependencies: UpdateBusinessRollbackCoordinatorDependencies,
  ) {}

  /** Grants only schema compatibility; the migration gate still proves content and the original chain. */
  async prepareStartupAdmission(input: {
    selectedJournal: Readonly<UpdateJournal> | undefined;
    assertAuthority(): void;
  }): Promise<Readonly<UpdateBusinessRollbackStartupAdmission> | undefined> {
    return prepareUpdateBusinessRollbackStartupAdmission({ ...input,
      journalStore: this.dependencies.journalStore, releaseInfo: this.dependencies.releaseInfo });
  }

  async startIfRequired(
    inspection?: Readonly<MigrationStartupInspection>,
    input?: {
      selectedJournal: Readonly<UpdateJournal> | undefined;
      assertAuthority(): void;
    },
  ): Promise<Readonly<UpdateBusinessRollbackStartResult>> {
    // An explicit absent selection must not discover a newly appeared operation.
    const selected = input === undefined
      ? await this.dependencies.journalStore.readForLiveOwner() : input.selectedJournal;
    const journal = selected === undefined ? undefined : parseUpdateJournal(selected);
    await this.assertSelection(journal, input?.assertAuthority);
    if (
      journal === undefined ||
      (journal.state !== 'rollbackRequired' &&
        journal.state !== 'businessRollbackStarting')
    ) {
      return Object.freeze({ status: 'notRequired', selectedJournal: journal });
    }

    this.notifyStarted(journal.correlationId);

    this.assertRunningTarget(journal);
    if (
      journal.recoveryPointReference === undefined ||
      journal.preUpdateMigrationChainIdentity === undefined
    ) {
      await this.failSafe(journal, input?.assertAuthority);
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
      await this.dependencies.journalStore.write(starting, {
        expectedJournal: journal,
        ...(input === undefined ? {} : { assertAuthority: input.assertAuthority }),
      });
    }
    await this.assertSelection(starting, input?.assertAuthority);

    if (
      inspection !== undefined &&
      inspection.profileState === 'existing' &&
      inspection.migrationChainIdentity ===
        starting.preUpdateMigrationChainIdentity
    ) {
      return Object.freeze({ status: 'validationRequired', selectedJournal: starting });
    }

    try {
      const status = await this.dependencies.profileProtection.restoreRecoveryPoint({
        expectedMigrationChainIdentity:
          starting.preUpdateMigrationChainIdentity!,
        operationId: starting.correlationId,
        recoveryPointReference: starting.recoveryPointReference!,
        assertAuthority: () => this.assertSelection(starting, input?.assertAuthority),
      });
      await this.assertSelection(starting, input?.assertAuthority);
      return Object.freeze({ status, selectedJournal: starting });
    } catch (error) {
      let cause = error;
      try {
        await this.failSafe(starting, input?.assertAuthority);
      } catch (journalError) {
        cause = new AggregateError(
          [error, journalError],
          'UPDATE_BUSINESS_ROLLBACK_FAILED',
        );
      }
      this.notifyFailed(starting.correlationId);
      throw new UpdateBusinessRollbackError({ cause });
    }
  }

  async completeAfterProfileValidation(input: {
    inspection: Readonly<MigrationStartupInspection>;
    selectedJournal?: Readonly<UpdateJournal>;
    assertAuthority?(): void;
  }): Promise<void> {
    const selected = input.selectedJournal ??
      await this.dependencies.journalStore.readForLiveOwner();
    const journal = selected === undefined
      ? undefined : parseUpdateJournal(selected);
    if (
      journal?.state !== 'businessRollbackStarting' &&
      journal?.state !== 'businessRollbackCompleted'
    ) {
      throw new UpdateBusinessRollbackError();
    }
    this.assertRunningTarget(journal);

    try {
      await this.assertSelection(journal, input.assertAuthority);
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
        await this.dependencies.profileProtection.validateActiveProfileForRollback(Object.freeze({
          expectedMigrationChainIdentity,
          assertCurrent: () => this.assertSelection(journal, input.assertAuthority),
        }));
      await this.assertSelection(journal, input.assertAuthority);
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
          {
            expectedJournal: journal,
            ...(input.assertAuthority === undefined
              ? {} : { assertAuthority: input.assertAuthority }),
          },
        );
      }
      assertUpdateJournalAuthority(input.assertAuthority);
      this.notifyCompleted(journal.correlationId);
    } catch (error) {
      let cause = error;
      try {
        await this.requireRecovery(journal, input.assertAuthority);
      } catch (journalError) {
        cause = new AggregateError(
          [error, journalError],
          'UPDATE_BUSINESS_ROLLBACK_FAILED',
        );
      }
      this.notifyFailed(journal.correlationId);
      this.notifyRecoveryRequired(journal.correlationId);
      throw new UpdateBusinessRollbackError({ cause });
    }
  }

  async requireRecoveryAfterRestoreRollback(input: {
    selectedJournal?: Readonly<UpdateJournal>;
    assertAuthority?(): void;
  } = {}): Promise<never> {
    const selected = input.selectedJournal ??
      await this.dependencies.journalStore.readForLiveOwner();
    const journal = selected === undefined
      ? undefined : parseUpdateJournal(selected);
    if (journal?.state !== 'businessRollbackStarting') {
      throw new UpdateBusinessRollbackError();
    }
    this.assertRunningTarget(journal);
    let failure = new UpdateBusinessRollbackError();
    try {
      await this.requireRecovery(journal, input.assertAuthority);
    } catch (journalError) {
      failure = new UpdateBusinessRollbackError({ cause: journalError });
    }
    this.notifyFailed(journal.correlationId);
    this.notifyRecoveryRequired(journal.correlationId);
    throw failure;
  }

  private assertRunningTarget(journal: Readonly<UpdateJournal>): void {
    assertRunningTarget(journal, this.dependencies.releaseInfo);
  }

  private async failSafe(journal: Readonly<UpdateJournal>, assertAuthority?: () => void): Promise<void> {
    if (
      journal.state !== 'rollbackRequired' &&
      journal.state !== 'businessRollbackStarting'
    ) {
      return;
    }
    await this.assertSelection(journal, assertAuthority);
    await this.dependencies.journalStore.write(
      transitionUpdateJournal(journal, {
        at: this.now(),
        state: 'failedSafe',
      }),
      { expectedJournal: journal, ...(assertAuthority === undefined ? {} : { assertAuthority }) },
    );
  }

  private async assertSelection(
    journal: Readonly<UpdateJournal> | undefined,
    assertAuthority?: () => void,
  ): Promise<void> {
    await assertSelectedJournal(this.dependencies.journalStore, journal, assertAuthority);
  }

  private async requireRecovery(
    journal: Readonly<UpdateJournal>,
    assertAuthority?: () => void,
  ): Promise<void> {
    if (
      journal.state !== 'businessRollbackStarting' &&
      journal.state !== 'businessRollbackCompleted'
    ) {
      return;
    }
    await this.assertSelection(journal, assertAuthority);
    await this.dependencies.journalStore.write(
      transitionUpdateJournal(journal, {
        at: this.now(),
        state: 'recoveryRequired',
      }),
      {
        expectedJournal: journal,
        ...(assertAuthority === undefined ? {} : { assertAuthority }),
      },
    );
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }

  private notifyStarted(correlationId: string): void {
    this.notify((observer) => observer.operationStarted({
      correlationId,
      stage: 'businessRollback',
    }));
  }

  private notifyCompleted(correlationId: string): void {
    this.notify((observer) => observer.operationCompleted({
      correlationId,
      durationMs: 0,
      stage: 'businessRollback',
    }));
  }

  private notifyFailed(correlationId: string): void {
    this.notify((observer) => observer.operationFailed({
      correlationId,
      durationMs: 0,
      errorCode: 'UPDATE_BUSINESS_ROLLBACK_FAILED',
      retryable: false,
      sideEffectState: 'unknown',
      stage: 'businessRollback',
    }));
  }

  private notifyRecoveryRequired(correlationId: string): void {
    this.notify((observer) => observer.operationStateChanged?.({
      correlationId,
      stage: 'businessRollback',
      state: 'recoveryRequired',
    }));
  }

  private notify(
    notification: (observer: UpdateOperationalObserver) => void,
  ): void {
    try {
      notification(
        this.dependencies.observer ?? noOpUpdateOperationalObserver,
      );
    } catch {
      // Diagnostics never controls rollback.
    }
  }
}
