import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import { generateWorkspaceId } from '../registry/workspaceIdGeneration.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import type {
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import type { WorkspaceMaintenanceLease, WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceBackupImportOwner, WorkspaceBackupImportBindingPort } from './workspaceBackupImportOwner.js';
import type { WorkspaceBackupImportJournalStore as SelectedImportJournalStore } from './workspaceBackupImportJournalStore.js';
import type { WorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { assertSynchronousProfileRestoreMutationAuthority } from '../../profileBackup/restore/profileRestoreMutationAuthority.js';
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
import type { WorkspaceBackupPlaintextQuarantineRecoveryPort } from './workspaceBackupPlaintextQuarantine.js';
import {
  validateWorkspaceBackupCandidateReadiness,
  validateWorkspaceBackupMigrationResult,
} from './workspaceBackupImportReadiness.js';
import {
  assertImportLineageAvailable,
  assertImportWorkspaceLabelAvailable,
  assertImportRegistryStillAtPreviousActive,
  assertImportWorkspaceIdAvailable,
  createImportedWorkspaceEntry,
  readWorkspaceBackupImportRegistry,
} from './workspaceBackupImportRegistry.js';
import type {
  WorkspaceBackupImportJournalState,
  WorkspaceBackupImportJournal,
  WorkspaceBackupImportOperationId,
} from './workspaceBackupImportTypes.js';

export interface WorkspaceBackupImportCoordinatorOptions {
  readonly activeWorkspaceLifecycle: ActiveWorkspaceLifecyclePort;
  readonly backupCandidate: WorkspaceBackupCandidatePort;
  readonly backupContainer: WorkspaceBackupContainerPort;
  readonly generateOperationId?: () => WorkspaceBackupImportOperationId;
  readonly generateWorkspaceId?: () => WorkspaceId;
  readonly captureImportOwner: (lease: WorkspaceMaintenanceLeaseHandle) => WorkspaceBackupImportOwner;
  readonly importJournal: Pick<SelectedImportJournalStore, 'inspectSlots' | 'writeSelected' | 'removeSelected' | 'discardBeforePublicationSelected'>;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly now?: () => Date;
  readonly plaintextQuarantine: WorkspaceBackupPlaintextQuarantineRecoveryPort;
  readonly registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
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
  private readonly captureImportOwner: WorkspaceBackupImportCoordinatorOptions['captureImportOwner'];

  constructor(
    private readonly options: Readonly<WorkspaceBackupImportCoordinatorOptions>,
  ) {
    this.generateOperationId =
      options.generateOperationId ?? generateWorkspaceBackupImportOperationId;
    this.generateWorkspace = options.generateWorkspaceId ?? generateWorkspaceId;
    this.now = options.now ?? (() => new Date());
    this.captureImportOwner = options.captureImportOwner.bind(options);
  }

  async import(
    input: Readonly<WorkspaceBackupImportInput>,
  ): Promise<Readonly<WorkspaceBackupImportResult>> {
    const workspaceLabel = validateImportLabel(input.workspaceLabel);
    const lease = await this.acquireLease();
    let journal: Readonly<WorkspaceBackupImportJournal> | undefined;
    let previousActiveWorkspaceId: WorkspaceId | null = null;
    let writesQuiesced = false;
    let previousRuntimeEnsureAttempted = false;
    let operationFailure: WorkspaceBackupImportError | undefined;
    let owner: Readonly<WorkspaceBackupImportOwner> | undefined;
    let binding: WorkspaceBackupImportBindingPort | undefined;
    let paths: Readonly<WorkspaceBackupImportPaths> | undefined;
    let originalRegistry: ReadOnlyJournalSlots<LocalWorkspaceRegistry> | undefined;
    let selected: Readonly<{ bytes: Uint8Array; identity: Readonly<CrashSafeFileSlotIdentity> }> | undefined;
    let terminal = false;
    let uncertain = false;
    let firstGuardFailure: { error: unknown } | undefined;
    const markUncertain = (): void => {
      if (uncertain) return;
      uncertain = true;
      if (owner !== undefined) assertSynchronousProfileRestoreMutationAuthority(owner.onUncertain);
    };
    const rejectGuard = (error: unknown): never => {
      firstGuardFailure ??= { error };
      try { markUncertain(); }
      catch (secondary) { throw new AggregateError([firstGuardFailure.error, secondary], 'WORKSPACE_IMPORT_RECOVERY_REQUIRED'); }
      throw firstGuardFailure.error;
    };
    const assertCurrent = (): void => {
      if (uncertain) throw firstGuardFailure?.error ?? new WorkspaceBackupImportError('WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'recovery');
      try {
        if (owner === undefined) throw new Error('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
        assertSynchronousProfileRestoreMutationAuthority(owner.assertCurrent);
      } catch (error) { rejectGuard(error); }
    };
    const assertStopped = async (): Promise<void> => {
      try {
        assertCurrent();
        await this.assertRuntimeAbsent(); assertCurrent();
        assertSynchronousProfileRestoreMutationAuthority(owner!.assertMainCurrent);
        await owner!.assertMainOwned(); assertCurrent();
        assertSynchronousProfileRestoreMutationAuthority(owner!.assertMainCurrent);
      } catch (error) { rejectGuard(error); }
    };
    const assertOriginalRegistry = async (): Promise<void> => {
      try {
        await assertStopped();
        const current = await this.options.registry.inspectSlots(assertCurrent); assertCurrent();
        if (originalRegistry?.current === undefined || !sameSelected(current, originalRegistry.current)) throw new Error('WORKSPACE_IMPORT_REGISTRY_CHANGED');
      } catch (error) { rejectGuard(error); }
    };
    const assertJournalSelection = async (): Promise<void> => {
      try {
        assertCurrent();
        const current = await this.options.importJournal.inspectSlots(assertCurrent); assertCurrent();
        if (selected === undefined || !sameSelected(current, selected)) throw new Error('WORKSPACE_IMPORT_JOURNAL_CHANGED');
      } catch (error) { rejectGuard(error); }
    };
    const assertBound = async (): Promise<void> => {
      try {
        await assertStopped();
        if (binding === undefined) throw new Error('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
        await binding.assertPublished(); await assertJournalSelection(); await binding.assertPublished(); assertCurrent();
      } catch (error) { rejectGuard(error); }
    };
    const mutationAuthority = { assertCurrent: assertBound, assertMutationCurrent: () => {
      assertCurrent(); binding!.assertMutationCurrent();
    } };
    const assertPayloadsAbsent = async (): Promise<void> => {
      await assertStopped();
      if (paths === undefined) throw new Error('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
      await this.options.rootStore.assertOperationAbsent(paths, assertCurrent);
      await assertStopped();
    };
    const writeSelectedJournal = async (next: Readonly<WorkspaceBackupImportJournal>): Promise<void> => {
      const external = async () => {
        try {
          if (binding === undefined) await assertOriginalRegistry();
          else { await binding.assertPublished(); assertCurrent(); }
        } catch (error) { rejectGuard(error); }
      };
      try {
        const bytes = serializeWorkspaceBackupImportJournal(next);
        const identity = await this.options.importJournal.writeSelected(next, journalSelection(selected, assertCurrent, external));
        const current = await this.options.importJournal.inspectSlots(assertCurrent); assertCurrent();
        if (!sameSelected(current, { bytes, identity })) throw new Error('WORKSPACE_IMPORT_JOURNAL_RECEIPT_CHANGED');
        await external();
        selected = Object.freeze({ bytes: Uint8Array.from(bytes), identity: Object.freeze({ ...identity }) });
        journal = next;
      } catch (error) { rejectGuard(mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_JOURNAL_FAILED', 'journal')); }
    };
    const advance = async (current: Readonly<WorkspaceBackupImportJournal>, state: WorkspaceBackupImportJournalState,
      lineageIdentity: Readonly<WorkspaceLineageIdentityV1> | null = current.lineageIdentity) => {
      const next = Object.freeze({ ...current, state, lineageIdentity });
      await writeSelectedJournal(next); return next;
    };
    const retire = async (completed: boolean): Promise<void> => {
      try {
        await binding!.clearAfterPayloadsAbsent(assertPayloadsAbsent, assertJournalSelection);
        const external = () => binding!.assertRetired(assertPayloadsAbsent);
        const selection = journalSelection(selected, assertCurrent, external);
        try {
          if (completed) await this.options.importJournal.removeSelected(journal!.operationId, selection);
          else await this.options.importJournal.discardBeforePublicationSelected(journal!.operationId, selection);
        } catch (error) { rejectGuard(mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_JOURNAL_FAILED', 'journal')); }
        const current = await this.options.importJournal.inspectSlots(assertCurrent); assertCurrent();
        if (Object.values(current).some(value => value !== undefined)) throw new Error('WORKSPACE_IMPORT_JOURNAL_REMAINS');
        await external(); terminal = true;
      } catch (error) { rejectGuard(error); }
    };
    try {
      owner = captureOwner(this.captureImportOwner(lease));
      assertCurrent();
      const initial = await this.options.importJournal.inspectSlots(assertCurrent).catch(error => {
        throw mapWorkspaceBackupImportError(firstGuardFailure?.error ?? error, 'WORKSPACE_IMPORT_JOURNAL_FAILED', 'journal');
      }); assertCurrent();
      if (Object.values(initial).some(value => value !== undefined)) {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'journal',
        );
      }
      await this.recoverPlaintextQuarantine();
      assertCurrent();

      const preflight = await this.inspectBackup(input);
      assertCurrent();
      const sourceLineage = createLineage(preflight.profileId);

      originalRegistry = await this.options.registry.inspectSlots(assertCurrent).catch(error => {
        throw mapWorkspaceBackupImportError(firstGuardFailure?.error ?? error, 'WORKSPACE_IMPORT_REGISTRY_FAILED', 'registryRead');
      }); assertCurrent();
      if (originalRegistry.current?.identity === undefined || originalRegistry.next !== undefined || originalRegistry.backup !== undefined) {
        throw new WorkspaceBackupImportError('WORKSPACE_IMPORT_REGISTRY_FAILED', 'registryRead');
      }
      originalRegistry = Object.freeze({ current: Object.freeze({ ...originalRegistry.current,
        bytes: Uint8Array.from(originalRegistry.current.bytes), identity: Object.freeze({ ...originalRegistry.current.identity }) }),
        next: undefined, backup: undefined });
      const registry = readWorkspaceBackupImportRegistry(originalRegistry.current!.value);
      assertImportLineageAvailable(registry, sourceLineage);
      assertImportWorkspaceLabelAvailable(registry, workspaceLabel, 'registryRead');
      previousActiveWorkspaceId = registry.activeWorkspaceId;

      await this.runLifecycle('activeRuntimeQuiesce', () =>
        this.options.activeWorkspaceLifecycle.quiesceWrites(
          previousActiveWorkspaceId,
        ),
      );
      writesQuiesced = true;
      assertCurrent();
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
      await assertStopped();

      const operationId = this.createOperationId();
      const workspaceId = this.createWorkspaceId();
      assertImportWorkspaceIdAvailable(registry, workspaceId);
      paths = deriveWorkspaceBackupImportPaths(
        this.options.userDataRoot,
        operationId,
        workspaceId,
      );
      const createdAt = validateImportTime(this.now);
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
      await writeSelectedJournal(journal);
      try {
        binding = owner.createBinding({ operationId, workspaceId, lineageIdentity: sourceLineage,
          registrySelection: originalRegistry, assertJournalSelection, onUncertain: markUncertain });
        await binding.publish(); await assertBound();
      } catch (error) { rejectGuard(error); }

      await this.runRootOperation('candidateRoot', () =>
        this.options.rootStore.createCandidate(paths!, mutationAuthority),
      );
      journal = await advance(journal, 'candidateRootCreated');

      await assertBound();
      await this.stageBackup({
        containerPath: input.containerPath,
        password: input.password,
        expectedContainerSha256: preflight.containerSha256,
        expectedMigrationChainIdentity: preflight.migrationChainIdentity,
        expectedProfileId: preflight.profileId,
        importStagingRoot: paths.importStagingRoot,
      });
      await assertBound();
      journal = await advance(journal, 'backupStaged');

      await assertBound();
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
      await assertBound();
      if (migrationResult.profileId !== preflight.profileId) {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_VALIDATION_FAILED',
          'candidateMigration',
        );
      }
      journal = await advance(journal, 'candidateMigrated');

      await assertBound();
      const readiness = await this.validateCandidate({
        operationId,
        workspaceId,
        candidateRoot: paths.candidateRoot,
        importStagingRoot: paths.importStagingRoot,
        databaseFilePath: paths.databaseFilePath,
        artifactRoot: paths.artifactRoot,
        expectedProfileId: preflight.profileId,
      });
      await assertBound();
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
      journal = await advance(
        journal,
        'candidateValidated',
        readiness.lineageIdentity,
      );

      await this.runRootOperation('cleanup', () =>
        this.options.rootStore.removeImportStaging(paths!, mutationAuthority),
      );
      await this.runRootOperation('candidateValidation', () =>
        this.options.rootStore.inspectCandidate(paths!),
      );

      await assertBound();
      const publicationRegistry = registry;
      assertImportRegistryStillAtPreviousActive(
        publicationRegistry,
        previousActiveWorkspaceId,
      );
      assertImportWorkspaceIdAvailable(publicationRegistry, workspaceId);
      assertImportLineageAvailable(
        publicationRegistry,
        readiness.lineageIdentity,
      );
      assertImportWorkspaceLabelAvailable(publicationRegistry, workspaceLabel, 'registryPublish');

      await this.runRootOperation('rootPublish', () =>
        this.options.rootStore.publishCandidate(paths!, mutationAuthority),
      );
      journal = await advance(
        journal,
        'rootPublished',
        readiness.lineageIdentity,
      );
      await this.runRootOperation('cleanup', () =>
        this.options.rootStore.cleanupPublishedOperation(paths!, mutationAuthority),
      );

      const entry = createImportedWorkspaceEntry({
        workspaceId,
        workspaceLabel,
        lineageIdentity: readiness.lineageIdentity,
        createdAt,
      });
      try { await binding!.publishRegistry(entry, assertJournalSelection); }
      catch (error) { rejectGuard(mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_REGISTRY_FAILED', 'registryPublish')); }
      journal = await advance(
        journal,
        'registryPublished',
        readiness.lineageIdentity,
      );

      previousRuntimeEnsureAttempted = true;
      await assertBound();
      await this.ensurePreviousWorkspaceRunning(previousActiveWorkspaceId);
      await assertBound();
      await retire(true);
      return Object.freeze({ workspaceId, workspaceLabel });
    } catch (error) {
      const primaryFailure = mapWorkspaceBackupImportError(
        firstGuardFailure?.error ?? error,
        'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
        'recovery',
      );
      const recoveryFailures: unknown[] = [];
      if (primaryFailure.code === 'WORKSPACE_IMPORT_RECOVERY_REQUIRED' && primaryFailure.stage === 'plaintextQuarantine') {
        try { markUncertain(); } catch (secondary) { recoveryFailures.push(secondary); }
      }
      if (!uncertain && journal !== undefined) {
        try {
          await assertBound();
          const presence = await this.options.rootStore.readPresence(paths!); await assertBound();
          if (presence.finalExists || journal.state === 'rootPublished' || journal.state === 'registryPublished') {
            markUncertain();
          } else {
            await this.options.rootStore.discardCandidate(paths!, mutationAuthority);
            await retire(false);
          }
        } catch (caught) {
          recoveryFailures.push(caught);
          try { markUncertain(); } catch (secondary) { recoveryFailures.push(secondary); }
        }
      }
      if (!uncertain && writesQuiesced && !previousRuntimeEnsureAttempted) {
        previousRuntimeEnsureAttempted = true;
        try {
          assertCurrent();
          if (journal !== undefined) await binding!.assertRetired(assertPayloadsAbsent);
          await this.ensurePreviousWorkspaceRunning(previousActiveWorkspaceId);
          assertCurrent(); terminal = true;
        } catch (caught) {
          recoveryFailures.push(caught);
          try { markUncertain(); } catch (secondary) { recoveryFailures.push(secondary); }
        }
      }
      if (recoveryFailures.length > 0) {
        const recoveryFailure = mapWorkspaceBackupImportError(
          recoveryFailures.at(-1),
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'recovery',
        );
        // Preserve the outward recovery result, with the primary cause first.
        operationFailure = new WorkspaceBackupImportError(
          recoveryFailure.code,
          recoveryFailure.stage,
          {
            cause: new AggregateError(
              [primaryFailure, ...recoveryFailures],
              recoveryFailure.code,
            ),
          },
        );
      } else {
        operationFailure = primaryFailure;
      }
      throw operationFailure;
    } finally {
      let released = false;
      try {
        await lease.release();
        released = true;
        if (terminal && !uncertain && owner !== undefined) assertSynchronousProfileRestoreMutationAuthority(owner.onTerminalAfterRelease);
      } catch (error) {
        let failure = error;
        try { markUncertain(); } catch (secondary) { failure = new AggregateError([error, secondary], 'WORKSPACE_IMPORT_RECOVERY_REQUIRED'); }
        const releaseFailure = mapWorkspaceBackupImportError(
          failure,
          'WORKSPACE_IMPORT_LIFECYCLE_FAILED',
          released ? 'activeRuntimeRestart' : 'lease',
        );
        if (operationFailure === undefined) throw releaseFailure;
        throw new WorkspaceBackupImportError(
          releaseFailure.code,
          releaseFailure.stage,
          {
            cause: new AggregateError(
              [operationFailure, releaseFailure],
              releaseFailure.code,
            ),
          },
        );
      }
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

  private inspectBackup(input: Readonly<WorkspaceBackupSourceInput>) {
    return this.options.backupContainer.inspect(input).catch((error) => {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_BACKUP_FAILED',
        'backupPreflight',
      );
    });
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
      .catch((error) => {
        throw new WorkspaceBackupImportError(
          'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
          'activeRuntimeRestart',
          { cause: error },
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

function captureOwner(owner: WorkspaceBackupImportOwner): Readonly<WorkspaceBackupImportOwner> {
  if (owner === undefined || owner === null ||
      ['assertCurrent', 'assertMainCurrent', 'assertMainOwned', 'onUncertain', 'onTerminalAfterRelease', 'createBinding']
        .some(key => typeof owner[key as keyof WorkspaceBackupImportOwner] !== 'function')) {
    throw new WorkspaceBackupImportError('WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'recovery');
  }
  return Object.freeze({ assertCurrent: owner.assertCurrent.bind(owner), assertMainCurrent: owner.assertMainCurrent.bind(owner),
    assertMainOwned: owner.assertMainOwned.bind(owner), onUncertain: owner.onUncertain.bind(owner),
    onTerminalAfterRelease: owner.onTerminalAfterRelease.bind(owner), createBinding: owner.createBinding.bind(owner) });
}

function sameSelected<T>(slots: ReadOnlyJournalSlots<T>, expected: Readonly<{ bytes: Uint8Array; identity?: Readonly<CrashSafeFileSlotIdentity> }>): boolean {
  return slots.current?.identity !== undefined && expected.identity !== undefined && slots.next === undefined && slots.backup === undefined &&
    slots.current.bytes.byteLength === expected.bytes.byteLength && slots.current.bytes.every((value, index) => value === expected.bytes[index]) &&
    sameCrashSafeFileSlotIdentity(slots.current.identity, expected.identity);
}

function journalSelection(selected: Readonly<{ bytes: Uint8Array; identity: Readonly<CrashSafeFileSlotIdentity> }> | undefined,
  assertAuthority: () => void, assertExternalSelection: () => Promise<void>): CrashSafeByteSlotSelection {
  return { expectedSlots: { current: selected?.bytes, next: undefined, backup: undefined },
    expectedIdentities: { current: selected?.identity, next: undefined, backup: undefined }, assertAuthority, assertExternalSelection };
}
