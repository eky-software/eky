import { generateWorkspaceId } from '../registry/workspaceIdGeneration.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId, WorkspaceLineageIdentityV1 } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import {
  EmptyWorkspaceCreationError,
  mapEmptyWorkspaceCreationError,
} from './emptyWorkspaceCreationError.js';
import type {
  EmptyWorkspaceBootstrapResult,
  EmptyWorkspaceBootstrapPort,
} from './emptyWorkspaceCreationPorts.js';
import { validateEmptyWorkspaceBootstrapResult } from './emptyWorkspaceBootstrapResult.js';
import { generateWorkspaceCreationOperationId } from './workspaceCreationOperationId.js';
import { deriveWorkspaceCreationPaths } from './workspaceCreationPaths.js';
import {
  assertLineageAvailable,
  assertWorkspaceIdAvailable,
  createReadyWorkspaceEntry,
  publishWorkspaceEntry,
  readCreationRegistry,
} from './workspaceCreationRegistry.js';
import type { WorkspaceCreationRootStore } from './workspaceCreationRootStore.js';
import type {
  WorkspaceCreationJournalState,
  WorkspaceCreationJournalStore,
  WorkspaceCreationJournalV1,
  WorkspaceCreationOperationId,
} from './workspaceCreationTypes.js';

export interface EmptyWorkspaceCreationCoordinatorOptions {
  readonly activeWorkspaceLifecycle: ActiveWorkspaceLifecyclePort;
  readonly bootstrap: EmptyWorkspaceBootstrapPort;
  readonly creationJournal: WorkspaceCreationJournalStore;
  readonly generateOperationId?: () => WorkspaceCreationOperationId;
  readonly generateWorkspaceId?: () => WorkspaceId;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly now?: () => Date;
  readonly registry: WorkspaceRegistryPort;
  readonly rootStore: WorkspaceCreationRootStore;
  readonly userDataRoot: string;
}

export interface EmptyWorkspaceCreationResult {
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
}

export class EmptyWorkspaceCreationCoordinator {
  private readonly generateOperationId: () => WorkspaceCreationOperationId;
  private readonly generateWorkspace: () => WorkspaceId;
  private readonly now: () => Date;

  constructor(
    private readonly options: Readonly<EmptyWorkspaceCreationCoordinatorOptions>,
  ) {
    this.generateOperationId =
      options.generateOperationId ?? generateWorkspaceCreationOperationId;
    this.generateWorkspace = options.generateWorkspaceId ?? generateWorkspaceId;
    this.now = options.now ?? (() => new Date());
  }

  async create(
    workspaceLabelInput: unknown,
  ): Promise<Readonly<EmptyWorkspaceCreationResult>> {
    let workspaceLabel: string;
    try {
      workspaceLabel = validateWorkspaceLabel(workspaceLabelInput);
    } catch {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_INVALID',
        'inputValidation',
      );
    }

    const lease = await this.acquireLease();
    let journal: Readonly<WorkspaceCreationJournalV1> | undefined;
    let previousActiveWorkspaceId: WorkspaceId | null = null;
    let previousRuntimeStopped = false;
    try {
      if ((await this.readJournal()) !== undefined) {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_RECOVERY_REQUIRED',
          'journal',
        );
      }
      const registry = readCreationRegistry(await this.readRegistry());
      previousActiveWorkspaceId = registry.activeWorkspaceId;

      await this.runLifecycle(
        'activeRuntimeQuiesce',
        () =>
          this.options.activeWorkspaceLifecycle.quiesceWrites(
            previousActiveWorkspaceId,
          ),
      );
      const stopped = await this.runLifecycle(
        'activeRuntimeStop',
        () =>
          this.options.activeWorkspaceLifecycle.stopAndProveHandlesClosed(
            previousActiveWorkspaceId,
          ),
      );
      if (stopped.handlesClosed !== true) {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_LIFECYCLE_FAILED',
          'activeRuntimeStop',
        );
      }
      previousRuntimeStopped = true;

      let operationId: WorkspaceCreationOperationId;
      let workspaceId: WorkspaceId;
      try {
        operationId = this.generateOperationId();
        workspaceId = this.generateWorkspace();
      } catch {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_INVALID',
          'identityGeneration',
        );
      }
      assertWorkspaceIdAvailable(registry, workspaceId);
      const paths = deriveWorkspaceCreationPaths(
        this.options.userDataRoot,
        operationId,
        workspaceId,
      );
      const createdAt = validateCreationTime(this.now);
      journal = Object.freeze({
        formatVersion: 1,
        operationId,
        workspaceId,
        workspaceLabel,
        previousActiveWorkspaceId,
        state: 'prepared',
        createdAt,
        lineageIdentity: null,
      });
      await this.writeJournal(journal);

      await this.options.rootStore.createCandidate(paths);
      journal = await this.advanceJournal(journal, 'candidateRootCreated');

      let bootstrap: Readonly<EmptyWorkspaceBootstrapResult>;
      try {
        bootstrap = validateEmptyWorkspaceBootstrapResult(
          await this.options.bootstrap.bootstrap({
            operationId,
            workspaceId,
            candidateRoot: paths.candidateRoot,
            databaseFilePath: paths.databaseFilePath,
            artifactRoot: paths.artifactRoot,
          }),
        );
      } catch (error) {
        throw mapEmptyWorkspaceCreationError(
          error,
          'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
          'bootstrap',
        );
      }
      assertLineageAvailable(registry, bootstrap.lineageIdentity);
      journal = await this.advanceJournal(
        journal,
        'bootstrapCompleted',
        bootstrap.lineageIdentity,
      );

      await this.options.rootStore.inspectCandidate(paths);
      journal = await this.advanceJournal(
        journal,
        'candidateValidated',
        bootstrap.lineageIdentity,
      );

      await this.options.rootStore.publishCandidate(paths);
      journal = await this.advanceJournal(
        journal,
        'rootPublished',
        bootstrap.lineageIdentity,
      );
      await this.options.rootStore.cleanupPublishedOperation(paths);

      if (journal.lineageIdentity === null) {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_RECOVERY_REQUIRED',
          'registryPublish',
        );
      }
      const entry = createReadyWorkspaceEntry({
        workspaceId: journal.workspaceId,
        workspaceLabel: journal.workspaceLabel,
        lineageIdentity: journal.lineageIdentity,
        createdAt: journal.createdAt,
      });
      await this.writeRegistry(publishWorkspaceEntry(registry, entry));
      journal = await this.advanceJournal(
        journal,
        'registryPublished',
        bootstrap.lineageIdentity,
      );

      await this.restartPrevious(previousActiveWorkspaceId);
      previousRuntimeStopped = false;
      await this.options.creationJournal.remove(operationId);
      return Object.freeze({ workspaceId, workspaceLabel });
    } catch (error) {
      await this.handleFailure(
        journal,
        previousActiveWorkspaceId,
        previousRuntimeStopped,
      );
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

  private async handleFailure(
    journal: Readonly<WorkspaceCreationJournalV1> | undefined,
    previousActiveWorkspaceId: WorkspaceId | null,
    previousRuntimeStopped: boolean,
  ): Promise<void> {
    if (journal === undefined) {
      if (previousRuntimeStopped) {
        await this.restartPrevious(previousActiveWorkspaceId).catch(() => {
          throw new EmptyWorkspaceCreationError(
            'WORKSPACE_CREATION_RECOVERY_REQUIRED',
            'activeRuntimeRestart',
          );
        });
      }
      return;
    }

    let persistedJournal: Readonly<WorkspaceCreationJournalV1> | undefined;
    try {
      persistedJournal = await this.options.creationJournal.read();
    } catch {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'recovery',
      );
    }
    if (
      persistedJournal !== undefined &&
      persistedJournal.operationId !== journal.operationId
    ) {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'recovery',
      );
    }

    const paths = deriveWorkspaceCreationPaths(
      this.options.userDataRoot,
      journal.operationId,
      journal.workspaceId,
    );
    const presence = await this.options.rootStore.readPresence(paths);
    if (persistedJournal === undefined) {
      if (presence.finalExists) {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_RECOVERY_REQUIRED',
          'recovery',
        );
      }
      try {
        await this.options.rootStore.discardCandidate(paths);
        if (previousRuntimeStopped) {
          await this.restartPrevious(previousActiveWorkspaceId);
        }
        return;
      } catch {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_RECOVERY_REQUIRED',
          'cleanup',
        );
      }
    }
    journal = persistedJournal;
    const publicationMayHaveStarted =
      presence.finalExists ||
      journal.state === 'rootPublished' ||
      journal.state === 'registryPublished';
    if (publicationMayHaveStarted) {
      if (previousRuntimeStopped) {
        await this.restartPrevious(journal.previousActiveWorkspaceId).catch(
          () => {
            throw new EmptyWorkspaceCreationError(
              'WORKSPACE_CREATION_RECOVERY_REQUIRED',
              'activeRuntimeRestart',
            );
          },
        );
      }
      return;
    }
    try {
      await this.options.rootStore.discardCandidate(paths);
      if (previousRuntimeStopped) {
        await this.restartPrevious(journal.previousActiveWorkspaceId);
      }
      await this.options.creationJournal.discardBeforePublication(
        journal.operationId,
      );
    } catch {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'cleanup',
      );
    }
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

  private async advanceJournal(
    current: Readonly<WorkspaceCreationJournalV1>,
    state: WorkspaceCreationJournalState,
    lineageIdentity: Readonly<WorkspaceLineageIdentityV1> | null =
      current.lineageIdentity,
  ): Promise<Readonly<WorkspaceCreationJournalV1>> {
    const next = Object.freeze({ ...current, state, lineageIdentity });
    await this.writeJournal(next);
    return next;
  }

  private async writeJournal(
    journal: Readonly<WorkspaceCreationJournalV1>,
  ): Promise<void> {
    try {
      await this.options.creationJournal.write(journal);
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_JOURNAL_FAILED',
        'journal',
      );
    }
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

  private runLifecycle<T>(
    stage: 'activeRuntimeQuiesce' | 'activeRuntimeStop',
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation().catch((error) => {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_LIFECYCLE_FAILED',
        stage,
      );
    });
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

function validateCreationTime(now: () => Date): string {
  try {
    return validateWorkspaceTimestamp(now().toISOString());
  } catch {
    throw new EmptyWorkspaceCreationError(
      'WORKSPACE_CREATION_INVALID',
      'identityGeneration',
    );
  }
}
