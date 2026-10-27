import { randomUUID } from 'node:crypto';
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
import type { WorkspaceMaintenanceStateReader } from '../maintenance/workspaceMaintenanceLease.js';
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
import { createWorkspaceManagementStatus } from './workspaceManagementStatus.js';
import type {
  WorkspaceManagementObserver,
  WorkspaceManagementOperationKind,
  WorkspaceManagementStatusV1,
  WorkspaceDeletionPreparationLifetime,
  WorkspaceDeletionPreparationOutcome,
} from './workspaceManagementTypes.js';
import type { WorkspaceLabelRenameResult } from './workspaceLabelRename.js';
import type { WorkspaceRuntimeRelaunchCompletion } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';

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

export interface WorkspaceManagementServiceOptions {
  readonly createEmpty: EmptyWorkspaceCreationCommand;
  readonly importBackup: WorkspaceBackupImportCommand;
  readonly maintenanceState: WorkspaceMaintenanceStateReader;
  readonly now?: () => number;
  readonly observer?: WorkspaceManagementObserver;
  readonly operationGuard: WorkspaceManagementOperationGuard;
  readonly registry: Pick<WorkspaceRegistryPort, 'read'>;
  readonly renameWorkspace: WorkspaceLabelRenameCommand;
  readonly replaceActive?: WorkspaceBackupReplacementCommand;
  readonly runtimeRelaunchCompletion?: WorkspaceRuntimeRelaunchCompletion;
  readonly switchWorkspace: WorkspaceSwitchCommand;
  readonly deletionPreparation?: {
    prepare(
      request: Readonly<WorkspaceDeletionRequest>,
      lifetime: WorkspaceDeletionPreparationLifetime,
    ): Promise<WorkspaceDeletionPreparationOutcome>;
  };
}

export class WorkspaceManagementService {
  private activeOperation = false;
  private admissionClosed = false;
  private readonly pendingWork = new Set<Promise<void>>();
  private shutdownTask: Promise<void> | undefined;
  private readonly now: () => number;

  constructor(
    private readonly options: Readonly<WorkspaceManagementServiceOptions>,
  ) {
    this.now = options.now ?? Date.now;
  }

  getStatus(): Promise<Readonly<WorkspaceManagementStatusV1>> {
    return this.trackWork('status', () => this.readStatus());
  }

  closeAdmission(): void {
    this.admissionClosed = true;
  }

  shutdown(): Promise<void> {
    this.closeAdmission();
    // Settlement is not successful mutation, native exit or cleanup authority.
    this.shutdownTask ??= Promise.all([...this.pendingWork]).then(() => undefined);
    return this.shutdownTask;
  }

  private async readStatus(): Promise<Readonly<WorkspaceManagementStatusV1>> {
    try {
      let firstFailure: { cause: unknown } | undefined;
      const read = <T>(operation: () => Promise<T>) => Promise.resolve().then(() => {
        this.assertAdmissionOpen('status');
        return operation();
      }).catch((cause: unknown) => {
        firstFailure ??= { cause };
        throw cause;
      });
      const [registryResult, recoveryResult] = await Promise.allSettled([
        read(() => this.options.registry.read()),
        read(() => this.options.operationGuard.readRecoveryState()),
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
        maintenanceState: this.options.maintenanceState.readState(),
        operationRecoveryRequired: recoveryState === 'recoveryRequired',
        registry,
      });
    } catch (error) {
      throw mapWorkspaceManagementError(error, 'status');
    }
  }

  createEmpty(workspaceLabel: unknown) {
    return this.run('create', () =>
      this.options.createEmpty.create(workspaceLabel),
    );
  }

  importBackupAsNew(input: Readonly<WorkspaceBackupImportInput>) {
    return this.run('import', () => this.options.importBackup.import(input));
  }

  replaceActiveFromBackup(input: Readonly<WorkspaceBackupReplacementInput>) {
    return this.run('replace', () => {
      if (this.options.replaceActive === undefined) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'replace');
      }
      return this.options.replaceActive.replace(input);
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
      await this.options.switchWorkspace.switchTo(workspaceId);
    });
  }

  rename(
    workspaceId: unknown,
    workspaceLabel: unknown,
  ): Promise<Readonly<WorkspaceLabelRenameResult>> {
    return this.run('rename', () =>
      this.options.renameWorkspace.rename(workspaceId, workspaceLabel),
    );
  }

  prepareDeletion(
    requestInput: unknown,
    lifetime: WorkspaceDeletionPreparationLifetime,
  ): Promise<WorkspaceDeletionPreparationOutcome> {
    let request: Readonly<WorkspaceDeletionRequest>;
    try {
      request = parseWorkspaceDeletionRequest(requestInput);
    } catch (cause) {
      return Promise.reject(new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_INVALID', 'delete', { cause },
      ));
    }
    return this.run('delete', async () => {
      lifetime.assertCurrent();
      if (this.options.deletionPreparation === undefined) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'delete');
      }
      const outcome = await this.options.deletionPreparation.prepare(request, lifetime);
      lifetime.assertCurrent();
      if (outcome !== 'prepared' && outcome !== 'cancelled' && outcome !== 'returnRequested') {
        throw new Error('WORKSPACE_DELETION_PREPARATION_RESULT_INVALID');
      }
      return outcome;
    });
  }

  private run<T>(
    operationKind: Exclude<WorkspaceManagementOperationKind, 'status'>,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.trackWork(operationKind, () => this.runAdmitted(operationKind, operation));
  }

  private async runAdmitted<T>(
    operationKind: Exclude<WorkspaceManagementOperationKind, 'status'>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const correlationId = randomUUID();
    const startedAt = this.now();
    if (this.activeOperation) {
      const busyError = new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_BUSY',
        operationKind,
      );
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
    let operationStarted = false;
    try {
      await this.options.operationGuard.assertNoUnresolvedOperations();
      this.assertAdmissionOpen(operationKind);
      operationStarted = true;
      const result = await operation();
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
      const mapped = mapWorkspaceManagementError(error, operationKind);
      const cleanupCauseCode = operationStarted ? readWorkspaceCandidateCleanupCause(error) : undefined;
      this.record({
        ...((operationKind === 'import' || operationKind === 'replace')
          ? {
              ...('inspectionCauseCode' in classification && classification.inspectionCauseCode !== undefined
                ? { inspectionCauseCode: classification.inspectionCauseCode } : {}),
              ...(cleanupCauseCode === undefined ? {} : { cleanupCauseCode }),
            }
          : {}),
        correlationId,
        durationMs: Math.max(0, this.now() - startedAt),
        errorCode: classification.lineageMismatch ? 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH' : mapped.code,
        operationKind,
        outcome: 'failed',
        retryable: mapped.code === 'WORKSPACE_MANAGEMENT_BUSY',
        sideEffectState:
          (operationKind === 'delete'
            ? !operationStarted
            : mapped.code === 'WORKSPACE_MANAGEMENT_INVALID' ||
              mapped.code === 'WORKSPACE_MANAGEMENT_BUSY')
            ? 'none'
            : 'unknown',
        stage: operationKind === 'delete'
          ? operationStarted ? 'deletePreparation' : 'admission'
          : classification.lineageMismatch ? 'lineageCheck' : 'operation',
      });
      throw mapped;
    } finally {
      this.activeOperation = false;
      this.options.runtimeRelaunchCompletion?.complete();
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
    try {
      this.options.observer?.record(event);
    } catch {
      // Observability is intentionally non-authoritative.
    }
  }
}
