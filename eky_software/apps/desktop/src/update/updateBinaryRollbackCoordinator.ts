import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type {
  LocalUpdatePackageCache,
  RevalidatedLocalUpdatePackageHandle,
} from './localUpdatePackageCache.js';
import {
  transitionUpdateJournal,
  type UpdateJournal,
} from './updateJournal.js';
import type { UpdateJournalStore } from './updateJournalStore.js';
import {
  noOpUpdateOperationalObserver,
  type UpdateOperationalObserver,
} from './updateOperationalObserver.js';

interface UpdateBinaryRollbackCoordinatorDependencies {
  cache: Pick<
    LocalUpdatePackageCache,
    | 'hasExpectedJournalPackage'
    | 'normalizeRolledBackPackages'
    | 'revalidateJournalPackage'
    | 'registerExactRollbackPackage'
  >;
  journalStore: Pick<UpdateJournalStore, 'read' | 'write'>;
  launchInstaller(
    packages: Readonly<{
      failedPackage: Readonly<RevalidatedLocalUpdatePackageHandle>;
      rollbackPackage: Readonly<RevalidatedLocalUpdatePackageHandle>;
    }>,
  ): Promise<void>;
  now?(): Date;
  observer?: UpdateOperationalObserver;
  releaseInfo: Readonly<DesktopReleaseInfo>;
}

export class UpdateBinaryRollbackError extends Error {
  constructor() {
    super('The update binary rollback requires recovery.');
    this.name = 'UpdateBinaryRollbackError';
  }
}

export class UpdateRollbackPackageRequiredError extends Error {
  constructor() {
    super('The exact rollback package must be selected manually.');
    this.name = 'UpdateRollbackPackageRequiredError';
  }
}

export class UpdateBinaryRollbackCoordinator {
  constructor(
    private readonly dependencies: UpdateBinaryRollbackCoordinatorDependencies,
  ) {}

  async startIfRequired(): Promise<'launched' | 'notRequired'> {
    let journal = await this.dependencies.journalStore.read();
    if (journal === undefined) {
      return 'notRequired';
    }
    if (
      journal.state === 'binaryRollbackPrepared' ||
      journal.state === 'awaitingRollbackFirstStart'
    ) {
      if (this.classifyRunningBuild(journal) === 'current') {
        return 'notRequired';
      }
      await this.requireRecovery(journal);
      throw new UpdateBinaryRollbackError();
    }
    if (journal.state !== 'businessRollbackCompleted') {
      return 'notRequired';
    }

    this.notifyStarted(journal.correlationId);
    this.assertRunningFailedTarget(journal);
    const currentIdentity = {
      appVersion: journal.currentVersion,
      ...journal.currentPackageIdentity,
    };
    if (
      !(await this.dependencies.cache.hasExpectedJournalPackage({
        expectedIdentity: currentIdentity,
        roles: ['current', 'previous'],
      }))
    ) {
      await this.dependencies.journalStore.write(
        transitionUpdateJournal(journal, {
          at: this.now(),
          state: 'rollbackPackageRequired',
        }),
      );
      this.notifyFailed(journal.correlationId, 'UPDATE_ROLLBACK_PACKAGE_REQUIRED');
      throw new UpdateRollbackPackageRequiredError();
    }
    try {
      const rollbackPackage =
        await this.dependencies.cache.normalizeRolledBackPackages({
          candidateIdentity: {
            appVersion: journal.targetVersion,
            ...journal.candidatePackageIdentity,
          },
          currentIdentity,
        });
      const failedPackage =
        await this.dependencies.cache.revalidateJournalPackage({
          expectedIdentity: {
            appVersion: journal.targetVersion,
            ...journal.candidatePackageIdentity,
          },
          role: 'candidate',
        });
      journal = transitionUpdateJournal(journal, {
        at: this.now(),
        binaryRollbackAttemptCount: 1,
        state: 'binaryRollbackPrepared',
      });
      await this.dependencies.journalStore.write(journal);
      journal = transitionUpdateJournal(journal, {
        at: this.now(),
        state: 'awaitingRollbackFirstStart',
      });
      await this.dependencies.journalStore.write(journal);
      await this.dependencies.launchInstaller({
        failedPackage,
        rollbackPackage,
      });
      this.notifyCompleted(journal.correlationId);
      return 'launched';
    } catch {
      await this.failSafe(journal);
      this.notifyFailed(journal.correlationId);
      throw new UpdateBinaryRollbackError();
    }
  }

  async registerAndStartManualRollback(
    manifestPath: string,
  ): Promise<'launched'> {
    const journal = await this.dependencies.journalStore.read();
    if (journal?.state !== 'rollbackPackageRequired') {
      throw new UpdateBinaryRollbackError();
    }
    this.assertRunningFailedTarget(journal);
    await this.dependencies.cache.registerExactRollbackPackage({
      expectedIdentity: {
        appVersion: journal.currentVersion,
        ...journal.currentPackageIdentity,
      },
      manifestPath,
    });
    await this.dependencies.journalStore.write(
      transitionUpdateJournal(journal, {
        at: this.now(),
        state: 'businessRollbackCompleted',
      }),
    );
    const result = await this.startIfRequired();
    if (result !== 'launched') {
      throw new UpdateBinaryRollbackError();
    }
    return result;
  }

  private assertRunningFailedTarget(journal: Readonly<UpdateJournal>): void {
    if (this.classifyRunningBuild(journal) !== 'target') {
      throw new UpdateBinaryRollbackError();
    }
  }

  private classifyRunningBuild(
    journal: Readonly<UpdateJournal>,
  ): 'current' | 'target' {
    if (
      journal.releaseChannel !== this.dependencies.releaseInfo.releaseChannel
    ) {
      throw new UpdateBinaryRollbackError();
    }
    if (
      journal.targetVersion === this.dependencies.releaseInfo.appVersion &&
      journal.candidatePackageIdentity.buildRevision ===
        this.dependencies.releaseInfo.buildRevision
    ) {
      return 'target';
    }
    if (
      journal.currentVersion === this.dependencies.releaseInfo.appVersion &&
      journal.currentPackageIdentity.buildRevision ===
        this.dependencies.releaseInfo.buildRevision
    ) {
      return 'current';
    }
    throw new UpdateBinaryRollbackError();
  }

  private async failSafe(journal: Readonly<UpdateJournal>): Promise<void> {
    if (
      journal.state !== 'businessRollbackCompleted' &&
      journal.state !== 'binaryRollbackPrepared' &&
      journal.state !== 'awaitingRollbackFirstStart'
    ) {
      return;
    }
    await this.dependencies.journalStore
      .write(
        transitionUpdateJournal(journal, {
          at: this.now(),
          state: 'failedSafe',
        }),
      )
      .catch(() => undefined);
  }

  private async requireRecovery(journal: Readonly<UpdateJournal>): Promise<void> {
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

  private notifyStarted(correlationId: string): void {
    this.notify((observer) => observer.operationStarted({
      correlationId,
      stage: 'binaryRollback',
    }));
  }

  private notifyCompleted(correlationId: string): void {
    this.notify((observer) => observer.operationCompleted({
      correlationId,
      durationMs: 0,
      stage: 'binaryRollback',
    }));
  }

  private notifyFailed(
    correlationId: string,
    errorCode = 'UPDATE_BINARY_ROLLBACK_FAILED',
  ): void {
    this.notify((observer) => observer.operationFailed({
      correlationId,
      durationMs: 0,
      errorCode,
      retryable: false,
      sideEffectState: 'unknown',
      stage: 'binaryRollback',
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
