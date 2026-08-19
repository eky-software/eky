import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
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
  WorkspaceBackupImportJournalV1,
} from './workspaceBackupImportTypes.js';

export interface WorkspaceBackupImportRecoveryOptions {
  readonly activeWorkspaceLifecycle: ActiveWorkspaceLifecyclePort;
  readonly backupCandidate: WorkspaceBackupCandidatePort;
  readonly importJournal: WorkspaceBackupImportJournalStore;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly plaintextQuarantine: WorkspaceBackupPlaintextQuarantineRecoveryPort;
  readonly registry: WorkspaceRegistryPort;
  readonly rootStore: WorkspaceBackupImportRootStore;
  readonly userDataRoot: string;
  readonly workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
}

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
      await this.recoverPlaintextQuarantine();
      const journal = await this.readJournal();
      if (journal === undefined) return 'nothingToRecover';
      await this.assertRuntimeAbsent();

      const paths = deriveWorkspaceBackupImportPaths(
        this.options.userDataRoot,
        journal.operationId,
        journal.workspaceId,
      );
      const registry = readWorkspaceBackupImportRegistry(
        await this.readRegistry(),
      );
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
        await this.completeFromPublishedRoot(journal, registry, paths);
        return 'completedPublication';
      }
      if (isAtOrAfter(journal, 'rootPublished')) {
        return recoveryRequired();
      }

      await this.options.rootStore.discardCandidate(paths);
      await this.ensurePreviousWorkspaceRunning(
        journal.previousActiveWorkspaceId,
      );
      await this.options.importJournal.discardBeforePublication(
        journal.operationId,
      );
      return 'discardedBeforePublication';
    } catch (error) {
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
    journal: Readonly<WorkspaceBackupImportJournalV1>,
    registry: Readonly<LocalWorkspaceRegistryV1>,
    paths: ReturnType<typeof deriveWorkspaceBackupImportPaths>,
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
    await this.options.rootStore.cleanupPublishedOperation(paths);

    let current = journal;
    if (current.state === 'candidateValidated') {
      current = await this.advance(current, 'rootPublished');
    }
    await this.writeRegistry(
      publishImportedWorkspaceEntry(
        registry,
        createImportedWorkspaceEntry({
          workspaceId: current.workspaceId,
          workspaceLabel: current.workspaceLabel,
          lineageIdentity: current.lineageIdentity!,
          createdAt: current.createdAt,
        }),
      ),
    );
    current = await this.advance(current, 'registryPublished');
    await this.ensurePreviousWorkspaceRunning(
      current.previousActiveWorkspaceId,
    );
    await this.options.importJournal.remove(current.operationId);
  }

  private async completeFromPublishedRegistry(
    journal: Readonly<WorkspaceBackupImportJournalV1>,
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
    await this.options.rootStore.cleanupPublishedOperation(paths);
    let current = journal;
    if (current.state === 'rootPublished') {
      current = await this.advance(current, 'registryPublished');
    }
    await this.ensurePreviousWorkspaceRunning(
      current.previousActiveWorkspaceId,
    );
    await this.options.importJournal.remove(current.operationId);
  }

  private async validatePublishedWorkspace(
    journal: Readonly<WorkspaceBackupImportJournalV1>,
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
    journal: Readonly<WorkspaceBackupImportJournalV1>,
    state: 'rootPublished' | 'registryPublished',
  ): Promise<Readonly<WorkspaceBackupImportJournalV1>> {
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

  private ensurePreviousWorkspaceRunning(
    previousActiveWorkspaceId: WorkspaceId | null,
  ) {
    return this.options.activeWorkspaceLifecycle
      .ensurePreviousWorkspaceRunning(previousActiveWorkspaceId)
      .catch(() => {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'activeRuntimeRestart',
        );
      });
  }
}

function isAtOrAfter(
  journal: Readonly<WorkspaceBackupImportJournalV1>,
  state: WorkspaceBackupImportJournalV1['state'],
): boolean {
  return (
    getWorkspaceBackupImportStateIndex(journal.state) >=
    getWorkspaceBackupImportStateIndex(state)
  );
}

function entryMatchesJournal(
  entry: Readonly<LocalWorkspaceRegistryEntryV1>,
  journal: Readonly<WorkspaceBackupImportJournalV1>,
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
