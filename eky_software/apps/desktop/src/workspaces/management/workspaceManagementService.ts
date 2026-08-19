import { randomUUID } from 'node:crypto';

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
} from './workspaceManagementTypes.js';
import type { WorkspaceLabelRenameResult } from './workspaceLabelRename.js';

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
  readonly replaceActive: WorkspaceBackupReplacementCommand;
  readonly switchWorkspace: WorkspaceSwitchCommand;
}

export class WorkspaceManagementService {
  private activeOperation = false;
  private readonly now: () => number;

  constructor(
    private readonly options: Readonly<WorkspaceManagementServiceOptions>,
  ) {
    this.now = options.now ?? Date.now;
  }

  async getStatus(): Promise<Readonly<WorkspaceManagementStatusV1>> {
    try {
      const [registry, recoveryState] = await Promise.all([
        this.options.registry.read(),
        this.options.operationGuard.readRecoveryState(),
      ]);
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
    return this.run('replace', () => this.options.replaceActive.replace(input));
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

  private async run<T>(
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
    try {
      const result = await operation();
      this.record({
        correlationId,
        durationMs: Math.max(0, this.now() - startedAt),
        operationKind,
        outcome: 'succeeded',
        sideEffectState: 'completed',
        stage: 'operation',
      });
      return result;
    } catch (error) {
      const mapped = mapWorkspaceManagementError(error, operationKind);
      this.record({
        correlationId,
        durationMs: Math.max(0, this.now() - startedAt),
        errorCode: mapped.code,
        operationKind,
        outcome: 'failed',
        retryable: mapped.code === 'WORKSPACE_MANAGEMENT_BUSY',
        sideEffectState:
          mapped.code === 'WORKSPACE_MANAGEMENT_INVALID' ||
          mapped.code === 'WORKSPACE_MANAGEMENT_BUSY'
            ? 'none'
            : 'unknown',
        stage: 'operation',
      });
      throw mapped;
    } finally {
      this.activeOperation = false;
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
