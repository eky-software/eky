import { generateWorkspaceId } from '../registry/workspaceIdGeneration.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId, WorkspaceLineageIdentityV1 } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
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
  WorkspaceCreationJournal,
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
  readonly workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
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
    let journal: Readonly<WorkspaceCreationJournal> | undefined;
    let previousActiveWorkspaceId: WorkspaceId | null = null;
    let writesQuiesced = false;
    let previousRuntimeEnsureAttempted = false;
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
      writesQuiesced = true;
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

      await this.assertRuntimeAbsent();
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
        formatVersion: 2,
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
      await this.assertRuntimeAbsent();
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

      previousRuntimeEnsureAttempted = true;
      await this.ensurePreviousWorkspaceRunning(previousActiveWorkspaceId);
      await this.options.creationJournal.remove(operationId);
      return Object.freeze({ workspaceId, workspaceLabel });
    } catch (error) {
      let recoveryFailure: unknown;
      let recoveryFailed = false;
      try {
        await this.handleFailure(journal);
      } catch (caught) {
        recoveryFailed = true;
        recoveryFailure = caught;
      }
      if (writesQuiesced && !previousRuntimeEnsureAttempted) {
        if (journal !== undefined) await this.assertRuntimeAbsent();
        previousRuntimeEnsureAttempted = true;
        await this.ensurePreviousWorkspaceRunning(previousActiveWorkspaceId);
      }
      if (recoveryFailed) {
        throw mapEmptyWorkspaceCreationError(
          recoveryFailure,
          'WORKSPACE_CREATION_RECOVERY_REQUIRED',
          'recovery',
        );
      }
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
    journal: Readonly<WorkspaceCreationJournal> | undefined,
  ): Promise<void> {
    if (journal === undefined) return;
    await this.assertRuntimeAbsent();

    let persistedJournal: Readonly<WorkspaceCreationJournal> | undefined;
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
      return;
    }
    try {
      await this.options.rootStore.discardCandidate(paths);
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

  private async assertRuntimeAbsent(): Promise<void> {
    try {
      await this.options.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime();
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(error, 'WORKSPACE_CREATION_RECOVERY_REQUIRED', 'recovery');
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
    current: Readonly<WorkspaceCreationJournal>,
    state: WorkspaceCreationJournalState,
    lineageIdentity: Readonly<WorkspaceLineageIdentityV1> | null =
      current.lineageIdentity,
  ): Promise<Readonly<WorkspaceCreationJournal>> {
    const next = Object.freeze({ ...current, state, lineageIdentity });
    await this.writeJournal(next);
    return next;
  }

  private async writeJournal(
    journal: Readonly<WorkspaceCreationJournal>,
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

  private ensurePreviousWorkspaceRunning(
    previousActiveWorkspaceId: WorkspaceId | null,
  ) {
    return this.options.activeWorkspaceLifecycle
      .ensurePreviousWorkspaceRunning(previousActiveWorkspaceId)
      .catch(() => {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_RECOVERY_REQUIRED',
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
