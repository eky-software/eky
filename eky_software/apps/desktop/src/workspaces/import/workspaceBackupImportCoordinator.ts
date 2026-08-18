import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import { generateWorkspaceId } from '../registry/workspaceIdGeneration.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceBackupImportRootStore } from './workspaceBackupImportRootStore.js';
import {
  WorkspaceBackupImportError,
  mapWorkspaceBackupImportError,
} from './workspaceBackupImportError.js';
import { generateWorkspaceBackupImportOperationId } from './workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import type {
  WorkspaceBackupCandidatePort,
  WorkspaceBackupContainerPort,
  WorkspaceBackupSourceInput,
} from './workspaceBackupImportPorts.js';
import {
  validateWorkspaceBackupCandidateReadiness,
  validateWorkspaceBackupMigrationResult,
} from './workspaceBackupImportReadiness.js';
import {
  assertImportLineageAvailable,
  assertImportRegistryStillAtPreviousActive,
  assertImportWorkspaceIdAvailable,
  createImportedWorkspaceEntry,
  publishImportedWorkspaceEntry,
  readWorkspaceBackupImportRegistry,
} from './workspaceBackupImportRegistry.js';
import type {
  WorkspaceBackupImportJournalState,
  WorkspaceBackupImportJournalStore,
  WorkspaceBackupImportJournalV1,
  WorkspaceBackupImportOperationId,
} from './workspaceBackupImportTypes.js';

export interface WorkspaceBackupImportCoordinatorOptions {
  readonly activeWorkspaceLifecycle: ActiveWorkspaceLifecyclePort;
  readonly backupCandidate: WorkspaceBackupCandidatePort;
  readonly backupContainer: WorkspaceBackupContainerPort;
  readonly generateOperationId?: () => WorkspaceBackupImportOperationId;
  readonly generateWorkspaceId?: () => WorkspaceId;
  readonly importJournal: WorkspaceBackupImportJournalStore;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly now?: () => Date;
  readonly registry: WorkspaceRegistryPort;
  readonly rootStore: WorkspaceBackupImportRootStore;
  readonly userDataRoot: string;
  readonly workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
}

export interface WorkspaceBackupImportInput
  extends WorkspaceBackupSourceInput {
  readonly workspaceLabel: unknown;
}

export interface WorkspaceBackupImportResult {
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
}

export class WorkspaceBackupImportCoordinator {
  private readonly generateOperationId: () => WorkspaceBackupImportOperationId;
  private readonly generateWorkspace: () => WorkspaceId;
  private readonly now: () => Date;

  constructor(
    private readonly options: Readonly<WorkspaceBackupImportCoordinatorOptions>,
  ) {
    this.generateOperationId =
      options.generateOperationId ?? generateWorkspaceBackupImportOperationId;
    this.generateWorkspace = options.generateWorkspaceId ?? generateWorkspaceId;
    this.now = options.now ?? (() => new Date());
  }

  async import(
    input: Readonly<WorkspaceBackupImportInput>,
  ): Promise<Readonly<WorkspaceBackupImportResult>> {
    const workspaceLabel = validateImportLabel(input.workspaceLabel);
    const preflight = await this.inspectBackup(input);
    const sourceLineage = createLineage(preflight.profileId);
    const initialRegistry = readWorkspaceBackupImportRegistry(
      await this.readRegistry('registryRead'),
    );
    assertImportLineageAvailable(initialRegistry, sourceLineage);

    const lease = await this.acquireLease();
    let journal: Readonly<WorkspaceBackupImportJournalV1> | undefined;
    let previousActiveWorkspaceId: WorkspaceId | null = null;
    let writesQuiesced = false;
    let previousRuntimeEnsureAttempted = false;
    try {
      if ((await this.readJournal()) !== undefined) {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'journal',
        );
      }

      const registry = readWorkspaceBackupImportRegistry(
        await this.readRegistry('registryRead'),
      );
      assertImportLineageAvailable(registry, sourceLineage);
      previousActiveWorkspaceId = registry.activeWorkspaceId;

      await this.runLifecycle('activeRuntimeQuiesce', () =>
        this.options.activeWorkspaceLifecycle.quiesceWrites(
          previousActiveWorkspaceId,
        ),
      );
      writesQuiesced = true;
      const stopped = await this.runLifecycle('activeRuntimeStop', () =>
        this.options.activeWorkspaceLifecycle.stopAndProveHandlesClosed(
          previousActiveWorkspaceId,
        ),
      );
      if (stopped.handlesClosed !== true) {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_LIFECYCLE_FAILED',
          'activeRuntimeStop',
        );
      }
      await this.assertRuntimeAbsent();

      const operationId = this.createOperationId();
      const workspaceId = this.createWorkspaceId();
      assertImportWorkspaceIdAvailable(registry, workspaceId);
      const paths = deriveWorkspaceBackupImportPaths(
        this.options.userDataRoot,
        operationId,
        workspaceId,
      );
      const createdAt = validateImportTime(this.now);
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

      await this.runRootOperation('candidateRoot', () =>
        this.options.rootStore.createCandidate(paths),
      );
      journal = await this.advanceJournal(journal, 'candidateRootCreated');

      await this.stageBackup({
        containerPath: input.containerPath,
        password: input.password,
        expectedContainerSha256: preflight.containerSha256,
        expectedMigrationChainIdentity: preflight.migrationChainIdentity,
        expectedProfileId: preflight.profileId,
        importStagingRoot: paths.importStagingRoot,
      });
      journal = await this.advanceJournal(journal, 'backupStaged');

      const migrationResult = await this.migrateCandidate({
        operationId,
        workspaceId,
        candidateRoot: paths.candidateRoot,
        importStagingRoot: paths.importStagingRoot,
        databaseFilePath: paths.databaseFilePath,
        artifactRoot: paths.artifactRoot,
        expectedProfileId: preflight.profileId,
        expectedSourceMigrationChainIdentity: preflight.migrationChainIdentity,
      });
      validateWorkspaceBackupMigrationResult(migrationResult);
      if (migrationResult.profileId !== preflight.profileId) {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_VALIDATION_FAILED',
          'candidateMigration',
        );
      }
      journal = await this.advanceJournal(journal, 'candidateMigrated');

      const readiness = await this.validateCandidate({
        operationId,
        workspaceId,
        candidateRoot: paths.candidateRoot,
        importStagingRoot: paths.importStagingRoot,
        databaseFilePath: paths.databaseFilePath,
        artifactRoot: paths.artifactRoot,
        expectedProfileId: preflight.profileId,
      });
      if (
        readiness.lineageIdentity.profileId !== preflight.profileId ||
        readiness.migrationChainIdentity !==
          migrationResult.migrationChainIdentity
      ) {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_VALIDATION_FAILED',
          'candidateValidation',
        );
      }
      journal = await this.advanceJournal(
        journal,
        'candidateValidated',
        readiness.lineageIdentity,
      );

      await this.runRootOperation('cleanup', () =>
        this.options.rootStore.removeImportStaging(paths),
      );
      await this.runRootOperation('candidateValidation', () =>
        this.options.rootStore.inspectCandidate(paths),
      );

      const publicationRegistry = readWorkspaceBackupImportRegistry(
        await this.readRegistry('registryRead'),
      );
      assertImportRegistryStillAtPreviousActive(
        publicationRegistry,
        previousActiveWorkspaceId,
      );
      assertImportWorkspaceIdAvailable(publicationRegistry, workspaceId);
      assertImportLineageAvailable(
        publicationRegistry,
        readiness.lineageIdentity,
      );

      await this.runRootOperation('rootPublish', () =>
        this.options.rootStore.publishCandidate(paths),
      );
      journal = await this.advanceJournal(
        journal,
        'rootPublished',
        readiness.lineageIdentity,
      );
      await this.runRootOperation('cleanup', () =>
        this.options.rootStore.cleanupPublishedOperation(paths),
      );

      const entry = createImportedWorkspaceEntry({
        workspaceId,
        workspaceLabel,
        lineageIdentity: readiness.lineageIdentity,
        createdAt,
      });
      await this.writeRegistry(
        publishImportedWorkspaceEntry(publicationRegistry, entry),
      );
      journal = await this.advanceJournal(
        journal,
        'registryPublished',
        readiness.lineageIdentity,
      );

      previousRuntimeEnsureAttempted = true;
      await this.ensurePreviousWorkspaceRunning(previousActiveWorkspaceId);
      await this.removeJournal(operationId);
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
        previousRuntimeEnsureAttempted = true;
        try {
          await this.ensurePreviousWorkspaceRunning(previousActiveWorkspaceId);
        } catch (caught) {
          recoveryFailed = true;
          recoveryFailure = caught;
        }
      }
      if (recoveryFailed) {
        throw mapWorkspaceBackupImportError(
          recoveryFailure,
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'recovery',
        );
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

  private async handleFailure(
    journal: Readonly<WorkspaceBackupImportJournalV1> | undefined,
  ): Promise<void> {
    if (journal === undefined) return;

    let persistedJournal: Readonly<WorkspaceBackupImportJournalV1> | undefined;
    try {
      persistedJournal = await this.options.importJournal.read();
    } catch {
      throw new WorkspaceBackupImportError(
        'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
        'recovery',
      );
    }
    if (
      persistedJournal !== undefined &&
      persistedJournal.operationId !== journal.operationId
    ) {
      throw new WorkspaceBackupImportError(
        'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
        'recovery',
      );
    }

    const paths = deriveWorkspaceBackupImportPaths(
      this.options.userDataRoot,
      journal.operationId,
      journal.workspaceId,
    );
    const presence = await this.options.rootStore.readPresence(paths);
    if (persistedJournal === undefined) {
      if (presence.finalExists) {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'recovery',
        );
      }
      await this.options.rootStore.discardCandidate(paths);
      return;
    }

    const publicationMayHaveStarted =
      presence.finalExists ||
      persistedJournal.state === 'rootPublished' ||
      persistedJournal.state === 'registryPublished';
    if (publicationMayHaveStarted) return;

    await this.options.rootStore.discardCandidate(paths);
    await this.options.importJournal.discardBeforePublication(
      persistedJournal.operationId,
    );
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

  private inspectBackup(input: Readonly<WorkspaceBackupSourceInput>) {
    return this.options.backupContainer.inspect(input).catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_BACKUP_FAILED',
        'backupPreflight',
      );
    });
  }

  private stageBackup(
    input: Parameters<WorkspaceBackupContainerPort['stage']>[0],
  ) {
    return this.options.backupContainer.stage(input).catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_BACKUP_FAILED',
        'backupStage',
      );
    });
  }

  private migrateCandidate(
    input: Parameters<WorkspaceBackupCandidatePort['migrate']>[0],
  ) {
    return this.options.backupCandidate.migrate(input).catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_MIGRATION_FAILED',
        'candidateMigration',
      );
    });
  }

  private async validateCandidate(
    input: Parameters<WorkspaceBackupCandidatePort['validateAndMaterialize']>[0],
  ) {
    try {
      return validateWorkspaceBackupCandidateReadiness(
        await this.options.backupCandidate.validateAndMaterialize(input),
      );
    } catch (error) {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_VALIDATION_FAILED',
        'candidateValidation',
      );
    }
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

  private readRegistry(stage: 'registryRead' | 'registryPublish') {
    return this.options.registry.read().catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_REGISTRY_FAILED',
        stage,
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

  private async advanceJournal(
    current: Readonly<WorkspaceBackupImportJournalV1>,
    state: WorkspaceBackupImportJournalState,
    lineageIdentity: Readonly<WorkspaceLineageIdentityV1> | null =
      current.lineageIdentity,
  ): Promise<Readonly<WorkspaceBackupImportJournalV1>> {
    const next = Object.freeze({ ...current, state, lineageIdentity });
    await this.writeJournal(next);
    return next;
  }

  private async writeJournal(
    journal: Readonly<WorkspaceBackupImportJournalV1>,
  ): Promise<void> {
    try {
      await this.options.importJournal.write(journal);
    } catch (error) {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_JOURNAL_FAILED',
        'journal',
      );
    }
  }

  private async removeJournal(
    operationId: WorkspaceBackupImportOperationId,
  ): Promise<void> {
    try {
      await this.options.importJournal.remove(operationId);
    } catch (error) {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_JOURNAL_FAILED',
        'journal',
      );
    }
  }

  private runRootOperation<T>(
    stage:
      | 'candidateRoot'
      | 'candidateValidation'
      | 'cleanup'
      | 'rootPublish',
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation().catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_STORAGE_FAILED',
        stage,
      );
    });
  }

  private runLifecycle<T>(
    stage: 'activeRuntimeQuiesce' | 'activeRuntimeStop',
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation().catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_LIFECYCLE_FAILED',
        stage,
      );
    });
  }

  private async assertRuntimeAbsent(): Promise<void> {
    try {
      await this.options.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime();
    } catch (error) {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_LIFECYCLE_FAILED',
        'runtimeAbsence',
      );
    }
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

  private createOperationId(): WorkspaceBackupImportOperationId {
    try {
      return this.generateOperationId();
    } catch {
      throw new WorkspaceBackupImportError(
        'WORKSPACE_IMPORT_INVALID',
        'identityGeneration',
      );
    }
  }

  private createWorkspaceId(): WorkspaceId {
    try {
      return this.generateWorkspace();
    } catch {
      throw new WorkspaceBackupImportError(
        'WORKSPACE_IMPORT_INVALID',
        'identityGeneration',
      );
    }
  }
}

function validateImportLabel(value: unknown): string {
  try {
    return validateWorkspaceLabel(value);
  } catch {
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_INVALID',
      'inputValidation',
    );
  }
}

function validateImportTime(now: () => Date): string {
  try {
    return validateWorkspaceTimestamp(now().toISOString());
  } catch {
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_INVALID',
      'identityGeneration',
    );
  }
}

function createLineage(profileId: string): Readonly<WorkspaceLineageIdentityV1> {
  return Object.freeze({ formatVersion: 1, profileId });
}
