import { randomUUID } from 'node:crypto';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type {
  LocalUpdateExpectedPackageIdentity,
  LocalUpdatePackageCache,
} from './localUpdatePackageCache.js';
import type { AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';
import type { ReadOnlyJournalSlotRecord } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { sameCrashSafeFileSlotIdentity } from '../workspaces/persistence/crashSafeFileSlot.js';
import {
  createBusinessAcceptedBuildMetadata,
  parseVersionedAcceptedBuildMetadata,
  readAcceptedApplicationBuild,
  readAcceptedBusinessBuild,
  type ScopedAcceptedBuildMetadata,
  type VersionedAcceptedBuildMetadata,
} from './acceptedBuildMetadata.js';
import { compareSemanticVersions } from './semanticVersionComparison.js';
import {
  transitionUpdateJournal,
  type UpdateJournal,
} from './updateJournal.js';
import { assertUpdateJournalAuthority, type UpdateJournalStore } from './updateJournalStore.js';
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

// The startup owner binds this authority to the operation, generation, selected
// workspace and allowed W6 transition. It is not a substitute for profile health.
export interface DeferredBusinessFirstStartAuthority {
  readonly acceptedBuild: Readonly<ScopedAcceptedBuildMetadata>;
  readonly migrationChainIdentity: string;
  // Checks external selection/ownership, not the metadata store's own in-flight slots.
  assertCurrent(): Promise<void>;
  assertGenerationCurrent(): void;
}

type FirstStartMigrationContext =
  | Readonly<{ migrationAuthority: 'profileRestore' | 'update' }>
  | Readonly<{
      migrationAuthority: 'deferredBusiness';
      authority: DeferredBusinessFirstStartAuthority;
    }>;

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
  acceptedBuildStore: Pick<AcceptedBuildMetadataStore, 'read' | 'write'> &
    Partial<Pick<AcceptedBuildMetadataStore, 'inspectSlots' | 'publishSelected'>>;
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
  observeStartupException?(error: unknown): void;
  profileProtection: FirstStartProfileProtection;
  readSecretStorageIdentity(): Promise<string | null>;
  releaseInfo: Readonly<DesktopReleaseInfo>;
}

type FirstStartMode =
  | {
      kind: 'deferredBusiness';
      authority: DeferredBusinessFirstStartAuthority;
      acceptedBuild: Readonly<ScopedAcceptedBuildMetadata>;
      acceptedRecord: ReadOnlyJournalSlotRecord<VersionedAcceptedBuildMetadata>;
      migrationChainIdentity: string;
    }
  | { kind: 'coordinated'; journal: Readonly<UpdateJournal>; rotated: boolean }
  | { kind: 'installerNotApplied'; journal: Readonly<UpdateJournal> }
  | { kind: 'rollback'; journal: Readonly<UpdateJournal> }
  | {
      kind: 'directSetup';
      recovery?: Readonly<DirectSetupMigrationRecovery>;
    }
  | { kind: 'initialInstall' | 'normal' };

export class FirstStartUpdateError extends Error {
  constructor(options?: ErrorOptions) {
    super('The installed Eky build could not be accepted safely.', options);
    this.name = 'FirstStartUpdateError';
  }
}

export class FirstStartUpdateCoordinator {
  private acceptedMetadata: VersionedAcceptedBuildMetadata | undefined;
  private deferredBusinessAttempt = false;
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
    context: FirstStartMigrationContext = { migrationAuthority: 'update' },
  ): Promise<void> {
    if (this.migrationGateCompleted) {
      throw new FirstStartUpdateError();
    }
    this.deferredBusinessAttempt = context.migrationAuthority === 'deferredBusiness';

    let coordinatedJournal: Readonly<UpdateJournal> | undefined;
    let installerNotAppliedJournal: Readonly<UpdateJournal> | undefined;
    let rollbackJournal: Readonly<UpdateJournal> | undefined;
    let directSetupRecovery: Readonly<DirectSetupMigrationRecovery> | undefined;
    try {
      if (context.migrationAuthority === 'deferredBusiness') {
        const authority = context.authority;
        context = { migrationAuthority: 'deferredBusiness', authority: Object.freeze({
          acceptedBuild: authority.acceptedBuild,
          migrationChainIdentity: authority.migrationChainIdentity,
          assertCurrent: authority.assertCurrent.bind(authority),
          assertGenerationCurrent: authority.assertGenerationCurrent.bind(authority),
        }) };
        await context.authority.assertCurrent();
      }
      const deferredMetadata = context.migrationAuthority === 'deferredBusiness'
        ? await this.inspectDeferredMetadata(context.authority) : undefined;
      const [journal, acceptedMetadata, storedDirectSetupRecovery] = await Promise.all([
        this.dependencies.journalStore.read(),
        context.migrationAuthority === 'deferredBusiness'
          ? Promise.resolve(deferredMetadata!.value) : this.dependencies.acceptedBuildStore.read(),
        this.dependencies.directSetupRecoveryStore.read(),
      ]);
      this.acceptedMetadata = acceptedMetadata;
      const acceptedBuild = acceptedMetadata === undefined
        ? undefined : readAcceptedApplicationBuild(acceptedMetadata);
      const acceptedBusiness = acceptedMetadata === undefined
        ? undefined : readAcceptedBusinessBuild(acceptedMetadata);
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
        context.migrationAuthority === 'profileRestore' &&
        (directSetupRecovery !== undefined ||
          (journal !== undefined && journal.state !== 'accepted') ||
          acceptedBusiness?.appVersion !==
            this.dependencies.releaseInfo.appVersion ||
          acceptedBusiness.buildRevision !==
            this.dependencies.releaseInfo.buildRevision)
      ) {
        throw new FirstStartUpdateError();
      }

      if (
        directSetupRecovery !== undefined &&
        journal !== undefined &&
        journal.state !== 'accepted'
      ) {
        throw new FirstStartUpdateError();
      }

      if (context.migrationAuthority === 'deferredBusiness') {
        const expected = parseVersionedAcceptedBuildMetadata(context.authority.acceptedBuild);
        if (expected.formatVersion !== 2 || expected.acceptanceScope !== 'selector' ||
          JSON.stringify(expected) !== JSON.stringify(acceptedMetadata) ||
          acceptedBuild?.appVersion !== this.dependencies.releaseInfo.appVersion ||
          acceptedBuild.buildRevision !== this.dependencies.releaseInfo.buildRevision ||
          journal !== undefined || directSetupRecovery !== undefined ||
          inspection.profileState !== 'existing' || inspection.pendingMigrationCount !== 0 ||
          !/^[0-9a-f]{64}$/.test(context.authority.migrationChainIdentity) ||
          inspection.migrationChainIdentity !== context.authority.migrationChainIdentity) {
          throw new FirstStartUpdateError();
        }
        await context.authority.assertCurrent();
        this.mode = {
          kind: 'deferredBusiness', authority: context.authority,
          acceptedBuild: expected, migrationChainIdentity: inspection.migrationChainIdentity,
          acceptedRecord: deferredMetadata!,
        };
        await this.assertDeferredBusinessCurrent(this.mode);
      } else if (acceptedMetadata?.formatVersion === 2 && acceptedMetadata.acceptanceScope === 'selector') {
        // Never turn application admission into business admission or a second migration.
        throw new FirstStartUpdateError();
      } else if (journal !== undefined && journal.state !== 'accepted') {
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
        inspection.pendingMigrationCount > 0 &&
        context.migrationAuthority !== 'profileRestore'
      ) {
        throw new FirstStartUpdateError();
      }
      if (
        context.migrationAuthority === 'profileRestore' &&
        this.mode.kind !== 'normal'
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
    } catch (error) {
      try { this.dependencies.observeStartupException?.(error); } catch { /* Optional private evidence. */ }
      await this.markRollbackRequired(coordinatedJournal);
      await this.markInstallerNotAppliedFailedSafe(
        installerNotAppliedJournal,
      );
      await this.markRollbackRecoveryRequired(rollbackJournal);
      if (!this.deferredBusinessAttempt) {
        await this.markDirectSetupRecoveryRequired(directSetupRecovery);
      }
      this.notifyOperationFailed();
      throw new FirstStartUpdateError({ cause: error });
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
      if (mode.kind === 'deferredBusiness') await this.assertDeferredBusinessCurrent(mode);
      const activeProfile =
        await this.dependencies.profileProtection.validateActiveProfile();
      if (mode.kind === 'deferredBusiness') {
        if (activeProfile.migrationChainIdentity !== mode.migrationChainIdentity) {
          throw new FirstStartUpdateError();
        }
        await this.assertDeferredBusinessCurrent(mode);
      }
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
        const published = createBusinessAcceptedBuildMetadata(this.acceptedMetadata, {
          acceptedAt: this.now(),
          appVersion: this.dependencies.releaseInfo.appVersion,
          buildRevision: this.dependencies.releaseInfo.buildRevision,
          formatVersion: 1,
          releaseChannel: 'pilot',
        });
        if (mode.kind === 'deferredBusiness') await this.assertDeferredBusinessCurrent(mode);
        if (mode.kind === 'deferredBusiness') {
          const store = this.dependencies.acceptedBuildStore;
          if (store.publishSelected === undefined) throw new FirstStartUpdateError();
          const publishedIdentity = await store.publishSelected(published, {
            selected: mode.acceptedRecord,
            assertAuthority: mode.authority.assertGenerationCurrent.bind(mode.authority),
            assertExternalSelection: mode.authority.assertCurrent.bind(mode.authority),
          });
          const observed = await this.inspectDeferredMetadata(mode.authority);
          if (publishedIdentity === undefined || observed.identity === undefined ||
            !sameCrashSafeFileSlotIdentity(publishedIdentity, observed.identity) ||
            !Buffer.from(observed.bytes).equals(Buffer.from(`${JSON.stringify(published)}\n`, 'utf8'))) {
            throw new FirstStartUpdateError();
          }
          await mode.authority.assertCurrent();
        } else await this.dependencies.acceptedBuildStore.write(published);
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
    } catch (error) {
      try { this.dependencies.observeStartupException?.(error); } catch { /* Optional private evidence. */ }
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
      throw new FirstStartUpdateError({ cause: error });
    }

    await this.releaseRecoveryPointProtectionAfterAcceptance(mode);
    this.notifyOperationCompleted();
  }

  async recoverFromStartupFailure(): Promise<boolean> {
    // A rejected deferred admission never acquires an unrelated recovery owner.
    if (this.deferredBusinessAttempt) return false;
    const mode = this.mode;
    if (mode?.kind === 'coordinated') {
      await this.markRollbackRequired(mode.journal);
    } else if (mode?.kind === 'rollback') {
      await this.markRollbackRecoveryRequired(mode.journal);
    } else if (mode?.kind === 'directSetup') {
      await this.markDirectSetupRecoveryRequired(mode.recovery);
    }

    const journal = await this.dependencies.journalStore.read();
    return (
      journal?.state === 'rollbackRequired' &&
      journal.targetVersion === this.dependencies.releaseInfo.appVersion &&
      journal.candidatePackageIdentity.buildRevision ===
        this.dependencies.releaseInfo.buildRevision
    );
  }

  private async assertDeferredBusinessCurrent(
    mode: Extract<FirstStartMode, { kind: 'deferredBusiness' }>,
  ): Promise<void> {
    await mode.authority.assertCurrent();
    const [accepted, journal, directSetup] = await Promise.all([
      this.inspectDeferredMetadata(mode.authority),
      this.dependencies.journalStore.read(),
      this.dependencies.directSetupRecoveryStore.read(),
    ]);
    if (accepted.identity === undefined || mode.acceptedRecord.identity === undefined ||
      !sameCrashSafeFileSlotIdentity(accepted.identity, mode.acceptedRecord.identity) ||
      !Buffer.from(accepted.bytes).equals(Buffer.from(mode.acceptedRecord.bytes)) ||
      JSON.stringify(accepted.value) !== JSON.stringify(mode.acceptedBuild) ||
      journal !== undefined || directSetup !== undefined) {
      throw new FirstStartUpdateError();
    }
    await mode.authority.assertCurrent();
  }

  private async inspectDeferredMetadata(
    authority: DeferredBusinessFirstStartAuthority,
  ): Promise<ReadOnlyJournalSlotRecord<VersionedAcceptedBuildMetadata>> {
    const assertGeneration = () => assertUpdateJournalAuthority(authority.assertGenerationCurrent.bind(authority));
    assertGeneration();
    const store = this.dependencies.acceptedBuildStore;
    if (store.inspectSlots === undefined) throw new FirstStartUpdateError();
    const slots = await store.inspectSlots();
    assertGeneration();
    if (slots.current?.identity === undefined || slots.next !== undefined || slots.backup !== undefined) {
      throw new FirstStartUpdateError();
    }
    return Object.freeze({ bytes: Uint8Array.from(slots.current.bytes), value: slots.current.value,
      identity: Object.freeze({ ...slots.current.identity }) });
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
          state: 'recoveryRequired',
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
