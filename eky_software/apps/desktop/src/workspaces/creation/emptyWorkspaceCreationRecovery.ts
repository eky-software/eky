import type {
  LocalWorkspaceRegistryEntryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import {
  assertColdWorkspaceRecoveryContinuation,
  assertColdWorkspaceRecoveryRegistryUnchanged,
} from '../runtime/assertColdWorkspaceRecoveryContinuation.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import {
  EmptyWorkspaceCreationError,
  mapEmptyWorkspaceCreationError,
} from './emptyWorkspaceCreationError.js';
import type {
  PublishedWorkspaceValidationPort,
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
  WorkspaceCreationJournal,
} from './workspaceCreationTypes.js';

interface SharedEmptyWorkspaceCreationRecoveryOptions {
  readonly creationJournal: WorkspaceCreationJournalStore;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly publishedWorkspaceValidation: PublishedWorkspaceValidationPort;
  readonly registry: WorkspaceRegistryPort;
  readonly rootStore: WorkspaceCreationRootStore;
  readonly userDataRoot: string;
  readonly workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
}

export type EmptyWorkspaceCreationRecoveryOptions =
  SharedEmptyWorkspaceCreationRecoveryOptions & (
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
      if (this.options.completionMode === 'beforeRuntimeStart') {
        await this.assertRuntimeAbsent();
        await this.options.assertRecoveryAdmission();
      }
      const journal = await this.readJournal();
      if (journal === undefined) return 'nothingToRecover';
      if (this.options.completionMode === 'beforeRuntimeStart' && journal.formatVersion !== 2) {
        throw new WorkspaceManagementRecoveryRequiredError();
      }
      const paths = deriveWorkspaceCreationPaths(
        this.options.userDataRoot,
        journal.operationId,
        journal.workspaceId,
      );
      const registrySnapshot = await this.readRegistry();
      const registryValue = readCreationRegistry(registrySnapshot);
      const registry = this.options.completionMode === 'beforeRuntimeStart'
        ? validateWorkspaceRegistry(registryValue)
        : registryValue;
      const entry = findWorkspaceEntry(registry, journal.workspaceId);
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
      await this.options.creationJournal.discardBeforePublication(
        journal.operationId,
      );
      return 'discardedBeforePublication';
    } catch (error) {
      if (this.options.completionMode === 'beforeRuntimeStart' &&
          error instanceof WorkspaceManagementRecoveryRequiredError) {
        throw error;
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

  private async completeFromPublishedRoot(
    journal: Readonly<WorkspaceCreationJournal>,
    registry: ReturnType<typeof readCreationRegistry>,
    paths: ReturnType<typeof deriveWorkspaceCreationPaths>,
    registrySnapshot: ReturnType<typeof readCreationRegistry> | undefined,
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
    await this.assertRuntimeAbsent();
    await this.options.rootStore.cleanupPublishedOperation(paths);

    let current = journal;
    if (current.state === 'candidateValidated') {
      current = await this.advance(current, 'rootPublished');
    }
    const expectedRegistry = publishWorkspaceEntry(
      registry,
      createReadyWorkspaceEntry({
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
    await this.options.creationJournal.remove(current.operationId);
  }

  private async completeFromPublishedRegistry(
    journal: Readonly<WorkspaceCreationJournal>,
    registry: ReturnType<typeof readCreationRegistry>,
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
    journal: Readonly<WorkspaceCreationJournal>,
    paths: ReturnType<typeof deriveWorkspaceCreationPaths>,
  ): Promise<void> {
    if (journal.lineageIdentity === null) return recoveryRequired();
    await this.assertRuntimeAbsent();
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
    journal: Readonly<WorkspaceCreationJournal>,
    state: 'rootPublished' | 'registryPublished',
  ): Promise<Readonly<WorkspaceCreationJournal>> {
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

  private async assertRuntimeAbsent(): Promise<void> {
    try {
      await this.options.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime();
    } catch {
      return recoveryRequired();
    }
  }

  private async assertColdContinuation(
    expectedWorkspaceId: WorkspaceId | null,
    expectedRegistry: ReturnType<typeof readCreationRegistry>,
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
    journal: Readonly<WorkspaceCreationJournal>,
    expectedRegistry: ReturnType<typeof readCreationRegistry>,
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
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_RECOVERY_REQUIRED',
          'activeRuntimeRestart',
        );
      });
  }
}

function isAtOrAfter(
  journal: Readonly<WorkspaceCreationJournal>,
  state: WorkspaceCreationJournal['state'],
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
