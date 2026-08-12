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
import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
  type DirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';
import type { DirectSetupMigrationRecoveryStore } from './directSetupMigrationRecoveryStore.js';

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
    migrationChainIdentity: string;
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
    | 'normalizeRolledBackPackages'
    | 'promoteAcceptedCandidate'
    | 'revalidateJournalPackage'
  >;
  directSetupRecoveryStore: Pick<
    DirectSetupMigrationRecoveryStore,
    'clear' | 'read' | 'write'
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
  | { kind: 'installerNotApplied'; journal: Readonly<UpdateJournal> }
  | { kind: 'rollback'; journal: Readonly<UpdateJournal> }
  | {
      kind: 'directSetup';
      recovery?: Readonly<DirectSetupMigrationRecovery>;
    }
  | { kind: 'initialInstall' | 'normal' };

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
    let installerNotAppliedJournal: Readonly<UpdateJournal> | undefined;
    let rollbackJournal: Readonly<UpdateJournal> | undefined;
    let directSetupRecovery: Readonly<DirectSetupMigrationRecovery> | undefined;
    try {
      const [journal, acceptedBuild, storedDirectSetupRecovery] = await Promise.all([
        this.dependencies.journalStore.read(),
        this.dependencies.acceptedBuildStore.read(),
        this.dependencies.directSetupRecoveryStore.read(),
      ]);
      directSetupRecovery = storedDirectSetupRecovery;
      this.operationCorrelationId =
        directSetupRecovery !== undefined
          ? directSetupRecovery.correlationId
          : journal !== undefined && journal.state !== 'accepted'
          ? journal.correlationId
          : (this.dependencies.operationIdFactory ?? randomUUID)();
      this.operationStartedAt = Date.now();
      this.notifyOperationStarted();
      this.assertPackagedBuildIdentity();
      this.secretStorageIdentity =
        await this.dependencies.readSecretStorageIdentity();

      if (
        directSetupRecovery !== undefined &&
        journal !== undefined &&
        journal.state !== 'accepted'
      ) {
        throw new FirstStartUpdateError();
      }

      if (journal !== undefined && journal.state !== 'accepted') {
        installerNotAppliedJournal = journal;
        const runningJournalBuild = this.classifyRunningJournalBuild(journal);
        if (runningJournalBuild === 'target') {
          installerNotAppliedJournal = undefined;
          coordinatedJournal = journal;
          this.mode = await this.prepareCoordinatedFirstStart(journal);
        } else {
          if (journal.state === 'awaitingRollbackFirstStart') {
            installerNotAppliedJournal = undefined;
            rollbackJournal = journal;
            this.mode = await this.prepareRollbackFirstStart({
              acceptedBuild,
              inspection,
              journal,
            });
          } else {
            installerNotAppliedJournal = journal;
            this.mode = await this.prepareInstallerNotApplied({
              acceptedBuild,
              inspection,
              journal,
            });
          }
        }
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
        this.mode = await this.prepareUncoordinatedFirstStart({
          acceptedBuild,
          directSetupRecovery,
          inspection,
        });
      }

      if (
        this.mode.kind === 'normal' &&
        inspection.pendingMigrationCount > 0
      ) {
        throw new FirstStartUpdateError();
      }
      if (
        inspection.profileState === 'existing' &&
        inspection.pendingMigrationCount > 0 &&
        this.mode.kind === 'coordinated'
      ) {
        this.preMigrationPointReference =
          await this.dependencies.profileProtection
            .createValidatedPreMigrationPoint();
      }

      this.migrationGateCompleted = true;
    } catch {
      await this.markRollbackRequired(coordinatedJournal);
      await this.markInstallerNotAppliedFailedSafe(
        installerNotAppliedJournal,
      );
      await this.markRollbackRecoveryRequired(rollbackJournal);
      await this.markDirectSetupRecoveryRequired(directSetupRecovery);
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
      const activeProfile =
        await this.dependencies.profileProtection.validateActiveProfile();
      if (
        (mode.kind === 'installerNotApplied' || mode.kind === 'rollback') &&
        activeProfile.migrationChainIdentity !==
          mode.journal.preUpdateMigrationChainIdentity
      ) {
        throw new FirstStartUpdateError();
      }
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

      const acceptedDirectSetupRecovery =
        mode.kind === 'directSetup' && mode.recovery !== undefined
          ? mode.recovery.state === 'accepted'
            ? mode.recovery
            : transitionDirectSetupMigrationRecovery(mode.recovery, {
                at: this.now(),
                state: 'accepted',
              })
          : undefined;
      if (
        mode.kind === 'directSetup' &&
        acceptedDirectSetupRecovery !== undefined &&
        acceptedDirectSetupRecovery !== mode.recovery
      ) {
        await this.dependencies.directSetupRecoveryStore.write(
          acceptedDirectSetupRecovery,
        );
      }

      if (mode.kind !== 'installerNotApplied') {
        await this.dependencies.acceptedBuildStore.write({
          acceptedAt: this.now(),
          appVersion: this.dependencies.releaseInfo.appVersion,
          buildRevision: this.dependencies.releaseInfo.buildRevision,
          formatVersion: 1,
          releaseChannel: 'pilot',
        });
      }

      if (mode.kind === 'coordinated') {
        const acceptedJournal = transitionUpdateJournal(mode.journal, {
          at: this.now(),
          state: 'accepted',
        });
        await this.dependencies.journalStore.write(acceptedJournal);
        this.notifyOperationStateChanged('accepted');
      } else if (mode.kind === 'installerNotApplied') {
        await this.dependencies.journalStore.write(
          transitionUpdateJournal(mode.journal, {
            at: this.now(),
            state: 'installerNotApplied',
          }),
        );
        this.notifyOperationStateChanged('installerNotApplied');
      } else if (mode.kind === 'rollback') {
        await this.dependencies.journalStore.write(
          transitionUpdateJournal(mode.journal, {
            at: this.now(),
            state: 'rolledBack',
          }),
        );
      }
      if (acceptedDirectSetupRecovery !== undefined) {
        await this.dependencies.directSetupRecoveryStore.clear();
      }
    } catch {
      await this.markRollbackRequired(coordinatedJournal);
      await this.markInstallerNotAppliedFailedSafe(
        mode.kind === 'installerNotApplied' ? mode.journal : undefined,
      );
      await this.markRollbackRecoveryRequired(
        mode.kind === 'rollback' ? mode.journal : undefined,
      );
      await this.markDirectSetupRecoveryRequired(
        mode.kind === 'directSetup' ? mode.recovery : undefined,
      );
      this.notifyOperationFailed();
      throw new FirstStartUpdateError();
    }

    await this.releaseRecoveryPointProtectionAfterAcceptance(mode);
    this.notifyOperationCompleted();
  }

  async recoverFromStartupFailure(): Promise<boolean> {
    const mode = this.mode;
    if (mode?.kind === 'coordinated') {
      await this.markRollbackRequired(mode.journal);
    } else if (mode?.kind === 'rollback') {
      await this.markRollbackRecoveryRequired(mode.journal);
    } else if (mode?.kind === 'directSetup') {
      await this.markDirectSetupRecoveryRequired(mode.recovery);
    }

    const [journal, directSetupRecovery] = await Promise.all([
      this.dependencies.journalStore.read(),
      this.dependencies.directSetupRecoveryStore.read(),
    ]);
    return (
      (journal?.state === 'rollbackRequired' &&
        journal.targetVersion === this.dependencies.releaseInfo.appVersion &&
        journal.candidatePackageIdentity.buildRevision ===
          this.dependencies.releaseInfo.buildRevision) ||
      (directSetupRecovery?.state === 'recoveryRequired' &&
        directSetupRecovery.runningTargetBuildIdentity.appVersion ===
          this.dependencies.releaseInfo.appVersion &&
        directSetupRecovery.runningTargetBuildIdentity.buildRevision ===
          this.dependencies.releaseInfo.buildRevision)
    );
  }

  private classifyRunningJournalBuild(
    journal: Readonly<UpdateJournal>,
  ): 'current' | 'target' {
    const runningVersion = this.dependencies.releaseInfo.appVersion;
    const runningRevision = this.dependencies.releaseInfo.buildRevision;
    if (
      runningVersion === journal.targetVersion &&
      runningRevision === journal.candidatePackageIdentity.buildRevision
    ) {
      return 'target';
    }
    if (
      runningVersion === journal.currentVersion &&
      runningRevision === journal.currentPackageIdentity.buildRevision
    ) {
      return 'current';
    }
    throw new FirstStartUpdateError();
  }

  private async prepareInstallerNotApplied(input: {
    acceptedBuild:
      | { appVersion: string; buildRevision: string }
      | undefined;
    inspection: Readonly<MigrationStartupInspection>;
    journal: Readonly<UpdateJournal>;
  }): Promise<FirstStartMode> {
    const { acceptedBuild, inspection, journal } = input;
    if (
      (journal.state !== 'awaitingFirstStart' && journal.state !== 'failed') ||
      journal.handoffAttemptCount !== 1 ||
      journal.recoveryPointReference === undefined ||
      journal.preUpdateMigrationChainIdentity === undefined ||
      acceptedBuild?.appVersion !== journal.currentVersion ||
      acceptedBuild.buildRevision !==
        journal.currentPackageIdentity.buildRevision ||
      inspection.profileState !== 'existing' ||
      inspection.pendingMigrationCount !== 0 ||
      inspection.migrationChainIdentity !==
        journal.preUpdateMigrationChainIdentity
    ) {
      throw new FirstStartUpdateError();
    }
    await this.dependencies.cache.revalidateJournalPackage({
      expectedIdentity: toExpectedIdentity(
        journal.currentVersion,
        journal.currentPackageIdentity,
      ),
      role: 'current',
    });
    return { journal, kind: 'installerNotApplied' };
  }

  private async prepareRollbackFirstStart(input: {
    acceptedBuild:
      | { appVersion: string; buildRevision: string }
      | undefined;
    inspection: Readonly<MigrationStartupInspection>;
    journal: Readonly<UpdateJournal>;
  }): Promise<FirstStartMode> {
    const { acceptedBuild, inspection, journal } = input;
    const acceptedBuildMatchesCurrent =
      acceptedBuild?.appVersion === journal.currentVersion &&
      acceptedBuild.buildRevision ===
        journal.currentPackageIdentity.buildRevision;
    const acceptedBuildMatchesCandidate =
      acceptedBuild?.appVersion === journal.targetVersion &&
      acceptedBuild.buildRevision ===
        journal.candidatePackageIdentity.buildRevision;
    if (
      journal.state !== 'awaitingRollbackFirstStart' ||
      journal.handoffAttemptCount !== 1 ||
      journal.binaryRollbackAttemptCount !== 1 ||
      journal.recoveryPointReference === undefined ||
      journal.preUpdateMigrationChainIdentity === undefined ||
      (!acceptedBuildMatchesCurrent && !acceptedBuildMatchesCandidate) ||
      inspection.profileState !== 'existing' ||
      inspection.pendingMigrationCount !== 0 ||
      inspection.migrationChainIdentity !==
        journal.preUpdateMigrationChainIdentity
    ) {
      throw new FirstStartUpdateError();
    }
    await this.dependencies.cache.normalizeRolledBackPackages({
      candidateIdentity: toExpectedIdentity(
        journal.targetVersion,
        journal.candidatePackageIdentity,
      ),
      currentIdentity: toExpectedIdentity(
        journal.currentVersion,
        journal.currentPackageIdentity,
      ),
    });
    return { journal, kind: 'rollback' };
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
      await this.dependencies.cache.revalidateJournalPackage({
        expectedIdentity: toExpectedIdentity(
          journal.currentVersion,
          journal.currentPackageIdentity,
        ),
        role: 'current',
      });
      await this.dependencies.cache.revalidateJournalPackage({
        expectedIdentity: toExpectedIdentity(
          journal.targetVersion,
          journal.candidatePackageIdentity,
        ),
        role: 'candidate',
      });
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

  private async prepareUncoordinatedFirstStart(input: {
    acceptedBuild:
      | {
          appVersion: string;
          buildRevision: string;
        }
      | undefined;
    directSetupRecovery:
      | Readonly<DirectSetupMigrationRecovery>
      | undefined;
    inspection: Readonly<MigrationStartupInspection>;
  }): Promise<FirstStartMode> {
    if (input.directSetupRecovery?.state === 'awaitingPreviousBuild') {
      return this.preparePreviousBuildAfterDirectSetupRollback(
        input.directSetupRecovery,
        input.acceptedBuild,
        input.inspection,
      );
    }
    if (input.directSetupRecovery?.state === 'accepted') {
      this.assertDirectSetupRecoveryIdentity(
        input.directSetupRecovery,
        input.acceptedBuild,
        true,
      );
      if (input.inspection.pendingMigrationCount !== 0) {
        throw new FirstStartUpdateError();
      }
      this.preMigrationPointReference =
        input.directSetupRecovery.recoveryPointReference;
      return { kind: 'directSetup', recovery: input.directSetupRecovery };
    }

    const mode = this.resolveDirectSetupMode(input.acceptedBuild);
    if (input.directSetupRecovery !== undefined) {
      if (mode.kind !== 'directSetup') {
        throw new FirstStartUpdateError();
      }
      return {
        kind: 'directSetup',
        recovery: await this.resumeDirectSetupRecovery(
          input.directSetupRecovery,
          input.acceptedBuild,
          input.inspection,
        ),
      };
    }
    if (
      mode.kind !== 'directSetup' ||
      input.inspection.profileState !== 'existing' ||
      input.inspection.pendingMigrationCount === 0
    ) {
      return mode;
    }
    if (input.acceptedBuild === undefined) {
      throw new FirstStartUpdateError();
    }

    const recoveryPointReference =
      await this.dependencies.profileProtection.createValidatedPreMigrationPoint();
    const prepared = createDirectSetupMigrationRecovery({
      appliedMigrationCount: input.inspection.appliedMigrationCount,
      at: this.now(),
      correlationId: requireOperationCorrelationId(
        this.operationCorrelationId,
      ),
      migrationPrefixIdentity: input.inspection.migrationChainIdentity,
      previousAcceptedBuildIdentity: {
        appVersion: input.acceptedBuild.appVersion,
        buildRevision: input.acceptedBuild.buildRevision,
      },
      recoveryPointReference,
      runningTargetBuildIdentity: {
        appVersion: this.dependencies.releaseInfo.appVersion,
        buildRevision: this.dependencies.releaseInfo.buildRevision,
      },
    });
    await this.dependencies.directSetupRecoveryStore.write(prepared);
    const running = transitionDirectSetupMigrationRecovery(prepared, {
      at: this.now(),
      state: 'migrationRunning',
    });
    await this.dependencies.directSetupRecoveryStore.write(running);
    this.preMigrationPointReference = recoveryPointReference;
    return { kind: 'directSetup', recovery: running };
  }

  private preparePreviousBuildAfterDirectSetupRollback(
    recovery: Readonly<DirectSetupMigrationRecovery>,
    acceptedBuild: { appVersion: string; buildRevision: string } | undefined,
    inspection: Readonly<MigrationStartupInspection>,
  ): FirstStartMode {
    if (
      acceptedBuild?.appVersion !==
        recovery.previousAcceptedBuildIdentity.appVersion ||
      acceptedBuild.buildRevision !==
        recovery.previousAcceptedBuildIdentity.buildRevision ||
      this.dependencies.releaseInfo.appVersion !==
        recovery.previousAcceptedBuildIdentity.appVersion ||
      this.dependencies.releaseInfo.buildRevision !==
        recovery.previousAcceptedBuildIdentity.buildRevision ||
      inspection.profileState !== 'existing' ||
      inspection.appliedMigrationCount !== recovery.appliedMigrationCount ||
      inspection.migrationChainIdentity !== recovery.migrationPrefixIdentity ||
      inspection.pendingMigrationCount !== 0
    ) {
      throw new FirstStartUpdateError();
    }
    this.preMigrationPointReference = recovery.recoveryPointReference;
    return { kind: 'directSetup', recovery };
  }

  private async resumeDirectSetupRecovery(
    recovery: Readonly<DirectSetupMigrationRecovery>,
    acceptedBuild: { appVersion: string; buildRevision: string } | undefined,
    inspection: Readonly<MigrationStartupInspection>,
  ): Promise<Readonly<DirectSetupMigrationRecovery>> {
    this.assertDirectSetupRecoveryIdentity(recovery, acceptedBuild, false);
    if (
      (recovery.state !== 'prepared' &&
        recovery.state !== 'migrationRunning') ||
      inspection.profileState !== 'existing' ||
      inspection.appliedMigrationCount !== recovery.appliedMigrationCount ||
      inspection.migrationChainIdentity !== recovery.migrationPrefixIdentity ||
      inspection.pendingMigrationCount === 0
    ) {
      throw new FirstStartUpdateError();
    }
    const running = transitionDirectSetupMigrationRecovery(recovery, {
      at: this.now(),
      attemptCount: recovery.attemptCount + 1,
      state: 'migrationRunning',
    });
    await this.dependencies.directSetupRecoveryStore.write(running);
    this.preMigrationPointReference = recovery.recoveryPointReference;
    return running;
  }

  private assertDirectSetupRecoveryIdentity(
    recovery: Readonly<DirectSetupMigrationRecovery>,
    acceptedBuild: { appVersion: string; buildRevision: string } | undefined,
    allowAcceptedTarget: boolean,
  ): void {
    const matchesPrevious =
      acceptedBuild?.appVersion ===
        recovery.previousAcceptedBuildIdentity.appVersion &&
      acceptedBuild.buildRevision ===
        recovery.previousAcceptedBuildIdentity.buildRevision;
    const matchesTarget =
      allowAcceptedTarget &&
      acceptedBuild?.appVersion ===
        recovery.runningTargetBuildIdentity.appVersion &&
      acceptedBuild.buildRevision ===
        recovery.runningTargetBuildIdentity.buildRevision;
    if (
      acceptedBuild === undefined ||
      (!matchesPrevious && !matchesTarget) ||
      recovery.runningTargetBuildIdentity.appVersion !==
        this.dependencies.releaseInfo.appVersion ||
      recovery.runningTargetBuildIdentity.buildRevision !==
        this.dependencies.releaseInfo.buildRevision
    ) {
      throw new FirstStartUpdateError();
    }
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
    await this.dependencies.cache.revalidateJournalPackage({
      expectedIdentity: toExpectedIdentity(
        journal.targetVersion,
        journal.candidatePackageIdentity,
      ),
      role: 'current',
    });
    await this.dependencies.cache.revalidateJournalPackage({
      expectedIdentity: toExpectedIdentity(
        journal.currentVersion,
        journal.currentPackageIdentity,
      ),
      role: 'previous',
    });
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

  private async markDirectSetupRecoveryRequired(
    recovery: Readonly<DirectSetupMigrationRecovery> | undefined,
  ): Promise<void> {
    if (
      recovery === undefined ||
      recovery.state === 'accepted' ||
      recovery.state === 'failedSafe' ||
      recovery.state === 'recoveryRequired'
    ) {
      return;
    }
    await this.dependencies.directSetupRecoveryStore
      .write(
        transitionDirectSetupMigrationRecovery(recovery, {
          at: this.now(),
          state:
            recovery.state === 'awaitingPreviousBuild'
              ? 'failedSafe'
              : 'recoveryRequired',
        }),
      )
      .catch(() => undefined);
  }

  private async markInstallerNotAppliedFailedSafe(
    journal: Readonly<UpdateJournal> | undefined,
  ): Promise<void> {
    if (
      journal === undefined ||
      journal.state === 'failedSafe' ||
      journal.state === 'installerNotApplied'
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

  private async markRollbackRecoveryRequired(
    journal: Readonly<UpdateJournal> | undefined,
  ): Promise<void> {
    if (
      journal === undefined ||
      journal.state === 'recoveryRequired' ||
      journal.state === 'rolledBack'
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

  private async releaseRecoveryPointProtectionAfterAcceptance(
    mode: Exclude<FirstStartMode, { kind: 'normal' }>,
  ): Promise<void> {
    const references = [
      ...(mode.kind === 'coordinated' ||
      mode.kind === 'installerNotApplied' ||
      mode.kind === 'rollback'
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

  private notifyOperationStateChanged(
    state: 'accepted' | 'installerNotApplied',
  ): void {
    const correlationId = this.operationCorrelationId;
    if (correlationId === undefined) {
      return;
    }
    try {
      (this.dependencies.observer ?? noOpUpdateOperationalObserver)
        .operationStateChanged?.({
          correlationId,
          stage: 'firstStartValidation',
          state,
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

function requireOperationCorrelationId(value: string | undefined): string {
  if (value === undefined) {
    throw new FirstStartUpdateError();
  }
  return value;
}
