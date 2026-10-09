import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import {
  assertColdWorkspaceRecoveryContinuation,
  assertColdWorkspaceRecoveryRegistryUnchanged,
} from '../runtime/assertColdWorkspaceRecoveryContinuation.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
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
  publishImportedWorkspaceEntry,
  readWorkspaceBackupImportRegistry,
} from './workspaceBackupImportRegistry.js';
import type {
  WorkspaceBackupImportRootStore,
} from './workspaceBackupImportRootStore.js';
import type {
  WorkspaceBackupImportJournalStore,
  WorkspaceBackupImportJournal,
} from './workspaceBackupImportTypes.js';

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
        activeWorkspaceLifecycle?: never;
      }>
  );

export type WorkspaceBackupImportRecoveryResult =
  | 'nothingToRecover'
  | 'discardedBeforePublication'
  | 'completedPublication';

export class WorkspaceBackupImportRecovery {
  constructor(
    private readonly options: Readonly<WorkspaceBackupImportRecoveryOptions>,
  ) {}

  async recover(): Promise<WorkspaceBackupImportRecoveryResult> {
    const lease = await this.acquireLease();
    try {
      if (this.options.completionMode === 'beforeRuntimeStart') {
        await this.assertRuntimeAbsent();
        await this.options.assertRecoveryAdmission();
      } else {
        await this.recoverPlaintextQuarantine();
      }
      const journal = await this.readJournal();
      if (this.options.completionMode === 'beforeRuntimeStart' &&
          journal !== undefined && journal.formatVersion !== 2) {
        throw new WorkspaceManagementRecoveryRequiredError();
      }
      if (journal === undefined) return 'nothingToRecover';
      if (this.options.completionMode === 'beforeRuntimeStart') {
        await this.assertRuntimeAbsent();
        await this.recoverPlaintextQuarantine();
      }
      await this.assertRuntimeAbsent();

      const paths = deriveWorkspaceBackupImportPaths(
        this.options.userDataRoot,
        journal.operationId,
        journal.workspaceId,
      );
      const registrySnapshot = await this.readRegistry();
      const registryValue = readWorkspaceBackupImportRegistry(registrySnapshot);
      const registry = this.options.completionMode === 'beforeRuntimeStart'
        ? validateWorkspaceRegistry(registryValue)
        : registryValue;
      const entry = findImportedWorkspaceEntry(registry, journal.workspaceId);
      const presence = await this.options.rootStore.readPresence(paths);

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
      await this.options.rootStore.discardCandidate(paths);
      await this.completeRecovery(journal, registry, false);
      await this.options.importJournal.discardBeforePublication(
        journal.operationId,
      );
      return 'discardedBeforePublication';
    } catch (error) {
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
      await lease.release().catch((error) => {
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
    registry: Readonly<LocalWorkspaceRegistryV1>,
    paths: ReturnType<typeof deriveWorkspaceBackupImportPaths>,
    registrySnapshot: Readonly<LocalWorkspaceRegistryV1> | undefined,
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
    await this.options.rootStore.inspectPublished(paths);
    await this.validatePublishedWorkspace(journal, paths);
    await this.assertRuntimeAbsent();
    await this.options.rootStore.cleanupPublishedOperation(paths);

    let current = journal;
    if (current.state === 'candidateValidated') {
      current = await this.advance(current, 'rootPublished');
    }
    const expectedRegistry = publishImportedWorkspaceEntry(
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
        registry: this.options.registry,
      });
    }
    await this.writeRegistry(expectedRegistry);
    current = await this.advance(current, 'registryPublished');
    await this.completeRecovery(current, expectedRegistry, true);
    await this.options.importJournal.remove(current.operationId);
  }

  private async completeFromPublishedRegistry(
    journal: Readonly<WorkspaceBackupImportJournal>,
    registry: Readonly<LocalWorkspaceRegistryV1>,
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
        (journal.previousActiveWorkspaceId ?? journal.workspaceId)
    ) {
      return recoveryRequired();
    }

    await this.options.rootStore.inspectPublished(paths);
    await this.validatePublishedWorkspace(journal, paths);
    await this.assertRuntimeAbsent();
    await this.options.rootStore.cleanupPublishedOperation(paths);
    let current = journal;
    if (current.state === 'rootPublished') {
      current = await this.advance(current, 'registryPublished');
    }
    await this.completeRecovery(current, registry, true);
    await this.options.importJournal.remove(current.operationId);
  }

  private async validatePublishedWorkspace(
    journal: Readonly<WorkspaceBackupImportJournal>,
    paths: ReturnType<typeof deriveWorkspaceBackupImportPaths>,
  ): Promise<void> {
    if (journal.lineageIdentity === null) return recoveryRequired();
    let readiness;
    try {
      readiness = validateWorkspaceBackupCandidateReadiness(
        await this.options.backupCandidate.validatePublished({
          operationId: journal.operationId,
          workspaceId: journal.workspaceId,
          publishedRoot: paths.finalRoot,
          databaseFilePath: paths.publishedDatabaseFilePath,
          artifactRoot: paths.publishedArtifactRoot,
          expectedProfileId: journal.lineageIdentity.profileId,
        }),
      );
    } catch (error) {
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
    return this.options.plaintextQuarantine
      .recoverStalePayloads()
      .catch((error) => {
        throw mapWorkspaceBackupImportError(
          error,
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'plaintextQuarantine',
        );
      });
  }

  private readJournal() {
    return this.options.importJournal.read().catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_JOURNAL_FAILED',
        'journal',
      );
    });
  }

  private readRegistry() {
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
      await this.options.registry.write(value);
    } catch (error) {
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
      await this.options.importJournal.write(next);
    } catch (error) {
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
    expectedRegistry: Readonly<LocalWorkspaceRegistryV1>,
  ): Promise<void> {
    await this.assertRuntimeAbsent();
    await assertColdWorkspaceRecoveryContinuation({
      expectedRegistry,
      expectedWorkspaceId,
      registry: this.options.registry,
      userDataRoot: this.options.userDataRoot,
    });
    await this.assertRuntimeAbsent();
  }

  private async completeRecovery(
    journal: Readonly<WorkspaceBackupImportJournal>,
    expectedRegistry: Readonly<LocalWorkspaceRegistryV1>,
    published: boolean,
  ): Promise<void> {
    if (this.options.completionMode === 'beforeRuntimeStart') {
      await this.assertColdContinuation(
        journal.previousActiveWorkspaceId ?? (published ? journal.workspaceId : null),
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
