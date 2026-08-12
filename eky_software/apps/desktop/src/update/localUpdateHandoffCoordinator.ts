import { randomUUID } from 'node:crypto';

import type {
  LocalUpdateExpectedPackageIdentity,
  LocalUpdatePackageCache,
  RevalidatedLocalUpdatePackageHandle,
} from './localUpdatePackageCache.js';
import type { UpdateProfileProtection } from './profileProtectionComposition.js';
import {
  parseUpdateJournal,
  transitionUpdateJournal,
  type UpdateJournal,
  type UpdateJournalPackageIdentity,
} from './updateJournal.js';
import type { UpdateJournalStore } from './updateJournalStore.js';
import {
  noOpUpdateOperationalObserver,
  type UpdateOperationalObserver,
} from './updateOperationalObserver.js';

interface LocalUpdateHandoffCoordinatorDependencies {
  cache: Pick<
    LocalUpdatePackageCache,
    'readExpectedPackageIdentity' | 'revalidateJournalPackage'
  >;
  journalStore: Pick<UpdateJournalStore, 'clear' | 'read' | 'write'>;
  launchInstaller(
    candidate: Readonly<RevalidatedLocalUpdatePackageHandle>,
  ): Promise<void>;
  now?(): Date;
  operationIdFactory?(): string;
  observer?: UpdateOperationalObserver;
  profileProtection: Pick<
    UpdateProfileProtection,
    | 'createValidatedPreUpdatePoint'
    | 'enterMaintenance'
    | 'leaveMaintenance'
    | 'validateActiveProfile'
  >;
  shutdownRuntime(): Promise<void>;
}

export class LocalUpdateHandoffError extends Error {
  constructor(
    readonly code = 'LOCAL_UPDATE_HANDOFF_FAILED',
  ) {
    super('The local update could not be handed off safely.');
    this.name = 'LocalUpdateHandoffError';
  }
}

export class LocalUpdateHandoffCoordinator {
  private activeOperation = false;

  constructor(
    private readonly dependencies: LocalUpdateHandoffCoordinatorDependencies,
  ) {}

  prepareConfirmedUpdate(): Promise<Readonly<UpdateJournal>> {
    return this.runExclusive(async () => {
      let journal: Readonly<UpdateJournal> | undefined;
      let failureCode = 'UPDATE_PREPARATION_JOURNAL_STATE_FAILED';
      const correlationId = this.createOperationId();
      const startedAt = Date.now();
      this.notifyStarted(correlationId, 'recoveryPoint');
      try {
        await this.assertJournalCanBeReplaced();
        failureCode = 'UPDATE_PREPARATION_PACKAGE_IDENTITY_FAILED';
        const currentIdentity =
          await this.dependencies.cache.readExpectedPackageIdentity(
            'current',
          );
        const candidateIdentity =
          await this.dependencies.cache.readExpectedPackageIdentity(
            'candidate',
          );
        failureCode = 'UPDATE_PREPARATION_PROFILE_VALIDATION_FAILED';
        const profileValidation =
          await this.dependencies.profileProtection.validateActiveProfile();
        journal = createPreparedJournal({
          candidateIdentity,
          correlationId,
          currentIdentity,
          now: this.now(),
          preUpdateMigrationChainIdentity:
            profileValidation.migrationChainIdentity,
        });
        failureCode = 'UPDATE_PREPARATION_JOURNAL_WRITE_FAILED';
        await this.dependencies.journalStore.write(journal);
        failureCode = 'UPDATE_PREPARATION_RECOVERY_POINT_FAILED';
        const recoveryPointReference =
          await this.dependencies.profileProtection
            .createValidatedPreUpdatePoint();
        journal = transitionUpdateJournal(journal, {
          at: this.now(),
          recoveryPointReference,
          state: 'recoveryPointValidated',
        });
        failureCode = 'UPDATE_PREPARATION_FINALIZE_FAILED';
        await this.dependencies.journalStore.write(journal);
        this.notifyCompleted(
          correlationId,
          startedAt,
          'recoveryPoint',
        );
        return journal;
      } catch (error) {
        await this.writeFailedJournal(journal);
        this.notifyFailed({
          correlationId,
          errorCode: 'UPDATE_RECOVERY_POINT_FAILED',
          sideEffectState: 'none',
          stage: 'recoveryPoint',
          startedAt,
        });
        throw new LocalUpdateHandoffError(
          readSafePreparationFailureCode(error) ?? failureCode,
        );
      }
    });
  }

  handoffPreparedUpdate(): Promise<void> {
    return this.runExclusive(async () => {
      let journal: Readonly<UpdateJournal> | undefined;
      let maintenanceStarted = false;
      let runtimeStopped = false;
      let activeStage: 'installerHandoff' | 'runtimeShutdown' =
        'installerHandoff';
      let stageStartedAt = Date.now();
      try {
        journal = await this.dependencies.journalStore.read();
        if (
          journal === undefined ||
          journal.state !== 'recoveryPointValidated' ||
          journal.handoffAttemptCount !== 0
        ) {
          throw new LocalUpdateHandoffError();
        }
        this.notifyStarted(journal.correlationId, 'installerHandoff');
        const candidate =
          await this.dependencies.cache.revalidateJournalPackage({
            expectedIdentity: {
              appVersion: journal.targetVersion,
              ...journal.candidatePackageIdentity,
            },
            role: 'candidate',
          });
        await this.dependencies.profileProtection.enterMaintenance(
          journal.correlationId,
        );
        maintenanceStarted = true;
        const profileValidation =
          await this.dependencies.profileProtection.validateActiveProfile();
        if (
          profileValidation.migrationChainIdentity !==
            journal.preUpdateMigrationChainIdentity
        ) {
          throw new LocalUpdateHandoffError();
        }
        journal = transitionUpdateJournal(journal, {
          at: this.now(),
          state: 'runtimeStopping',
        });
        await this.dependencies.journalStore.write(journal);
        activeStage = 'runtimeShutdown';
        stageStartedAt = Date.now();
        this.notifyStarted(journal.correlationId, activeStage);
        await this.dependencies.shutdownRuntime();
        this.notifyCompleted(
          journal.correlationId,
          stageStartedAt,
          activeStage,
        );
        runtimeStopped = true;
        activeStage = 'installerHandoff';
        stageStartedAt = Date.now();
        journal = transitionUpdateJournal(journal, {
          at: this.now(),
          handoffAttemptCount: 1,
          state: 'awaitingFirstStart',
        });
        await this.dependencies.journalStore.write(journal);
        await this.dependencies.launchInstaller(candidate);
        this.notifyCompleted(
          journal.correlationId,
          stageStartedAt,
          activeStage,
        );
      } catch {
        if (maintenanceStarted && !runtimeStopped && journal !== undefined) {
          await this.dependencies.profileProtection
            .leaveMaintenance(journal.correlationId)
            .catch(() => undefined);
        }
        await this.writeFailedJournal(journal);
        if (journal !== undefined) {
          this.notifyFailed({
            correlationId: journal.correlationId,
            errorCode:
              activeStage === 'runtimeShutdown'
                ? 'UPDATE_SHUTDOWN_TIMEOUT'
                : 'UPDATE_INSTALLER_START_FAILED',
            sideEffectState: runtimeStopped ? 'unknown' : 'none',
            stage: activeStage,
            startedAt: stageStartedAt,
          });
        }
        throw new LocalUpdateHandoffError();
      }
    });
  }

  private async assertJournalCanBeReplaced(): Promise<void> {
    const current = await this.dependencies.journalStore.read();
    if (current === undefined) {
      return;
    }
    if (
      current.state !== 'accepted' &&
      current.state !== 'failed' &&
      current.state !== 'installerNotApplied' &&
      current.state !== 'rolledBack'
    ) {
      throw new LocalUpdateHandoffError();
    }
    await this.dependencies.journalStore.clear();
  }

  private createOperationId(): string {
    return (this.dependencies.operationIdFactory ?? randomUUID)();
  }

  private now(): string {
    return (this.dependencies.now ?? (() => new Date()))().toISOString();
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) {
      throw new LocalUpdateHandoffError();
    }
    this.activeOperation = true;
    try {
      return await operation();
    } finally {
      this.activeOperation = false;
    }
  }

  private async writeFailedJournal(
    journal: Readonly<UpdateJournal> | undefined,
  ): Promise<void> {
    if (
      journal === undefined ||
      journal.state === 'accepted' ||
      journal.state === 'failed' ||
      journal.state === 'rolledBack'
    ) {
      return;
    }
    await this.dependencies.journalStore
      .write(
        transitionUpdateJournal(journal, {
          at: this.now(),
          state: 'failed',
        }),
      )
      .catch(() => undefined);
  }

  private notifyStarted(
    correlationId: string,
    stage: 'installerHandoff' | 'recoveryPoint' | 'runtimeShutdown',
  ): void {
    try {
      (this.dependencies.observer ?? noOpUpdateOperationalObserver)
        .operationStarted({ correlationId, stage });
    } catch {
      // Operational logging does not control the update transaction.
    }
  }

  private notifyCompleted(
    correlationId: string,
    startedAt: number,
    stage: 'installerHandoff' | 'recoveryPoint' | 'runtimeShutdown',
  ): void {
    try {
      (this.dependencies.observer ?? noOpUpdateOperationalObserver)
        .operationCompleted({
          correlationId,
          durationMs: Math.max(0, Date.now() - startedAt),
          stage,
        });
    } catch {
      // Operational logging does not control the update transaction.
    }
  }

  private notifyFailed(input: {
    correlationId: string;
    errorCode: string;
    sideEffectState: 'none' | 'unknown';
    stage: 'installerHandoff' | 'recoveryPoint' | 'runtimeShutdown';
    startedAt: number;
  }): void {
    try {
      (this.dependencies.observer ?? noOpUpdateOperationalObserver)
        .operationFailed({
          correlationId: input.correlationId,
          durationMs: Math.max(0, Date.now() - input.startedAt),
          errorCode: input.errorCode,
          retryable: false,
          sideEffectState: input.sideEffectState,
          stage: input.stage,
        });
    } catch {
      // Operational logging does not control the update transaction.
    }
  }
}

function readSafePreparationFailureCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const value =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : error.message;
  return /^[A-Z][A-Z0-9_]{2,99}$/.test(value) ? value : undefined;
}

function createPreparedJournal(input: {
  candidateIdentity: Readonly<LocalUpdateExpectedPackageIdentity>;
  correlationId: string;
  currentIdentity: Readonly<LocalUpdateExpectedPackageIdentity>;
  now: string;
  preUpdateMigrationChainIdentity: string;
}): Readonly<UpdateJournal> {
  return parseUpdateJournal({
    candidatePackageIdentity: toJournalIdentity(input.candidateIdentity),
    correlationId: input.correlationId,
    createdAt: input.now,
    currentPackageIdentity: toJournalIdentity(input.currentIdentity),
    currentVersion: input.currentIdentity.appVersion,
    formatVersion: 1,
    handoffAttemptCount: 0,
    preUpdateMigrationChainIdentity:
      input.preUpdateMigrationChainIdentity,
    releaseChannel: 'pilot',
    revision: 1,
    state: 'prepared',
    targetVersion: input.candidateIdentity.appVersion,
    updatedAt: input.now,
  });
}

function toJournalIdentity(
  identity: Readonly<LocalUpdateExpectedPackageIdentity>,
): UpdateJournalPackageIdentity {
  return {
    buildRevision: identity.buildRevision,
    msiProductVersion: identity.msiProductVersion,
    packageSha256: identity.packageSha256,
    packageSize: identity.packageSize,
  };
}
