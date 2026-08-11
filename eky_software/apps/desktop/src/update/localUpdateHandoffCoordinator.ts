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
  constructor() {
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
      try {
        await this.assertJournalCanBeReplaced();
        const [currentIdentity, candidateIdentity] = await Promise.all([
          this.dependencies.cache.readExpectedPackageIdentity('current'),
          this.dependencies.cache.readExpectedPackageIdentity('candidate'),
        ]);
        journal = createPreparedJournal({
          candidateIdentity,
          correlationId: this.createOperationId(),
          currentIdentity,
          now: this.now(),
        });
        await this.dependencies.journalStore.write(journal);
        await this.dependencies.profileProtection.validateActiveProfile();
        const recoveryPointReference =
          await this.dependencies.profileProtection
            .createValidatedPreUpdatePoint();
        journal = transitionUpdateJournal(journal, {
          at: this.now(),
          recoveryPointReference,
          state: 'recoveryPointValidated',
        });
        await this.dependencies.journalStore.write(journal);
        return journal;
      } catch {
        await this.writeFailedJournal(journal);
        throw new LocalUpdateHandoffError();
      }
    });
  }

  handoffPreparedUpdate(): Promise<void> {
    return this.runExclusive(async () => {
      let journal: Readonly<UpdateJournal> | undefined;
      let maintenanceStarted = false;
      let runtimeStopped = false;
      try {
        journal = await this.dependencies.journalStore.read();
        if (
          journal === undefined ||
          journal.state !== 'recoveryPointValidated' ||
          journal.handoffAttemptCount !== 0
        ) {
          throw new LocalUpdateHandoffError();
        }
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
        await this.dependencies.profileProtection.validateActiveProfile();
        journal = transitionUpdateJournal(journal, {
          at: this.now(),
          state: 'runtimeStopping',
        });
        await this.dependencies.journalStore.write(journal);
        await this.dependencies.shutdownRuntime();
        runtimeStopped = true;
        journal = transitionUpdateJournal(journal, {
          at: this.now(),
          handoffAttemptCount: 1,
          state: 'awaitingFirstStart',
        });
        await this.dependencies.journalStore.write(journal);
        await this.dependencies.launchInstaller(candidate);
      } catch {
        if (maintenanceStarted && !runtimeStopped && journal !== undefined) {
          await this.dependencies.profileProtection
            .leaveMaintenance(journal.correlationId)
            .catch(() => undefined);
        }
        await this.writeFailedJournal(journal);
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
}

function createPreparedJournal(input: {
  candidateIdentity: Readonly<LocalUpdateExpectedPackageIdentity>;
  correlationId: string;
  currentIdentity: Readonly<LocalUpdateExpectedPackageIdentity>;
  now: string;
}): Readonly<UpdateJournal> {
  return parseUpdateJournal({
    candidatePackageIdentity: toJournalIdentity(input.candidateIdentity),
    correlationId: input.correlationId,
    createdAt: input.now,
    currentPackageIdentity: toJournalIdentity(input.currentIdentity),
    currentVersion: input.currentIdentity.appVersion,
    formatVersion: 1,
    handoffAttemptCount: 0,
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
