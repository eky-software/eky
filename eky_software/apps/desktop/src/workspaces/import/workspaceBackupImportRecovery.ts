import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistry,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import {
  assertColdWorkspaceRecoveryContinuation,
  assertColdWorkspaceRecoveryRegistryUnchanged,
} from '../runtime/assertColdWorkspaceRecoveryContinuation.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import { appendRecoveredWorkspaceEntry, workspaceSelectionAfterPublication } from '../registry/workspaceRegistryMutations.js';
import {
  WorkspaceBackupImportError,
  mapWorkspaceBackupImportError,
} from './workspaceBackupImportError.js';
import { getWorkspaceBackupImportStateIndex } from './workspaceBackupImportJournalValidation.js';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import type { WorkspaceBackupCandidatePort } from './workspaceBackupImportPorts.js';
import type { WorkspaceBackupPlaintextQuarantineRecoveryPort } from './workspaceBackupPlaintextQuarantine.js';
import { validateWorkspaceBackupCandidateReadiness } from './workspaceBackupImportReadiness.js';
import {
  assertImportLineageAvailable,
  assertImportRegistryStillAtPreviousActive,
  assertImportWorkspaceIdAvailable,
  createImportedWorkspaceEntry,
  findImportedWorkspaceEntry,
  readWorkspaceBackupImportRegistry,
} from './workspaceBackupImportRegistry.js';
import type {
  WorkspaceBackupImportRootStore,
} from './workspaceBackupImportRootStore.js';
import type {
  WorkspaceBackupImportJournalStore,
  WorkspaceBackupImportJournal,
} from './workspaceBackupImportTypes.js';
import type { CaptureWorkspaceBackupImportColdOwner, ColdImportJournalPort, ColdImportRegistryPort } from './workspaceBackupImportColdOwner.js';
import { WorkspaceBackupImportColdContext } from './workspaceBackupImportColdContext.js';

interface SharedWorkspaceBackupImportRecoveryOptions {
  readonly backupCandidate: WorkspaceBackupCandidatePort;
  readonly importJournal: WorkspaceBackupImportJournalStore;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly plaintextQuarantine: WorkspaceBackupPlaintextQuarantineRecoveryPort;
  readonly registry: WorkspaceRegistryPort;
  readonly rootStore: WorkspaceBackupImportRootStore;
  readonly userDataRoot: string;
  readonly workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
}

export type WorkspaceBackupImportRecoveryOptions =
  SharedWorkspaceBackupImportRecoveryOptions & (
    | Readonly<{
        completionMode?: 'running';
        activeWorkspaceLifecycle: ActiveWorkspaceLifecyclePort;
      }>
    | Readonly<{
        completionMode: 'beforeRuntimeStart';
        assertRecoveryAdmission(): Promise<void>;
        captureColdOwner: CaptureWorkspaceBackupImportColdOwner;
        importJournal: ColdImportJournalPort & WorkspaceBackupImportJournalStore;
        registry: ColdImportRegistryPort & WorkspaceRegistryPort;
        activeWorkspaceLifecycle?: never;
      }>
  );

export type WorkspaceBackupImportRecoveryResult =
  | 'nothingToRecover'
  | 'discardedBeforePublication'
  | 'completedPublication';

export class WorkspaceBackupImportRecovery {
  private cold: WorkspaceBackupImportColdContext | undefined;
  constructor(
    private readonly options: Readonly<WorkspaceBackupImportRecoveryOptions>,
  ) {}

  async recover(): Promise<WorkspaceBackupImportRecoveryResult> {
    const lease = await this.acquireLease();
    let failed = false;
    this.cold = undefined;
    try {
      this.cold = this.options.completionMode === 'beforeRuntimeStart' ? new WorkspaceBackupImportColdContext({
        owner: this.options.captureColdOwner(lease), importJournal: this.options.importJournal,
        registry: this.options.registry, rootStore: this.options.rootStore,
        userDataRoot: this.options.userDataRoot, workspaceRuntimeAbsence: this.options.workspaceRuntimeAbsence,
      }) : undefined;
      if (this.options.completionMode === 'beforeRuntimeStart') {
        await this.assertRuntimeAbsent();
        await this.options.assertRecoveryAdmission();
        await this.cold!.initialize();
      } else {
        await this.recoverPlaintextQuarantine();
      }
      const journal = await this.readJournal();
      if (this.options.completionMode === 'beforeRuntimeStart' &&
          journal !== undefined && journal.formatVersion !== 2) {
        throw new WorkspaceManagementRecoveryRequiredError();
      }
      if (journal === undefined) return 'nothingToRecover';
      await this.assertRuntimeAbsent();

      const paths = deriveWorkspaceBackupImportPaths(
        this.options.userDataRoot,
        journal.operationId,
        journal.workspaceId,
      );
      const registrySnapshot = await this.readRegistry();
      if (this.options.completionMode === 'beforeRuntimeStart' && registrySnapshot === undefined) {
        throw new WorkspaceManagementRecoveryRequiredError();
      }
      const registryValue = readWorkspaceBackupImportRegistry(registrySnapshot);
      const registry = this.options.completionMode === 'beforeRuntimeStart'
        ? validateWorkspaceRegistry(registryValue)
        : registryValue;
      if (this.options.completionMode === 'beforeRuntimeStart') {
        await this.assertRuntimeAbsent();
        await this.recoverPlaintextQuarantine();
      }
      const entry = findImportedWorkspaceEntry(registry, journal.workspaceId);
      await this.cold?.assertPayloadCurrent();
      const presence = await this.options.rootStore.readPresence(paths);
      await this.cold?.assertPayloadCurrent();

      if (presence.candidateExists && presence.finalExists) {
        return recoveryRequired();
      }
      if (entry !== undefined) {
        await this.completeFromPublishedRegistry(
          journal,
          registry,
          entry,
          presence.candidateExists,
          presence.finalExists,
          paths,
        );
        return 'completedPublication';
      }
      if (presence.finalExists) {
        await this.completeFromPublishedRoot(journal, registry, paths, registrySnapshot);
        return 'completedPublication';
      }
      if (isAtOrAfter(journal, 'rootPublished')) {
        return recoveryRequired();
      }

      if (this.options.completionMode === 'beforeRuntimeStart') {
        await this.assertColdContinuation(journal.previousActiveWorkspaceId, registry);
      }
      await this.cold?.assertPayloadCurrent();
      if (this.cold) await this.options.rootStore.discardCandidate(paths, this.cold.mutationAuthority);
      else await this.options.rootStore.discardCandidate(paths);
      await this.cold?.assertPayloadCurrent();
      await this.completeRecovery(journal, registry, false);
      if (this.cold) await this.cold.clearJournal(true);
      else await this.options.importJournal.discardBeforePublication(journal.operationId);
      return 'discardedBeforePublication';
    } catch (error) {
      failed = true;
      this.cold?.recordFailure(error);
      if (this.options.completionMode === 'beforeRuntimeStart' &&
          error instanceof WorkspaceManagementRecoveryRequiredError) {
        throw error;
      }
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
        'recovery',
      );
    } finally {
      if (this.cold !== undefined) {
        const release = await this.cold.release(lease);
        if (release.failed && !failed) throw mapWorkspaceBackupImportError(release.error, 'WORKSPACE_IMPORT_LIFECYCLE_FAILED', 'lease');
      } else await lease.release().catch((error) => {
        if (failed && this.options.completionMode === 'beforeRuntimeStart') return;
        throw mapWorkspaceBackupImportError(
          error,
          'WORKSPACE_IMPORT_LIFECYCLE_FAILED',
          'lease',
        );
      });
    }
  }

  private async completeFromPublishedRoot(
    journal: Readonly<WorkspaceBackupImportJournal>,
    registry: Readonly<LocalWorkspaceRegistry>,
    paths: ReturnType<typeof deriveWorkspaceBackupImportPaths>,
    registrySnapshot: Readonly<LocalWorkspaceRegistry> | undefined,
  ): Promise<void> {
    if (
      journal.lineageIdentity === null ||
      (journal.state !== 'candidateValidated' &&
        journal.state !== 'rootPublished')
    ) {
      return recoveryRequired();
    }

    assertImportRegistryStillAtPreviousActive(
      registry,
      journal.previousActiveWorkspaceId,
    );
    assertImportWorkspaceIdAvailable(registry, journal.workspaceId);
    assertImportLineageAvailable(registry, journal.lineageIdentity);
    await this.cold?.assertPayloadCurrent();
    await this.options.rootStore.inspectPublished(paths);
    await this.cold?.assertPayloadCurrent();
    await this.validatePublishedWorkspace(journal, paths);
    await this.assertRuntimeAbsent();
    if (this.cold) await this.options.rootStore.cleanupPublishedOperation(paths, this.cold.mutationAuthority);
    else await this.options.rootStore.cleanupPublishedOperation(paths);
    await this.cold?.assertPayloadCurrent();

    let current = journal;
    if (current.state === 'candidateValidated') {
      current = await this.advance(current, 'rootPublished');
    }
    const expectedRegistry = appendRecoveredWorkspaceEntry(
      registry,
      createImportedWorkspaceEntry({
        workspaceId: current.workspaceId,
        workspaceLabel: current.workspaceLabel,
        lineageIdentity: current.lineageIdentity!,
        createdAt: current.createdAt,
      }),
    );
    if (this.options.completionMode === 'beforeRuntimeStart') {
      await assertColdWorkspaceRecoveryRegistryUnchanged({
        expectedRegistry: registrySnapshot,
        registry: this.cold ? { read: () => this.cold!.readRegistry() } : this.options.registry,
      });
    }
    await this.writeRegistry(expectedRegistry);
    current = await this.advance(current, 'registryPublished');
    await this.completeRecovery(current, expectedRegistry, true);
    if (this.cold) await this.cold.clearJournal(false);
    else await this.options.importJournal.remove(current.operationId);
  }

  private async completeFromPublishedRegistry(
    journal: Readonly<WorkspaceBackupImportJournal>,
    registry: Readonly<LocalWorkspaceRegistry>,
    entry: Readonly<LocalWorkspaceRegistryEntryV1>,
    candidateExists: boolean,
    finalExists: boolean,
    paths: ReturnType<typeof deriveWorkspaceBackupImportPaths>,
  ): Promise<void> {
    if (
      candidateExists ||
      !finalExists ||
      journal.lineageIdentity === null ||
      !isAtOrAfter(journal, 'rootPublished') ||
      !entryMatchesJournal(entry, journal) ||
      registry.activeWorkspaceId !==
        workspaceSelectionAfterPublication(registry.formatVersion, journal.previousActiveWorkspaceId, journal.workspaceId)
    ) {
      return recoveryRequired();
    }

    await this.cold?.assertPayloadCurrent();
    await this.options.rootStore.inspectPublished(paths);
    await this.cold?.assertPayloadCurrent();
    await this.validatePublishedWorkspace(journal, paths);
    await this.assertRuntimeAbsent();
    if (this.cold) await this.options.rootStore.cleanupPublishedOperation(paths, this.cold.mutationAuthority);
    else await this.options.rootStore.cleanupPublishedOperation(paths);
    await this.cold?.assertPayloadCurrent();
    let current = journal;
    if (current.state === 'rootPublished') {
      current = await this.advance(current, 'registryPublished');
    }
    await this.completeRecovery(current, registry, true);
    if (this.cold) await this.cold.clearJournal(false);
    else await this.options.importJournal.remove(current.operationId);
  }

  private async validatePublishedWorkspace(
    journal: Readonly<WorkspaceBackupImportJournal>,
    paths: ReturnType<typeof deriveWorkspaceBackupImportPaths>,
  ): Promise<void> {
    if (journal.lineageIdentity === null) return recoveryRequired();
    let readiness;
    try {
      await this.cold?.assertPayloadCurrent();
      const validate = () => this.options.backupCandidate.validatePublished({
        operationId: journal.operationId, workspaceId: journal.workspaceId, publishedRoot: paths.finalRoot,
        databaseFilePath: paths.publishedDatabaseFilePath, artifactRoot: paths.publishedArtifactRoot,
        expectedProfileId: journal.lineageIdentity!.profileId,
      });
      readiness = validateWorkspaceBackupCandidateReadiness(
        await (this.cold ? this.cold.work(validate) : validate()),
      );
      await this.cold?.assertPayloadCurrent();
    } catch (error) {
      this.cold?.recordFailure(error);
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
        'recovery',
      );
    }
    if (
      readiness.lineageIdentity.profileId !==
      journal.lineageIdentity.profileId
    ) {
      return recoveryRequired();
    }
  }

  private acquireLease() {
    return this.options.maintenanceLease.acquire('import').catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_BUSY',
        'lease',
      );
    });
  }

  private async assertRuntimeAbsent(): Promise<void> {
    try {
      await this.options.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime();
    } catch {
      return recoveryRequired();
    }
  }

  private recoverPlaintextQuarantine(): Promise<void> {
    const work = this.cold ? this.options.plaintextQuarantine.recoverStalePayloads(this.cold.mutationAuthority)
      : this.options.plaintextQuarantine.recoverStalePayloads();
    return work
      .catch((error) => {
        this.cold?.recordFailure(error);
        throw mapWorkspaceBackupImportError(
          error,
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'plaintextQuarantine',
        );
      });
  }

  private readJournal() {
    if (this.cold) return this.cold.readJournal();
    return this.options.importJournal.read().catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_JOURNAL_FAILED',
        'journal',
      );
    });
  }

  private readRegistry() {
    if (this.cold) return this.cold.readRegistry();
    return this.options.registry.read().catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_REGISTRY_FAILED',
        'registryRead',
      );
    });
  }

  private async writeRegistry(value: unknown): Promise<void> {
    try {
      if (this.cold) await this.cold.writeRegistry(value);
      else await this.options.registry.write(value);
    } catch (error) {
      if (this.cold && error instanceof WorkspaceManagementRecoveryRequiredError) throw error;
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_REGISTRY_FAILED',
        'registryPublish',
      );
    }
  }

  private async advance(
    journal: Readonly<WorkspaceBackupImportJournal>,
    state: 'rootPublished' | 'registryPublished',
  ): Promise<Readonly<WorkspaceBackupImportJournal>> {
    const next = Object.freeze({ ...journal, state });
    try {
      if (this.cold) await this.cold.writeJournal(next);
      else await this.options.importJournal.write(next);
    } catch (error) {
      if (this.cold && error instanceof WorkspaceManagementRecoveryRequiredError) throw error;
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_JOURNAL_FAILED',
        'journal',
      );
    }
    return next;
  }

  private async assertColdContinuation(
    expectedWorkspaceId: WorkspaceId | null,
    expectedRegistry: Readonly<LocalWorkspaceRegistry>,
  ): Promise<void> {
    await this.assertRuntimeAbsent();
    await assertColdWorkspaceRecoveryContinuation({
      expectedRegistry,
      expectedWorkspaceId,
      registry: this.cold ? { read: () => this.cold!.readRegistry() } : this.options.registry,
      userDataRoot: this.options.userDataRoot,
    });
    await this.assertRuntimeAbsent();
  }

  private async completeRecovery(
    journal: Readonly<WorkspaceBackupImportJournal>,
    expectedRegistry: Readonly<LocalWorkspaceRegistry>,
    published: boolean,
  ): Promise<void> {
    if (this.options.completionMode === 'beforeRuntimeStart') {
      await this.assertColdContinuation(
        published
          ? workspaceSelectionAfterPublication(expectedRegistry.formatVersion, journal.previousActiveWorkspaceId, journal.workspaceId)
          : journal.previousActiveWorkspaceId,
        expectedRegistry,
      );
      return;
    }
    return this.options.activeWorkspaceLifecycle
      .ensurePreviousWorkspaceRunning(journal.previousActiveWorkspaceId)
      .catch(() => {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'activeRuntimeRestart',
        );
      });
  }
}

function isAtOrAfter(
  journal: Readonly<WorkspaceBackupImportJournal>,
  state: WorkspaceBackupImportJournal['state'],
): boolean {
  return (
    getWorkspaceBackupImportStateIndex(journal.state) >=
    getWorkspaceBackupImportStateIndex(state)
  );
}

function entryMatchesJournal(
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
  journal: Readonly<WorkspaceBackupImportJournal>,
): boolean {
  return (
    entry.workspaceLabel === journal.workspaceLabel &&
    entry.createdAt === journal.createdAt &&
    entry.layoutVersion === 1 &&
    entry.lifecycleState === 'ready' &&
    entry.lineageIdentity.profileId === journal.lineageIdentity?.profileId
  );
}

function recoveryRequired(): never {
  throw new WorkspaceBackupImportError(
    'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
    'recovery',
  );
}
