import { randomUUID } from 'node:crypto';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type {
  LocalUpdateExpectedPackageIdentity,
  LocalUpdatePackageCache,
} from './localUpdatePackageCache.js';
import type { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import { compareSemanticVersions } from './semanticVersionComparison.js';
import {
  transitionUpdateJournal,
  type UpdateJournal,
} from './updateJournal.js';
import type { UpdateJournalStore } from './updateJournalStore.js';
import {
  noOpUpdateOperationalObserver,
  type UpdateOperationalObserver,
} from './updateOperationalObserver.js';

export interface MigrationStartupInspection {
  appliedMigrationCount: number;
  migrationChainIdentity: string;
  pendingMigrationCount: number;
  profileState: 'empty' | 'existing';
}

interface FirstStartProfileProtection {
  createValidatedPreMigrationPoint(): Promise<string>;
  releaseProtectedPoint(recoveryPointReference: string): Promise<void>;
  validateActiveProfile(): Promise<{
    artifactCount: number;
    artifactTotalByteSize: number;
    databaseHealth: 'healthy';
  }>;
}

interface FirstStartUpdateCoordinatorDependencies {
  acceptedBuildStore: Pick<AcceptedBuildMetadataStore, 'read' | 'write'>;
  buildInfo: {
    buildDirty: boolean;
    buildRevision: string;
  };
  cache: Pick<
    LocalUpdatePackageCache,
    'promoteAcceptedCandidate' | 'revalidateJournalPackage'
  >;
  journalStore: Pick<UpdateJournalStore, 'read' | 'write'>;
  now?(): Date;
  operationIdFactory?(): string;
  observer?: UpdateOperationalObserver;
  profileProtection: FirstStartProfileProtection;
  readSecretStorageIdentity(): Promise<string | null>;
  releaseInfo: Readonly<DesktopReleaseInfo>;
}

type FirstStartMode =
  | { kind: 'coordinated'; journal: Readonly<UpdateJournal>; rotated: boolean }
  | { kind: 'directSetup' | 'initialInstall' | 'normal' };

export class FirstStartUpdateError extends Error {
  constructor() {
    super('The installed Eky build could not be accepted safely.');
    this.name = 'FirstStartUpdateError';
  }
}

export class FirstStartUpdateCoordinator {
  private migrationGateCompleted = false;
  private mode: FirstStartMode | undefined;
  private operationCorrelationId: string | undefined;
  private operationStartedAt: number | undefined;
  private preMigrationPointReference: string | undefined;
  private secretStorageIdentity: string | null | undefined;

  constructor(
    private readonly dependencies: FirstStartUpdateCoordinatorDependencies,
  ) {}

  async beforeMigrations(
    inspection: Readonly<MigrationStartupInspection>,
  ): Promise<void> {
    if (this.migrationGateCompleted) {
      throw new FirstStartUpdateError();
    }

    let coordinatedJournal: Readonly<UpdateJournal> | undefined;
    try {
      const [journal, acceptedBuild] = await Promise.all([
        this.dependencies.journalStore.read(),
        this.dependencies.acceptedBuildStore.read(),
      ]);
      this.operationCorrelationId =
        journal !== undefined && journal.state !== 'accepted'
          ? journal.correlationId
          : (this.dependencies.operationIdFactory ?? randomUUID)();
      this.operationStartedAt = Date.now();
      this.notifyOperationStarted();
      this.assertPackagedBuildIdentity();
      this.secretStorageIdentity =
        await this.dependencies.readSecretStorageIdentity();

      if (journal !== undefined && journal.state !== 'accepted') {
        coordinatedJournal = journal;
        this.mode = await this.prepareCoordinatedFirstStart(journal);
      } else {
        if (
          journal?.state === 'accepted' &&
          (acceptedBuild === undefined ||
            acceptedBuild.appVersion !== journal.targetVersion ||
            acceptedBuild.buildRevision !==
              journal.candidatePackageIdentity.buildRevision)
        ) {
          throw new FirstStartUpdateError();
        }
        this.mode = this.resolveDirectSetupMode(acceptedBuild);
      }

      if (
        this.mode.kind === 'normal' &&
        inspection.pendingMigrationCount > 0
      ) {
        throw new FirstStartUpdateError();
      }
      if (
        inspection.profileState === 'existing' &&
        inspection.pendingMigrationCount > 0
      ) {
        this.preMigrationPointReference =
          await this.dependencies.profileProtection
            .createValidatedPreMigrationPoint();
      }

      this.migrationGateCompleted = true;
    } catch {
      await this.markRollbackRequired(coordinatedJournal);
      this.notifyOperationFailed();
      throw new FirstStartUpdateError();
    }
  }

  async acceptAfterBackendReady(): Promise<void> {
    const mode = this.mode;
    if (!this.migrationGateCompleted || mode === undefined) {
      throw new FirstStartUpdateError();
    }
    if (mode.kind === 'normal') {
      this.notifyOperationCompleted();
      return;
    }

    const coordinatedJournal =
      mode.kind === 'coordinated' ? mode.journal : undefined;
    try {
      await this.dependencies.profileProtection.validateActiveProfile();
      if (
        (await this.dependencies.readSecretStorageIdentity()) !==
        this.secretStorageIdentity
      ) {
        throw new FirstStartUpdateError();
      }

      if (mode.kind === 'coordinated') {
        if (!mode.rotated) {
          await this.dependencies.cache.promoteAcceptedCandidate({
            candidateIdentity: toExpectedIdentity(
              mode.journal.targetVersion,
              mode.journal.candidatePackageIdentity,
            ),
            currentIdentity: toExpectedIdentity(
              mode.journal.currentVersion,
              mode.journal.currentPackageIdentity,
            ),
          });
        }
        await this.assertAcceptedRotation(mode.journal);
      }

      await this.dependencies.acceptedBuildStore.write({
        acceptedAt: this.now(),
        appVersion: this.dependencies.releaseInfo.appVersion,
        buildRevision: this.dependencies.releaseInfo.buildRevision,
        formatVersion: 1,
        releaseChannel: 'pilot',
      });

      if (mode.kind === 'coordinated') {
        const acceptedJournal = transitionUpdateJournal(mode.journal, {
          at: this.now(),
          state: 'accepted',
        });
        await this.dependencies.journalStore.write(acceptedJournal);
      }
    } catch {
      await this.markRollbackRequired(coordinatedJournal);
      this.notifyOperationFailed();
      throw new FirstStartUpdateError();
    }

    await this.releaseRecoveryPointProtectionAfterAcceptance(mode);
    this.notifyOperationCompleted();
  }

  private async prepareCoordinatedFirstStart(
    journal: Readonly<UpdateJournal>,
  ): Promise<FirstStartMode> {
    if (
      (journal.state !== 'awaitingFirstStart' &&
        journal.state !== 'firstStartValidating') ||
      journal.targetVersion !== this.dependencies.releaseInfo.appVersion ||
      journal.candidatePackageIdentity.buildRevision !==
        this.dependencies.releaseInfo.buildRevision ||
      journal.releaseChannel !== this.dependencies.releaseInfo.releaseChannel ||
      journal.recoveryPointReference === undefined
    ) {
      throw new FirstStartUpdateError();
    }

    let rotated = false;
    try {
      await Promise.all([
        this.dependencies.cache.revalidateJournalPackage({
          expectedIdentity: toExpectedIdentity(
            journal.currentVersion,
            journal.currentPackageIdentity,
          ),
          role: 'current',
        }),
        this.dependencies.cache.revalidateJournalPackage({
          expectedIdentity: toExpectedIdentity(
            journal.targetVersion,
            journal.candidatePackageIdentity,
          ),
          role: 'candidate',
        }),
      ]);
    } catch {
      await this.assertAcceptedRotation(journal);
      rotated = true;
    }

    const validatingJournal =
      journal.state === 'firstStartValidating'
        ? journal
        : transitionUpdateJournal(journal, {
            at: this.now(),
            state: 'firstStartValidating',
          });
    if (validatingJournal !== journal) {
      await this.dependencies.journalStore.write(validatingJournal);
    }
    return { journal: validatingJournal, kind: 'coordinated', rotated };
  }

  private resolveDirectSetupMode(
    acceptedBuild:
      | {
          appVersion: string;
          buildRevision: string;
        }
      | undefined,
  ): FirstStartMode {
    if (acceptedBuild === undefined) {
      return { kind: 'initialInstall' };
    }
    if (
      acceptedBuild.appVersion === this.dependencies.releaseInfo.appVersion &&
      acceptedBuild.buildRevision ===
        this.dependencies.releaseInfo.buildRevision
    ) {
      return { kind: 'normal' };
    }
    if (
      compareSemanticVersions(
        this.dependencies.releaseInfo.appVersion,
        acceptedBuild.appVersion,
      ) <= 0
    ) {
      throw new FirstStartUpdateError();
    }
    return { kind: 'directSetup' };
  }

  private assertPackagedBuildIdentity(): void {
    if (
      this.dependencies.buildInfo.buildDirty ||
      this.dependencies.buildInfo.buildRevision !==
        this.dependencies.releaseInfo.buildRevision
    ) {
      throw new FirstStartUpdateError();
    }
  }

  private async assertAcceptedRotation(
    journal: Readonly<UpdateJournal>,
  ): Promise<void> {
    await Promise.all([
      this.dependencies.cache.revalidateJournalPackage({
        expectedIdentity: toExpectedIdentity(
          journal.targetVersion,
          journal.candidatePackageIdentity,
        ),
        role: 'current',
      }),
      this.dependencies.cache.revalidateJournalPackage({
        expectedIdentity: toExpectedIdentity(
          journal.currentVersion,
          journal.currentPackageIdentity,
        ),
        role: 'previous',
      }),
    ]);
  }

  private async markRollbackRequired(
    journal: Readonly<UpdateJournal> | undefined,
  ): Promise<void> {
    if (
      journal === undefined ||
      (journal.state !== 'awaitingFirstStart' &&
        journal.state !== 'firstStartValidating')
    ) {
      return;
    }
    await this.dependencies.journalStore
      .write(
        transitionUpdateJournal(journal, {
          at: this.now(),
          state: 'rollbackRequired',
        }),
      )
      .catch(() => undefined);
  }

  private async releaseRecoveryPointProtectionAfterAcceptance(
    mode: Exclude<FirstStartMode, { kind: 'normal' }>,
  ): Promise<void> {
    const references = [
      ...(mode.kind === 'coordinated'
        ? [requireRecoveryPointReference(mode.journal)]
        : []),
      ...(this.preMigrationPointReference === undefined
        ? []
        : [this.preMigrationPointReference]),
    ];

    await Promise.all(
      references.map((reference) =>
        this.dependencies.profileProtection
          .releaseProtectedPoint(reference)
          .catch(() => undefined),
      ),
    );
  }

  private now(): string {
    return (this.dependencies.now ?? (() => new Date()))().toISOString();
  }

  private notifyOperationStarted(): void {
    const correlationId = this.operationCorrelationId;
    if (correlationId === undefined) {
      return;
    }
    try {
      (this.dependencies.observer ?? noOpUpdateOperationalObserver)
        .operationStarted({
          correlationId,
          stage: 'firstStartValidation',
        });
    } catch {
      // Operational logging never becomes the acceptance authority.
    }
  }

  private notifyOperationCompleted(): void {
    const input = this.createOperationResultInput();
    if (input === undefined) {
      return;
    }
    try {
      (this.dependencies.observer ?? noOpUpdateOperationalObserver)
        .operationCompleted(input);
    } catch {
      // Operational logging never becomes the acceptance authority.
    }
  }

  private notifyOperationFailed(): void {
    const input = this.createOperationResultInput();
    if (input === undefined) {
      return;
    }
    try {
      (this.dependencies.observer ?? noOpUpdateOperationalObserver)
        .operationFailed({
          ...input,
          errorCode: 'UPDATE_FIRST_START_FAILED',
          retryable: false,
          sideEffectState: 'unknown',
        });
    } catch {
      // Operational logging never becomes the acceptance authority.
    }
  }

  private createOperationResultInput():
    | {
        correlationId: string;
        durationMs: number;
        stage: 'firstStartValidation';
      }
    | undefined {
    if (
      this.operationCorrelationId === undefined ||
      this.operationStartedAt === undefined
    ) {
      return undefined;
    }
    return {
      correlationId: this.operationCorrelationId,
      durationMs: Math.max(0, Date.now() - this.operationStartedAt),
      stage: 'firstStartValidation',
    };
  }
}

function toExpectedIdentity(
  appVersion: string,
  identity: Readonly<UpdateJournal['candidatePackageIdentity']>,
): LocalUpdateExpectedPackageIdentity {
  return { appVersion, ...identity };
}

function requireRecoveryPointReference(
  journal: Readonly<UpdateJournal>,
): string {
  if (journal.recoveryPointReference === undefined) {
    throw new FirstStartUpdateError();
  }
  return journal.recoveryPointReference;
}
