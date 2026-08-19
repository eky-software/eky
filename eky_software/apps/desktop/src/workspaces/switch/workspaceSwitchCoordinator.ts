import { randomUUID } from 'node:crypto';

import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { selectActiveWorkspace } from '../registry/workspaceRegistryMutations.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import {
  mapWorkspaceSwitchError,
  WorkspaceSwitchError,
} from './workspaceSwitchError.js';
import {
  type WorkspaceSwitchJournalPort,
  type WorkspaceSwitchJournalV1,
} from './workspaceSwitchJournal.js';

export interface WorkspaceSwitchCoordinatorOptions {
  readonly activeWorkspaceLifecycle: ActiveWorkspaceLifecyclePort;
  readonly generateOperationId?: () => string;
  readonly journal: WorkspaceSwitchJournalPort;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly now?: () => Date;
  readonly registry: WorkspaceRegistryPort;
  readonly relaunchApplication: () => void;
}

export class WorkspaceSwitchCoordinator {
  private readonly generateOperationId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly options: Readonly<WorkspaceSwitchCoordinatorOptions>,
  ) {
    this.generateOperationId = options.generateOperationId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async switchTo(targetWorkspaceId: WorkspaceId): Promise<void> {
    const lease = await this.options.maintenanceLease.acquire('switch').catch(
      () => {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
      },
    );
    let journal: Readonly<WorkspaceSwitchJournalV1> | undefined;
    let sourceWorkspaceId: WorkspaceId | undefined;
    let lifecycleTransitionStarted = false;
    let operationError: WorkspaceSwitchError | undefined;
    try {
      if ((await this.options.journal.read()) !== undefined) {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
      }
      const registry = await this.options.registry.read();
      if (registry === undefined || registry.activeWorkspaceId === null) {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      }
      sourceWorkspaceId = registry.activeWorkspaceId;
      const selected = selectActiveWorkspace(
        registry,
        sourceWorkspaceId,
        targetWorkspaceId,
      );

      lifecycleTransitionStarted = true;
      await this.options.activeWorkspaceLifecycle.quiesceWrites(
        sourceWorkspaceId,
      );
      const stopped =
        await this.options.activeWorkspaceLifecycle.stopAndProveHandlesClosed(
          sourceWorkspaceId,
        );
      if (stopped.handlesClosed !== true) {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
      }

      journal = Object.freeze({
        formatVersion: 1,
        operationId: this.generateOperationId(),
        sourceWorkspaceId,
        targetWorkspaceId,
        state: 'prepared',
        createdAt: this.now().toISOString(),
      });
      await this.options.journal.write(journal);
      await this.options.registry.write(selected);
      journal = Object.freeze({ ...journal, state: 'targetSelected' });
      await this.options.journal.write(journal);
      this.options.relaunchApplication();
    } catch (error) {
      operationError = await this.recoverBeforeReturning(
        mapWorkspaceSwitchError(error),
        journal,
        sourceWorkspaceId,
        lifecycleTransitionStarted,
      );
    }

    try {
      await lease.release();
    } catch {
      operationError ??= new WorkspaceSwitchError(
        'WORKSPACE_SWITCH_STORAGE_FAILED',
      );
    }
    if (operationError !== undefined) {
      throw operationError;
    }
  }

  private async recoverBeforeReturning(
    originalError: WorkspaceSwitchError,
    journal: Readonly<WorkspaceSwitchJournalV1> | undefined,
    sourceWorkspaceId: WorkspaceId | undefined,
    lifecycleTransitionStarted: boolean,
  ): Promise<WorkspaceSwitchError> {
    let recoveryFailed = false;
    if (journal !== undefined && sourceWorkspaceId !== undefined) {
      try {
        await this.rollbackBeforeRelaunch(journal);
      } catch {
        recoveryFailed = true;
      }
    }
    if (lifecycleTransitionStarted && sourceWorkspaceId !== undefined) {
      try {
        await this.options.activeWorkspaceLifecycle
          .ensurePreviousWorkspaceRunning(sourceWorkspaceId);
      } catch {
        recoveryFailed = true;
      }
    }
    if (recoveryFailed) {
      await this.markRecoveryRequired(journal);
      return new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    return originalError;
  }

  private async rollbackBeforeRelaunch(
    journal: Readonly<WorkspaceSwitchJournalV1>,
  ): Promise<void> {
    const registry = await this.options.registry.read();
    if (registry === undefined) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    const current = await this.options.journal.read();
    if (
      current === undefined ||
      current.operationId !== journal.operationId
    ) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    if (registry.activeWorkspaceId === journal.targetWorkspaceId) {
      await this.options.registry.write(
        selectActiveWorkspace(
          registry,
          journal.targetWorkspaceId,
          journal.sourceWorkspaceId,
        ),
      );
      await this.options.journal.write({
        ...current,
        state: 'rollbackSelected',
      });
      return;
    }
    if (registry.activeWorkspaceId !== journal.sourceWorkspaceId) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    if (current.state === 'prepared') {
      await this.options.journal.clear(journal.operationId);
      return;
    }
    await this.options.journal.write({
      ...current,
      state: 'rollbackSelected',
    });
  }

  private async markRecoveryRequired(
    journal: Readonly<WorkspaceSwitchJournalV1> | undefined,
  ): Promise<void> {
    if (journal === undefined) return;
    try {
      const current = await this.options.journal.read();
      if (current?.operationId !== journal.operationId) return;
      await this.options.journal.write({
        ...current,
        state: 'recoveryRequired',
      });
    } catch {
      // The recovery-required return code remains fail-closed even if the
      // durable marker cannot be advanced.
    }
  }
}
