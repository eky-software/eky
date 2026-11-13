import { randomUUID } from 'node:crypto';
import { assertUpdateJournalAuthority } from '../../update/updateJournalStore.js';
import {
  readWorkspaceCandidateCleanupCause,
} from '../../runtime/workspaceCandidateFailure.js';
import { classifyWorkspaceManagementFailure } from './workspaceManagementFailureClassification.js';
import {
  parseWorkspaceDeletionRequest,
  type WorkspaceDeletionRequest,
} from './workspaceManagementCapabilityProtocol.js';

import type { EmptyWorkspaceCreationResult } from '../creation/emptyWorkspaceCreationCoordinator.js';
import type {
  WorkspaceBackupImportInput,
  WorkspaceBackupImportResult,
} from '../import/workspaceBackupImportCoordinator.js';
import type {
  InMemoryWorkspaceMaintenanceLease,
  WorkspaceMaintenanceLeaseHandle,
  WorkspaceMaintenanceStateReader,
} from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type {
  WorkspaceBackupReplacementInput,
  WorkspaceBackupReplacementResult,
} from '../replacement/workspaceBackupReplacementCoordinator.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import {
  mapWorkspaceManagementError,
  WorkspaceManagementError,
} from './workspaceManagementError.js';
import type { WorkspaceManagementOperationGuard } from './workspaceManagementOperationGuard.js';
import { createWorkspaceManagementStatus, parseWorkspaceRecoveryManagementStatus } from './workspaceManagementStatus.js';
import type {
  WorkspaceManagementObserver,
  WorkspaceManagementOperationContext,
  WorkspaceManagementOperationIdentity,
  WorkspaceManagementOperationKind,
  WorkspaceManagementStatusV1,
  WorkspaceRecoveryManagementStatusV2,
  WorkspaceManagementStatusReadContext,
  WorkspaceDeletionPreparationLifetime,
  WorkspaceDeletionPreparationOutcome,
} from './workspaceManagementTypes.js';
import type { WorkspaceLabelRenameResult } from './workspaceLabelRename.js';
import type { WorkspaceRuntimeRelaunchCompletion } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { captureWorkspaceDeletionJournal, sameWorkspaceDeletionJournalBinding,
  type WorkspaceDeletionJournal } from '../deletion/workspaceDeletionJournalCodec.js';
import { workspaceDeletionFailureStages,
  type WorkspaceDeletionFailureStage } from '../../observability/workspaceManagementFailureContext.js';

export interface EmptyWorkspaceCreationCommand {
  create(
    workspaceLabel: unknown,
  ): Promise<Readonly<EmptyWorkspaceCreationResult>>;
}

export interface WorkspaceBackupImportCommand {
  import(
    input: Readonly<WorkspaceBackupImportInput>,
  ): Promise<Readonly<WorkspaceBackupImportResult>>;
}

export interface WorkspaceBackupReplacementCommand {
  replace(
    input: Readonly<WorkspaceBackupReplacementInput>,
  ): Promise<Readonly<WorkspaceBackupReplacementResult>>;
}

export interface WorkspaceSwitchCommand {
  switchTo(workspaceId: WorkspaceId): Promise<void>;
}

export interface WorkspaceLabelRenameCommand {
  rename(
    workspaceId: unknown,
    workspaceLabel: unknown,
  ): Promise<Readonly<WorkspaceLabelRenameResult>>;
}

export interface WorkspaceDeletionContinuationAuthority {
  assertCurrent(): void;
  assertOwned(): Promise<void>;
}

export interface WorkspaceDeletionContinuationOwner extends WorkspaceDeletionContinuationAuthority {
  recordRemoved(receipt: unknown): WorkspaceDeletionCompletion;
}

export interface WorkspaceDeletionWorkAuthority extends WorkspaceDeletionContinuationAuthority {
  recordRemoved(receipt: unknown): void;
}

export interface WorkspaceDeletionCompletion {
  readonly formatVersion: 1;
  readonly status: 'completed';
  readonly navigation: 'selector' | 'reopenPrevious';
}

// Main-only outcome of this exact rejected call, never a serialized event.
export interface WorkspaceDeletionFailureOutcome {
  readonly cause: unknown;
  readonly sideEffectState: 'none' | 'unknown';
}

export type WorkspaceDeletionFailureOutcomeHandler =
  (outcome: Readonly<WorkspaceDeletionFailureOutcome>) => void;

export interface WorkspaceDeletionRecoverySelection {
  readonly journal: WorkspaceDeletionJournal;
  assertSelected(): Promise<void>;
  revoke(): void;
}

export interface WorkspaceDeletionRecoveryOwner extends WorkspaceDeletionContinuationOwner {
  // Settles the owner's original reads and revokes its phase authorities.
  close(): Promise<void>;
}

export type WorkspaceDeletionExecutionStage = Exclude<WorkspaceDeletionFailureStage, 'admission' | 'deletePreparation'>;

export interface WorkspaceDeletionRecoveryOptions {
  readonly selection: WorkspaceDeletionRecoverySelection;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'acquire' | 'captureCurrentOwner'>;
  captureSelection(assertLease: () => void): Promise<WorkspaceDeletionRecoverySelection | undefined>;
  captureAuthority(journal: WorkspaceDeletionJournal, assertLease: () => void): Promise<WorkspaceDeletionRecoveryOwner>;
  resumeSelected(journal: WorkspaceDeletionJournal, authority: WorkspaceDeletionWorkAuthority,
    observeStage: (stage: WorkspaceDeletionExecutionStage) => void): Promise<WorkspaceDeletionCompletion>;
  assertCurrent(): void;
  isStopping(): boolean;
  onUncertain(cause: unknown): void;
  readonly observer?: WorkspaceManagementObserver;
  readonly now?: () => number;
}

export interface WorkspaceRecoveryManagementAdmission {
  readonly targetWorkspaceId: WorkspaceId;
  assertCurrent(): void;
  assertSelected(): Promise<void>;
  readStatus(context: Readonly<WorkspaceManagementStatusReadContext>): Promise<Readonly<{
    value: Readonly<WorkspaceRecoveryManagementStatusV2>;
    assertCurrent(): void;
  }>>;
}

interface WorkspaceManagementSharedServiceOptions {
  readonly now?: () => number;
  readonly observer?: WorkspaceManagementObserver;
  readonly deletionPreparation?: {
    readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'acquire' | 'captureCurrentOwner'>;
    prepare(
      request: Readonly<WorkspaceDeletionRequest>,
      lifetime: WorkspaceDeletionPreparationLifetime,
      assertLease: () => void,
      operationId: string,
    ): Promise<WorkspaceDeletionPreparationOutcome>;
  };
  readonly deletionContinuation?: {
    captureAuthority(operationId: string, assertLease: () => void): WorkspaceDeletionContinuationOwner;
    resume(operationId: string, authority: WorkspaceDeletionWorkAuthority,
      observeStage?: (stage: WorkspaceDeletionExecutionStage) => void): Promise<WorkspaceDeletionCompletion>;
  };
}

export interface WorkspaceManagementOrdinaryServiceOptions extends WorkspaceManagementSharedServiceOptions {
  readonly recoveryManagement?: undefined;
  readonly createEmpty: EmptyWorkspaceCreationCommand;
  readonly importBackup: WorkspaceBackupImportCommand;
  readonly maintenanceState: WorkspaceMaintenanceStateReader;
  readonly operationGuard: WorkspaceManagementOperationGuard;
  readonly registry: Pick<WorkspaceRegistryPort, 'read'>;
  readonly renameWorkspace: WorkspaceLabelRenameCommand;
  readonly replaceActive?: WorkspaceBackupReplacementCommand;
  readonly runtimeRelaunchCompletion?: WorkspaceRuntimeRelaunchCompletion;
  readonly switchWorkspace: WorkspaceSwitchCommand;
}

export interface WorkspaceManagementRecoveryServiceOptions extends WorkspaceManagementSharedServiceOptions {
  readonly recoveryManagement: Readonly<WorkspaceRecoveryManagementAdmission>;
  readonly createEmpty?: never;
  readonly importBackup?: never;
  readonly maintenanceState?: never;
  readonly operationGuard?: never;
  readonly registry?: never;
  readonly renameWorkspace?: never;
  readonly replaceActive?: never;
  readonly runtimeRelaunchCompletion?: never;
  readonly switchWorkspace?: never;
}

export type WorkspaceManagementServiceOptions =
  | WorkspaceManagementOrdinaryServiceOptions
  | WorkspaceManagementRecoveryServiceOptions;

interface DeletionPreparationCompletion {
  assertRelaunch(): void;
  release(): Promise<void>;
  readFailureStage?(): WorkspaceDeletionFailureStage;
  readonly onFailureOutcome?: WorkspaceDeletionFailureOutcomeHandler;
}

export class WorkspaceManagementService {
  private readonly recoveryManagement: Readonly<WorkspaceRecoveryManagementAdmission> | undefined;
  private recoveryManagementFailure: { readonly cause: unknown } | undefined;
  private activeOperation = false;
  private admissionClosed = false;
  private readonly pendingWork = new Set<Promise<void>>();
  private shutdownTask: Promise<void> | undefined;
  private shutdownRequested = false;
  private observationGeneration: object = {};
  private statusPublicationGeneration: object = {};
  private observedOperation: Readonly<WorkspaceManagementOperationIdentity> | null = null;
  private readonly deletionCompletionFailures: unknown[] = [];
  private readonly now: () => number;

  constructor(
    private readonly options: Readonly<WorkspaceManagementServiceOptions>,
  ) {
    this.now = options.now ?? Date.now;
    const recovery = options.recoveryManagement;
    this.recoveryManagement = recovery === undefined ? undefined : Object.freeze({
      targetWorkspaceId: validateWorkspaceId(recovery.targetWorkspaceId),
      assertCurrent: recovery.assertCurrent.bind(recovery),
      assertSelected: recovery.assertSelected.bind(recovery),
      readStatus: recovery.readStatus.bind(recovery),
    });
  }

  // Main-only cold entry, deliberately separate from ordinary unresolved admission.
  static async recoverDeletionBeforeRuntime(input: Readonly<WorkspaceDeletionRecoveryOptions>): Promise<WorkspaceDeletionCompletion> {
    const check = input.assertCurrent.bind(input), stopping = input.isStopping.bind(input);
    const uncertain = input.onUncertain.bind(input), now = input.now ?? Date.now;
    const acquire = input.maintenanceLease.acquire.bind(input.maintenanceLease);
    const captureLease = input.maintenanceLease.captureCurrentOwner.bind(input.maintenanceLease);
    const captureSelection = input.captureSelection.bind(input), captureAuthority = input.captureAuthority.bind(input);
    const resume = input.resumeSelected.bind(input), observer = input.observer;
    const assertInitial = input.selection.assertSelected.bind(input.selection);
    const releases = [input.selection.revoke.bind(input.selection)];
    const correlationId = randomUUID(), failures: unknown[] = [];
    const observedOperation = Object.freeze({ correlationId, operationKind: 'deleteResume' as const });
    let startedAt: number | undefined;
    let active = true, observing = true, primaryFailed = false, cleanupReported = false;
    let authorityFailure: { cause: unknown } | undefined;
    let stage: WorkspaceDeletionFailureStage = 'admission';
    let lease: WorkspaceMaintenanceLeaseHandle | undefined, assertLease: (() => void) | undefined;
    let owner: WorkspaceDeletionRecoveryOwner | undefined, result: WorkspaceDeletionCompletion | undefined;
    let closeOwner: (() => Promise<void>) | undefined;
    const fail = (): never => { throw new WorkspaceManagementError('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'deleteResume'); };
    const assertCurrent = () => {
      if (authorityFailure !== undefined) throw authorityFailure.cause;
      try {
        if (!active || stopping()) fail();
        assertUpdateJournalAuthority(check);
        if (assertLease !== undefined) assertUpdateJournalAuthority(assertLease);
        if (!active || stopping()) fail();
        assertUpdateJournalAuthority(check);
      } catch (cause) {
        active = false; authorityFailure ??= { cause }; throw authorityFailure.cause;
      }
    };
    const revokeSelections = () => {
      const errors: unknown[] = [];
      for (const revoke of releases.splice(0)) {
        try { revoke(); } catch (cause) { errors.push(cause); }
      }
      if (errors.length !== 0) {
        try { assertUpdateJournalAuthority(() => uncertain(errors[0])); }
        catch (cause) { errors.push(cause); }
      }
      if (errors.length !== 0) throw errors.length === 1 ? errors[0]
        : new AggregateError(errors, 'WORKSPACE_DELETION_SELECTION_CLOSE_FAILED', { cause: errors[0] });
    };
    const record = (errorCode: string, failureStage: WorkspaceDeletionFailureStage) => {
      if (startedAt === undefined) return;
      try {
        WorkspaceManagementService.recordObservation(observer, {
          correlationId, durationMs: Math.max(0, now() - startedAt), operationKind: 'deleteResume',
          errorCode, outcome: 'failed', retryable: errorCode === 'WORKSPACE_MANAGEMENT_BUSY',
          sideEffectState: 'unknown', stage: failureStage,
        });
      } catch { /* Optional timing must not replace the first failure or prevent close. */ }
    };
    WorkspaceManagementService.observeOperation(observer, 'operationStarted', observedOperation);
    try {
      try {
        startedAt = now();
        // The initial receipt remains authoritative through fresh lease-bound capture.
        const journal = captureWorkspaceDeletionJournal(input.selection.journal);
        assertCurrent(); await assertInitial(); assertCurrent();
        lease = await acquire('delete'); assertCurrent();
        assertLease = captureLease(['delete'], lease); assertCurrent();
        await assertInitial(); assertCurrent();
        const fresh = await captureSelection(assertCurrent);
        if (fresh === undefined) {
          assertCurrent();
          throw new WorkspaceManagementError('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'deleteResume');
        }
        const assertFresh = fresh.assertSelected.bind(fresh);
        releases.push(fresh.revoke.bind(fresh));
        assertCurrent();
        const selectedJournal = captureWorkspaceDeletionJournal(fresh.journal);
        if (journal.phase !== selectedJournal.phase || !sameWorkspaceDeletionJournalBinding(journal, selectedJournal)) {
          throw new WorkspaceManagementError('WORKSPACE_DELETE_JOURNAL_CONFLICT', 'deleteResume');
        }
        await assertFresh(); assertCurrent(); await assertInitial(); assertCurrent();
        owner = await captureAuthority(journal, assertCurrent);
        closeOwner = owner.close.bind(owner);
        const continuationOwner = Object.freeze({ assertCurrent: owner.assertCurrent.bind(owner),
          assertOwned: owner.assertOwned.bind(owner), recordRemoved: owner.recordRemoved.bind(owner) });
        assertCurrent(); await continuationOwner.assertOwned(); assertCurrent();
        await assertFresh(); assertCurrent(); await assertInitial(); assertCurrent();
        revokeSelections(); assertCurrent();
        stage = 'deleteAuthorization';
        result = await WorkspaceManagementService.continueDeletion(journal.target.operationId, continuationOwner,
          assertCurrent, stopping, (_operationId, authority) => resume(journal, authority, value => {
            if (observing && workspaceDeletionFailureStages.some(allowed =>
              allowed !== 'admission' && allowed !== 'deletePreparation' && allowed === value)) stage = value;
          }));
      } catch (cause) {
        active = false; observing = false; authorityFailure ??= { cause };
        primaryFailed = true; failures.push(cause);
        record(mapWorkspaceManagementError(cause, 'deleteResume').code, stage);
      } finally {
        active = false; observing = false;
        await WorkspaceManagementService.completeDeletion({ assertRelaunch: fail, async release() {
          // A failed close does not authorize releasing a possibly live owner.
          await closeOwner?.();
          await lease?.release();
        } }, revokeSelections, failures, cause => {
          try { assertUpdateJournalAuthority(() => uncertain(cause)); }
          catch (notificationFailure) { failures.push(notificationFailure); }
          if (!cleanupReported) { cleanupReported = true; record('WORKSPACE_DELETE_CLEANUP_FAILED', 'deleteCleanup'); }
        });
      }
      if (failures.length !== 0) {
        const first = primaryFailed ? failures[0]
          : new WorkspaceManagementError('WORKSPACE_DELETE_CLEANUP_FAILED', 'deleteResume', { cause: failures[0] });
        throw WorkspaceManagementService.mapOperationFailure(first, 'deleteResume', failures);
      }
      return result!;
    } finally {
      active = false; observing = false;
      WorkspaceManagementService.observeOperation(observer, 'operationSettled', observedOperation);
    }
  }

  captureStatusReadContext(): Readonly<WorkspaceManagementStatusReadContext> {
    this.assertAdmissionOpen('status');
    const generation = this.statusPublicationGeneration;
    const operationState = this.activeOperation ? 'busy' as const : 'idle' as const;
    let current = true;
    return Object.freeze({ operationState, assertCurrent: () => {
      if (!current || this.admissionClosed || generation !== this.statusPublicationGeneration) {
        current = false;
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
      }
    } });
  }

  getStatus(): Promise<Readonly<WorkspaceManagementStatusV1>> {
    return this.trackWork('status', () => {
      if (this.recoveryManagement !== undefined) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
      }
      return this.readStatus();
    });
  }

  getRecoveryManagementStatus() {
    return this.trackWork('status', async () => {
      const mode = this.recoveryManagement;
      if (mode === undefined) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'status');
      const phase = this.captureStatusReadContext();
      this.assertRecoveryManagementCurrent();
      let firstFailure: { readonly cause: unknown } | undefined;
      let guard: (() => void) | undefined;
      const assertCurrent = () => {
        if (firstFailure !== undefined) throw firstFailure.cause;
        try {
          this.assertRecoveryManagementCurrent();
          phase.assertCurrent();
          if (guard === undefined) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
          assertUpdateJournalAuthority(guard);
          this.assertRecoveryManagementCurrent();
          phase.assertCurrent();
        } catch (cause) { firstFailure ??= { cause }; throw firstFailure.cause; }
      };
      const projection = await mode.readStatus(phase);
      guard = projection.assertCurrent.bind(projection);
      const value = parseWorkspaceRecoveryManagementStatus(projection.value);
      if ((phase.operationState === 'busy' && value.operationState !== 'busy') ||
          (value.operationState === 'idle' && value.target.workspaceId !== mode.targetWorkspaceId)) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
      }
      assertCurrent();
      return Object.freeze({ value, assertCurrent });
    });
  }

  private assertRecoveryManagementCurrent(): void {
    if (this.recoveryManagement === undefined) return;
    if (this.recoveryManagementFailure !== undefined) throw this.recoveryManagementFailure.cause;
    try {
      if (this.shutdownRequested) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
      assertUpdateJournalAuthority(this.recoveryManagement.assertCurrent);
    } catch (cause) {
      this.recoveryManagementFailure ??= { cause };
      this.closeAdmission();
      throw this.recoveryManagementFailure.cause;
    }
  }

  private async assertRecoveryManagementSelected(): Promise<void> {
    const mode = this.recoveryManagement;
    if (mode === undefined) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'delete');
    try {
      this.assertRecoveryManagementCurrent();
      const result: unknown = await mode.assertSelected();
      if (result !== undefined) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'delete');
      this.assertRecoveryManagementCurrent();
    } catch (cause) {
      this.recoveryManagementFailure ??= { cause };
      this.closeAdmission();
      throw this.recoveryManagementFailure.cause;
    }
  }

  closeAdmission(): void {
    if (!this.admissionClosed) {
      this.observationGeneration = {};
      this.statusPublicationGeneration = {};
    }
    this.admissionClosed = true;
  }

  captureOperationContext(): Readonly<WorkspaceManagementOperationContext> {
    const generation = this.observationGeneration;
    let current = true;
    const assertCurrent = () => {
      if (!current || this.shutdownRequested || this.activeOperation ||
          this.pendingWork.size !== 0 || this.observationGeneration !== generation) {
        current = false;
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
      }
    };
    assertCurrent();
    return Object.freeze({ operation: this.observedOperation, assertCurrent });
  }

  shutdown(): Promise<void> {
    this.shutdownRequested = true;
    this.closeAdmission();
    // Settlement is not successful mutation, native exit or cleanup authority.
    this.shutdownTask ??= Promise.all([...this.pendingWork]).then(() => {
      if (this.deletionCompletionFailures.length !== 0) {
        throw new AggregateError([...this.deletionCompletionFailures],
          'WORKSPACE_MANAGEMENT_COMPLETION_FAILED', { cause: this.deletionCompletionFailures[0] });
      }
    });
    return this.shutdownTask;
  }

  private ordinaryOptions(operation: WorkspaceManagementOperationKind): Readonly<WorkspaceManagementOrdinaryServiceOptions> {
    if (this.recoveryManagement !== undefined || this.options.recoveryManagement !== undefined) {
      throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', operation);
    }
    return this.options;
  }

  private async readStatus(): Promise<Readonly<WorkspaceManagementStatusV1>> {
    try {
      const options = this.ordinaryOptions('status');
      let firstFailure: { cause: unknown } | undefined;
      const read = <T>(operation: () => Promise<T>) => Promise.resolve().then(() => {
        this.assertAdmissionOpen('status');
        return operation();
      }).catch((cause: unknown) => {
        firstFailure ??= { cause };
        throw cause;
      });
      const [registryResult, recoveryResult] = await Promise.allSettled([
        read(() => options.registry.read()),
        read(() => options.operationGuard.readRecoveryState()),
      ]);
      if (firstFailure !== undefined) throw firstFailure.cause;
      if (registryResult.status === 'rejected') throw registryResult.reason;
      if (recoveryResult.status === 'rejected') throw recoveryResult.reason;
      this.assertAdmissionOpen('status');
      const registry = registryResult.value;
      const recoveryState = recoveryResult.value;
      if (registry === undefined) {
        throw new WorkspaceManagementError(
          'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
          'status',
        );
      }
      return createWorkspaceManagementStatus({
        maintenanceState: options.maintenanceState.readState(),
        operationRecoveryRequired: recoveryState === 'recoveryRequired',
        registry,
      });
    } catch (error) {
      throw mapWorkspaceManagementError(error, 'status');
    }
  }

  createEmpty(workspaceLabel: unknown) {
    return this.run('create', () =>
      this.ordinaryOptions('create').createEmpty.create(workspaceLabel),
    );
  }

  importBackupAsNew(input: Readonly<WorkspaceBackupImportInput>) {
    return this.run('import', () => this.ordinaryOptions('import').importBackup.import(input));
  }

  replaceActiveFromBackup(input: Readonly<WorkspaceBackupReplacementInput>) {
    return this.run('replace', () => {
      const options = this.ordinaryOptions('replace');
      if (options.replaceActive === undefined) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'replace');
      }
      return options.replaceActive.replace(input);
    });
  }

  switchTo(workspaceIdInput: unknown): Promise<void> {
    return this.run('switch', async () => {
      let workspaceId: WorkspaceId;
      try {
        workspaceId = validateWorkspaceId(workspaceIdInput);
      } catch {
        throw new WorkspaceManagementError(
          'WORKSPACE_MANAGEMENT_INVALID',
          'switch',
        );
      }
      await this.ordinaryOptions('switch').switchWorkspace.switchTo(workspaceId);
    });
  }

  rename(
    workspaceId: unknown,
    workspaceLabel: unknown,
  ): Promise<Readonly<WorkspaceLabelRenameResult>> {
    return this.run('rename', () =>
      this.ordinaryOptions('rename').renameWorkspace.rename(workspaceId, workspaceLabel),
    );
  }

  prepareDeletion(
    requestInput: unknown,
    lifetime: WorkspaceDeletionPreparationLifetime,
  ): Promise<WorkspaceDeletionPreparationOutcome> {
    if (this.recoveryManagement !== undefined) {
      return Promise.reject(new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'delete'));
    }
    return this.runDeletion(requestInput, lifetime, false);
  }

  // Main-only. No IPC or production composition enables the final command yet.
  deleteWorkspace(
    requestInput: unknown,
    lifetime: WorkspaceDeletionPreparationLifetime,
    onFailureOutcome?: WorkspaceDeletionFailureOutcomeHandler,
  ): Promise<WorkspaceDeletionCompletion | Readonly<{ formatVersion: 1; status: 'cancelled' }>> {
    return this.runDeletion(requestInput, lifetime, true, onFailureOutcome);
  }

  private runDeletion(requestInput: unknown, lifetime: WorkspaceDeletionPreparationLifetime,
    durable: false): Promise<WorkspaceDeletionPreparationOutcome>;
  private runDeletion(requestInput: unknown, lifetime: WorkspaceDeletionPreparationLifetime,
    durable: true, onFailureOutcome?: WorkspaceDeletionFailureOutcomeHandler): Promise<WorkspaceDeletionCompletion | Readonly<{ formatVersion: 1; status: 'cancelled' }>>;
  private runDeletion(
    requestInput: unknown,
    callerLifetime: WorkspaceDeletionPreparationLifetime,
    durable: boolean,
    onFailureOutcome?: WorkspaceDeletionFailureOutcomeHandler,
  ) {
    const lifetime = this.recoveryManagement === undefined ? callerLifetime : (() => {
      const current = callerLifetime.assertCurrent.bind(callerLifetime);
      const close = callerLifetime.closeAdmissionForOwnStop.bind(callerLifetime);
      return Object.freeze({
        assertCurrent: () => {
          this.assertRecoveryManagementCurrent();
          assertUpdateJournalAuthority(current);
          this.assertRecoveryManagementCurrent();
        },
        closeAdmissionForOwnStop: close,
      });
    })();
    let request: Readonly<WorkspaceDeletionRequest>;
    try {
      request = parseWorkspaceDeletionRequest(requestInput);
      if (this.recoveryManagement !== undefined && request.workspaceId !== this.recoveryManagement.targetWorkspaceId) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'delete');
      }
    } catch (cause) {
      const failure = new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_INVALID', 'delete', { cause },
      );
      WorkspaceManagementService.reportDeletionFailure(onFailureOutcome, failure, 'none');
      return Promise.reject(failure);
    }
    let lease: WorkspaceMaintenanceLeaseHandle | undefined;
    let assertLease: (() => void) | undefined;
    let returnRequested = false;
    let stage: WorkspaceDeletionFailureStage = 'deletePreparation';
    let observing = false;
    const observeStage = (value: WorkspaceDeletionExecutionStage) => {
      if (observing && workspaceDeletionFailureStages.some(allowed =>
        allowed !== 'admission' && allowed !== 'deletePreparation' && allowed === value)) stage = value;
    };
    return this.run('delete', async () => {
      assertUpdateJournalAuthority(lifetime.assertCurrent.bind(lifetime));
      const preparation = this.options.deletionPreparation;
      const continuation = this.options.deletionContinuation;
      if (preparation === undefined || (durable && continuation === undefined)) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'delete');
      }
      const captureAuthority = durable ? continuation!.captureAuthority.bind(continuation) : undefined;
      const resume = durable ? continuation!.resume.bind(continuation) : undefined;
      const operationId = randomUUID();
      lease = await preparation.maintenanceLease.acquire('delete');
      this.assertAdmissionOpen('delete');
      assertUpdateJournalAuthority(lifetime.assertCurrent.bind(lifetime));
      if (this.recoveryManagement !== undefined) {
        await this.assertRecoveryManagementSelected();
        this.assertAdmissionOpen('delete');
        assertUpdateJournalAuthority(lifetime.assertCurrent.bind(lifetime));
      }
      assertLease = preparation.maintenanceLease.captureCurrentOwner(['delete'], lease);
      const capturedLease = assertLease;
      const outcome = await preparation.prepare(request, lifetime, capturedLease, operationId);
      assertUpdateJournalAuthority(lifetime.assertCurrent.bind(lifetime));
      assertUpdateJournalAuthority(assertLease);
      if (outcome !== 'prepared' && outcome !== 'cancelled' && outcome !== 'returnRequested') {
        throw new Error('WORKSPACE_DELETION_PREPARATION_RESULT_INVALID');
      }
      returnRequested = outcome === 'returnRequested';
      if (!durable) return outcome;
      if (outcome !== 'prepared') return Object.freeze({ formatVersion: 1 as const, status: 'cancelled' as const });
      stage = 'deleteAuthorization';
      const captured = captureAuthority!(operationId, capturedLease);
      const owner = Object.freeze({ assertCurrent: captured.assertCurrent.bind(captured),
        assertOwned: captured.assertOwned.bind(captured), recordRemoved: captured.recordRemoved.bind(captured) });
      assertUpdateJournalAuthority(lifetime.assertCurrent.bind(lifetime));
      assertUpdateJournalAuthority(capturedLease);
      observing = true;
      try {
        return await WorkspaceManagementService.continueDeletion(operationId, owner, capturedLease,
          () => this.shutdownRequested, (id, authority) => resume!(id, authority, observeStage));
      } finally { observing = false; }
    }, {
      ...(onFailureOutcome === undefined ? {} : { onFailureOutcome }),
      readFailureStage: () => stage,
      assertRelaunch: () => {
        if (!returnRequested || assertLease === undefined) {
          throw new WorkspaceManagementError('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'delete');
        }
        assertUpdateJournalAuthority(lifetime.assertCurrent.bind(lifetime));
        assertUpdateJournalAuthority(assertLease);
      },
      async release() {
        returnRequested = false;
        await lease?.release();
      },
    });
  }

  // Live and pre-runtime entries share the same durable lifetime and receipt
  // checks; neither a requester nor a later lease can revive this authority.
  private static async continueDeletion(
    operationId: string,
    owner: WorkspaceDeletionContinuationOwner,
    assertLease: () => void,
    isStopping: () => boolean,
    resume: NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume'],
  ): Promise<WorkspaceDeletionCompletion> {
    const assertMain = owner.assertCurrent.bind(owner), assertOwned = owner.assertOwned.bind(owner);
    const recordRemoved = owner.recordRemoved.bind(owner);
    let current = true, removed: WorkspaceDeletionCompletion | undefined;
    const assertCurrent = () => {
      try {
        if (!current || isStopping()) throw new WorkspaceManagementError('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'delete');
        assertUpdateJournalAuthority(assertLease);
        assertUpdateJournalAuthority(assertMain);
        if (!current || isStopping()) throw new WorkspaceManagementError('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'delete');
        assertUpdateJournalAuthority(assertLease);
      } catch (cause) { current = false; throw cause; }
    };
    const assertMutationCurrent = () => {
      assertCurrent();
      if (removed !== undefined) throw new Error('WORKSPACE_DELETION_ALREADY_REMOVED');
    };
    const authority = Object.freeze({ assertCurrent: assertMutationCurrent, async assertOwned() {
      assertMutationCurrent();
      try { await assertOwned(); }
      catch (cause) { current = false; throw cause; }
      assertMutationCurrent();
    }, recordRemoved(receipt: unknown) {
      assertMutationCurrent(); removed = Object.freeze({ ...recordRemoved(receipt) });
    } });
    try {
      await authority.assertOwned(); assertCurrent();
      const result = await resume(operationId, authority);
      assertCurrent();
      if (removed === undefined || result.formatVersion !== 1 || result.status !== 'completed' ||
          (result.navigation !== 'selector' && result.navigation !== 'reopenPrevious') || result.navigation !== removed.navigation) {
        throw new Error('WORKSPACE_DELETION_RESULT_INVALID');
      }
      return Object.freeze({ formatVersion: 1 as const, status: 'completed' as const, navigation: result.navigation });
    } finally { current = false; }
  }

  private static async completeDeletion(
    completion: DeletionPreparationCompletion,
    complete: () => void,
    failures: unknown[],
    onFailure: (cause: unknown) => void,
  ): Promise<void> {
    const release = completion.release.bind(completion);
    try { complete(); }
    catch (cause) { failures.push(cause); onFailure(cause); }
    try { await release(); }
    catch (cause) { failures.push(cause); onFailure(cause); }
  }

  private run<T>(
    operationKind: Exclude<WorkspaceManagementOperationKind, 'status' | 'deleteResume'>,
    operation: () => Promise<T>,
    deletionCompletion?: DeletionPreparationCompletion,
  ): Promise<T> {
    return this.trackWork(operationKind, () => this.runAdmitted(operationKind, operation, deletionCompletion));
  }

  private async runAdmitted<T>(
    operationKind: Exclude<WorkspaceManagementOperationKind, 'status' | 'deleteResume'>,
    operation: () => Promise<T>,
    deletionCompletion?: DeletionPreparationCompletion,
  ): Promise<T> {
    const correlationId = randomUUID();
    const startedAt = this.now();
    if (this.activeOperation) {
      const busyError = new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_BUSY',
        operationKind,
      );
      WorkspaceManagementService.reportDeletionFailure(deletionCompletion?.onFailureOutcome, busyError, 'none');
      this.record({
        correlationId,
        durationMs: Math.max(0, this.now() - startedAt),
        errorCode: busyError.code,
        operationKind,
        outcome: 'failed',
        retryable: true,
        sideEffectState: 'none',
        stage: 'admission',
      });
      throw busyError;
    }
    this.activeOperation = true;
    this.observationGeneration = {};
    this.statusPublicationGeneration = {};
    const observedOperation = Object.freeze({ correlationId, operationKind });
    this.observedOperation = observedOperation;
    this.observeOperation('operationStarted', observedOperation);
    let operationStarted = false;
    let deletionCleanupFailed = false;
    const failures: unknown[] = [];
    try {
      let result!: T;
      try {
        if (this.recoveryManagement === undefined) await this.ordinaryOptions(operationKind).operationGuard.assertNoUnresolvedOperations();
        else {
          if (operationKind !== 'delete') throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', operationKind);
          await this.assertRecoveryManagementSelected();
        }
        this.assertAdmissionOpen(operationKind);
        operationStarted = true;
        result = await operation();
      } catch (cause) {
        failures.push(cause);
      }
      // Completion borrows the exact lease; pending work includes its release.
      if (deletionCompletion !== undefined) {
        await WorkspaceManagementService.completeDeletion(deletionCompletion,
          () => { if (this.recoveryManagement === undefined) this.options.runtimeRelaunchCompletion?.complete(deletionCompletion.assertRelaunch); }, failures,
          cause => { deletionCleanupFailed = true; this.deletionCompletionFailures.push(cause); this.closeAdmission(); });
      } else if (this.recoveryManagement === undefined) {
        try { this.options.runtimeRelaunchCompletion?.complete(undefined); }
        catch (cause) { failures.push(cause); this.closeAdmission(); }
      }
      if (failures.length !== 0) throw failures[0];
      if (operationKind !== 'delete') {
        this.record({
          correlationId,
          durationMs: Math.max(0, this.now() - startedAt),
          operationKind,
          outcome: 'succeeded',
          sideEffectState: 'completed',
          stage: 'operation',
        });
      }
      return result;
    } catch (error) {
      const classification = operationStarted && operationKind !== 'delete'
        ? classifyWorkspaceManagementFailure(error, operationKind)
        : { lineageMismatch: false };
      const mapped = WorkspaceManagementService.mapOperationFailure(error, operationKind, failures);
      const deletionSideEffectState = !operationStarted && failures.length === 1 ? 'none' : 'unknown';
      WorkspaceManagementService.reportDeletionFailure(deletionCompletion?.onFailureOutcome, mapped, deletionSideEffectState);
      const cleanupCauseCode = operationStarted ? readWorkspaceCandidateCleanupCause(error) : undefined;
      const durationMs = Math.max(0, this.now() - startedAt);
      this.record({
        ...((operationKind === 'import' || operationKind === 'replace')
          ? {
              ...('inspectionCauseCode' in classification && classification.inspectionCauseCode !== undefined
                ? { inspectionCauseCode: classification.inspectionCauseCode } : {}),
              ...(cleanupCauseCode === undefined ? {} : { cleanupCauseCode }),
            }
          : {}),
        correlationId,
        durationMs,
        errorCode: classification.lineageMismatch ? 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH' : mapped.code,
        operationKind,
        outcome: 'failed',
        retryable: !this.admissionClosed && mapped.code === 'WORKSPACE_MANAGEMENT_BUSY',
        sideEffectState:
          (operationKind === 'delete'
            ? deletionSideEffectState === 'none'
            : mapped.code === 'WORKSPACE_MANAGEMENT_INVALID' ||
              mapped.code === 'WORKSPACE_MANAGEMENT_BUSY')
            ? 'none'
            : 'unknown',
        stage: operationKind === 'delete'
          ? operationStarted ? deletionCompletion?.readFailureStage?.() ?? 'deletePreparation' : 'admission'
          : classification.lineageMismatch ? 'lineageCheck' : 'operation',
      });
      if (operationKind === 'delete' && deletionCleanupFailed) {
        this.record({ correlationId, durationMs, operationKind, outcome: 'failed',
          errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', retryable: false,
          sideEffectState: 'unknown', stage: 'deleteCleanup' });
      }
      throw mapped;
    } finally {
      this.observeOperation('operationSettled', observedOperation);
      this.activeOperation = false;
      this.statusPublicationGeneration = {};
    }
  }

  private async trackWork<T>(
    operationKind: WorkspaceManagementOperationKind,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.assertAdmissionOpen(operationKind);
    let settle!: () => void;
    const completion = new Promise<void>(resolve => { settle = resolve; });
    // Publish before invoking collaborators which can re-enter shutdown.
    this.pendingWork.add(completion);
    try {
      return await operation();
    } finally {
      this.pendingWork.delete(completion);
      settle();
    }
  }

  private assertAdmissionOpen(operationKind: WorkspaceManagementOperationKind): void {
    if (this.admissionClosed) {
      throw new WorkspaceManagementError(
        operationKind === 'delete'
          ? 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN'
          : 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
        operationKind,
      );
    }
  }

  private record(
    event: Parameters<WorkspaceManagementObserver['record']>[0],
  ): void {
    WorkspaceManagementService.recordObservation(this.options.observer, event);
  }

  private observeOperation(
    phase: 'operationStarted' | 'operationSettled',
    operation: Readonly<WorkspaceManagementOperationIdentity>,
  ): void {
    WorkspaceManagementService.observeOperation(this.options.observer, phase, operation);
  }

  private static observeOperation(
    observer: WorkspaceManagementObserver | undefined,
    phase: 'operationStarted' | 'operationSettled',
    operation: Readonly<WorkspaceManagementOperationIdentity>,
  ): void {
    try {
      const result: unknown = observer?.[phase]?.(operation);
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Observation callbacks cannot grant authority or change command settlement.
    }
  }

  private static mapOperationFailure(error: unknown, operationKind: WorkspaceManagementOperationKind,
    failures: readonly unknown[]): WorkspaceManagementError {
    const primary = mapWorkspaceManagementError(error, operationKind);
    return failures.length > 1 ? new WorkspaceManagementError(primary.code, operationKind, {
      cause: new AggregateError(failures, 'WORKSPACE_MANAGEMENT_COMPLETION_FAILED', { cause: error }),
    }) : primary;
  }

  private static recordObservation(observer: WorkspaceManagementObserver | undefined,
    event: Parameters<WorkspaceManagementObserver['record']>[0]): void {
    try {
      const result: unknown = observer?.record(event);
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Observability is intentionally non-authoritative.
    }
  }

  private static reportDeletionFailure(handler: WorkspaceDeletionFailureOutcomeHandler | undefined,
    cause: unknown, sideEffectState: WorkspaceDeletionFailureOutcome['sideEffectState']): void {
    try {
      const result: unknown = handler?.(Object.freeze({ cause, sideEffectState }));
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // The original rejection, not a failed callback, remains authoritative.
    }
  }
}
