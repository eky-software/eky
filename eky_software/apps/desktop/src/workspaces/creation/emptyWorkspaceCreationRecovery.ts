import type {
  LocalWorkspaceRegistryEntryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import {
  EmptyWorkspaceCreationError,
  mapEmptyWorkspaceCreationError,
} from './emptyWorkspaceCreationError.js';
import type {
  ActiveWorkspaceLifecyclePort,
  PublishedWorkspaceValidationPort,
  WorkspaceRegistryPort,
} from './emptyWorkspaceCreationPorts.js';
import { validateEmptyWorkspaceBootstrapResult } from './emptyWorkspaceBootstrapResult.js';
import { getWorkspaceCreationStateIndex } from './workspaceCreationJournalValidation.js';
import { deriveWorkspaceCreationPaths } from './workspaceCreationPaths.js';
import {
  assertLineageAvailable,
  assertRegistryStillAtPreviousActive,
  createReadyWorkspaceEntry,
  findWorkspaceEntry,
  publishWorkspaceEntry,
  readCreationRegistry,
} from './workspaceCreationRegistry.js';
import type { WorkspaceCreationRootStore } from './workspaceCreationRootStore.js';
import type {
  WorkspaceCreationJournalStore,
  WorkspaceCreationJournalV1,
} from './workspaceCreationTypes.js';
import type { WorkspaceMaintenanceLease } from './workspaceMaintenanceLease.js';

export interface EmptyWorkspaceCreationRecoveryOptions {
  readonly activeWorkspaceLifecycle: ActiveWorkspaceLifecyclePort;
  readonly creationJournal: WorkspaceCreationJournalStore;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly publishedWorkspaceValidation: PublishedWorkspaceValidationPort;
  readonly registry: WorkspaceRegistryPort;
  readonly rootStore: WorkspaceCreationRootStore;
  readonly userDataRoot: string;
}

export type EmptyWorkspaceCreationRecoveryResult =
  | 'nothingToRecover'
  | 'discardedBeforePublication'
  | 'completedPublication';

export class EmptyWorkspaceCreationRecovery {
  constructor(
    private readonly options: Readonly<EmptyWorkspaceCreationRecoveryOptions>,
  ) {}

  async recover(): Promise<EmptyWorkspaceCreationRecoveryResult> {
    const lease = await this.acquireLease();
    try {
      const journal = await this.readJournal();
      if (journal === undefined) return 'nothingToRecover';
      const paths = deriveWorkspaceCreationPaths(
        this.options.userDataRoot,
        journal.operationId,
        journal.workspaceId,
      );
      const registry = readCreationRegistry(await this.readRegistry());
      const entry = findWorkspaceEntry(registry, journal.workspaceId);
      const presence = await this.options.rootStore.readPresence(paths);

      if (presence.candidateExists && presence.finalExists) {
        return recoveryRequired();
      }
      if (entry !== undefined) {
        await this.completeFromPublishedRegistry(
          journal,
          registry.activeWorkspaceId,
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
      await this.restartPrevious(journal.previousActiveWorkspaceId);
      await this.options.creationJournal.discardBeforePublication(
        journal.operationId,
      );
      return 'discardedBeforePublication';
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'recovery',
      );
    } finally {
      await lease.release().catch((error) => {
        throw mapEmptyWorkspaceCreationError(
          error,
          'WORKSPACE_CREATION_LIFECYCLE_FAILED',
          'lease',
        );
      });
    }
  }

  private async completeFromPublishedRoot(
    journal: Readonly<WorkspaceCreationJournalV1>,
    registry: ReturnType<typeof readCreationRegistry>,
    paths: ReturnType<typeof deriveWorkspaceCreationPaths>,
  ): Promise<void> {
    if (
      journal.lineageIdentity === null ||
      (journal.state !== 'candidateValidated' &&
        journal.state !== 'rootPublished')
    ) {
      return recoveryRequired();
    }
    assertRegistryStillAtPreviousActive(
      registry,
      journal.previousActiveWorkspaceId,
    );
    assertLineageAvailable(registry, journal.lineageIdentity);
    await this.options.rootStore.inspectPublished(paths);
    await this.validatePublishedWorkspace(journal, paths);
    await this.options.rootStore.cleanupPublishedOperation(paths);

    let current = journal;
    if (current.state === 'candidateValidated') {
      current = await this.advance(current, 'rootPublished');
    }
    await this.writeRegistry(
      publishWorkspaceEntry(
        registry,
        createReadyWorkspaceEntry({
          workspaceId: current.workspaceId,
          workspaceLabel: current.workspaceLabel,
          lineageIdentity: current.lineageIdentity!,
          createdAt: current.createdAt,
        }),
      ),
    );
    current = await this.advance(current, 'registryPublished');
    await this.restartPrevious(current.previousActiveWorkspaceId);
    await this.options.creationJournal.remove(current.operationId);
  }

  private async completeFromPublishedRegistry(
    journal: Readonly<WorkspaceCreationJournalV1>,
    activeWorkspaceId: WorkspaceId | null,
    entry: Readonly<LocalWorkspaceRegistryEntryV1>,
    candidateExists: boolean,
    finalExists: boolean,
    paths: ReturnType<typeof deriveWorkspaceCreationPaths>,
  ): Promise<void> {
    if (
      candidateExists ||
      !finalExists ||
      journal.lineageIdentity === null ||
      !isAtOrAfter(journal, 'rootPublished') ||
      entry.workspaceLabel !== journal.workspaceLabel ||
      entry.createdAt !== journal.createdAt ||
      entry.layoutVersion !== 1 ||
      entry.lifecycleState !== 'ready' ||
      entry.lineageIdentity.profileId !== journal.lineageIdentity.profileId ||
      activeWorkspaceId !==
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
    await this.restartPrevious(current.previousActiveWorkspaceId);
    await this.options.creationJournal.remove(current.operationId);
  }

  private acquireLease() {
    return this.options.maintenanceLease.acquire('create').catch((error) => {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_BUSY',
        'lease',
      );
    });
  }

  private async validatePublishedWorkspace(
    journal: Readonly<WorkspaceCreationJournalV1>,
    paths: ReturnType<typeof deriveWorkspaceCreationPaths>,
  ): Promise<void> {
    if (journal.lineageIdentity === null) return recoveryRequired();
    let validation;
    try {
      validation = await this.options.publishedWorkspaceValidation
        .validatePublished({
          operationId: journal.operationId,
          workspaceId: journal.workspaceId,
          publishedRoot: paths.finalRoot,
          databaseFilePath: paths.publishedDatabaseFilePath,
          artifactRoot: paths.publishedArtifactRoot,
        });
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'recovery',
      );
    }
    const validated = validateEmptyWorkspaceBootstrapResult(validation);
    if (
      validated.lineageIdentity.profileId !==
      journal.lineageIdentity.profileId
    ) {
      return recoveryRequired();
    }
  }

  private async advance(
    journal: Readonly<WorkspaceCreationJournalV1>,
    state: 'rootPublished' | 'registryPublished',
  ): Promise<Readonly<WorkspaceCreationJournalV1>> {
    const next = Object.freeze({ ...journal, state });
    await this.options.creationJournal.write(next);
    return next;
  }

  private readJournal() {
    return this.options.creationJournal.read().catch((error) => {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_JOURNAL_FAILED',
        'journal',
      );
    });
  }

  private readRegistry() {
    return this.options.registry.read().catch((error) => {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_REGISTRY_FAILED',
        'registryPublish',
      );
    });
  }

  private async writeRegistry(value: unknown): Promise<void> {
    try {
      await this.options.registry.write(value);
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_REGISTRY_FAILED',
        'registryPublish',
      );
    }
  }

  private restartPrevious(previousActiveWorkspaceId: WorkspaceId | null) {
    return this.options.activeWorkspaceLifecycle
      .restartPreviousWorkspace(previousActiveWorkspaceId)
      .catch((error) => {
        throw mapEmptyWorkspaceCreationError(
          error,
          'WORKSPACE_CREATION_LIFECYCLE_FAILED',
          'activeRuntimeRestart',
        );
      });
  }
}

function isAtOrAfter(
  journal: Readonly<WorkspaceCreationJournalV1>,
  state: WorkspaceCreationJournalV1['state'],
): boolean {
  return (
    getWorkspaceCreationStateIndex(journal.state) >=
    getWorkspaceCreationStateIndex(state)
  );
}

function recoveryRequired(): never {
  throw new EmptyWorkspaceCreationError(
    'WORKSPACE_CREATION_RECOVERY_REQUIRED',
    'recovery',
  );
}
