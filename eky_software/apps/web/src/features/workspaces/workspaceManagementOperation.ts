import type {
  WorkspaceManagementViewCapability,
  WorkspaceManagementEntry,
  WorkspaceManagementViewStatus,
  WorkspaceDeletionRequest,
  WorkspaceDeletionResult,
} from '../../app/desktopWorkspaceManagement.js';
import { matchesWorkspaceDeletionLabel, readWorkspaceDeletionRequest,
  readWorkspaceDeletionResult, workspaceDeletionProtocolVersion } from '../../app/desktopWorkspaceManagement.js';
import type { WorkspaceSelectorMode } from './workspaceSelectorState.js';

type WorkspaceOperationMode = Exclude<WorkspaceSelectorMode, 'list'>;

export type WorkspaceManagementOperationOutcome =
  | Readonly<{ type: 'cancelled' }>
  | Readonly<{ type: 'refreshed'; status: WorkspaceManagementViewStatus }>
  | Readonly<{ type: 'relaunching' }>
  | Readonly<{ type: 'deletion'; result: WorkspaceDeletionResult }>;

export async function runWorkspaceManagementOperation(input: {
  readonly capability: WorkspaceManagementViewCapability;
  readonly mode: WorkspaceOperationMode;
  readonly selectedWorkspace?: WorkspaceManagementEntry;
  readonly status: WorkspaceManagementViewStatus;
  readonly workspaceLabel: string;
  readonly deletionBackupChoice?: WorkspaceDeletionRequest['backupChoice'] | null;
  readonly canCreateDeletionBackup?: boolean;
}): Promise<WorkspaceManagementOperationOutcome> {
  if (input.status.formatVersion === 2) {
    const status = input.status;
    const remove = input.capability.deleteWorkspace;
    if (input.mode !== 'confirmDelete' || status.operationState !== 'idle' ||
        status.maintenanceState !== 'idle' || remove === undefined ||
        input.deletionBackupChoice !== 'explicitDataLoss' ||
        (input.selectedWorkspace !== undefined && (input.selectedWorkspace.workspaceId !== status.target.workspaceId ||
          input.selectedWorkspace.workspaceLabel !== status.target.workspaceLabel)) ||
        !matchesWorkspaceDeletionLabel(input.workspaceLabel, status.target.workspaceLabel)) {
      throw new Error('WORKSPACE_DELETION_UI_UNAVAILABLE');
    }
    const request = readWorkspaceDeletionRequest({ formatVersion: workspaceDeletionProtocolVersion,
      workspaceId: status.target.workspaceId, typedLabel: input.workspaceLabel, backupChoice: 'explicitDataLoss' });
    return Object.freeze({ type: 'deletion', result: readWorkspaceDeletionResult(await remove(request)) });
  }
  switch (input.mode) {
    case 'confirmDelete': {
      const selected = requireSelectedWorkspace(input.selectedWorkspace);
      const target = input.status.workspaces.find(entry => entry.workspaceId === selected.workspaceId);
      const remove = input.capability.deleteWorkspace;
      if (remove === undefined || input.status.operationState !== 'idle' || target === undefined ||
          target.workspaceLabel !== selected.workspaceLabel ||
          !matchesWorkspaceDeletionLabel(input.workspaceLabel, target.workspaceLabel) ||
          (input.deletionBackupChoice === 'createBackup' &&
            (input.canCreateDeletionBackup !== true || !target.isActive ||
              target.availability !== 'ready' || input.status.activeWorkspaceId !== target.workspaceId))) {
        throw new Error('WORKSPACE_DELETION_UI_UNAVAILABLE');
      }
      const request = readWorkspaceDeletionRequest({ formatVersion: workspaceDeletionProtocolVersion,
        workspaceId: target.workspaceId, typedLabel: input.workspaceLabel, backupChoice: input.deletionBackupChoice });
      const result = readWorkspaceDeletionResult(await remove(request));
      return Object.freeze({ type: 'deletion', result });
    }
    case 'create': {
      const result = await input.capability.createEmpty(input.workspaceLabel);
      return refreshOrRelaunch(input.capability, result);
    }
    case 'import': {
      const result = await input.capability.importBackupAsNew(
        input.workspaceLabel,
      );
      if (result === 'cancelled') return Object.freeze({ type: 'cancelled' });
      return refreshOrRelaunch(input.capability, result);
    }
    case 'rename': {
      const selectedWorkspace = requireSelectedWorkspace(
        input.selectedWorkspace,
      );
      if (selectedWorkspace.workspaceLabel === input.workspaceLabel) {
        return Object.freeze({ status: input.status, type: 'refreshed' });
      }
      await input.capability.rename(
        selectedWorkspace.workspaceId,
        input.workspaceLabel,
      );
      return Object.freeze({
        status: await input.capability.getStatus(),
        type: 'refreshed',
      });
    }
    case 'confirmSwitch': {
      const selectedWorkspace = requireSelectedWorkspace(
        input.selectedWorkspace,
      );
      if (selectedWorkspace.isActive) {
        return Object.freeze({ status: input.status, type: 'refreshed' });
      }
      const result = await input.capability.switchTo(
        selectedWorkspace.workspaceId,
      );
      return refreshOrRelaunch(input.capability, result);
    }
    case 'confirmReplace': {
      const selectedWorkspace = requireSelectedWorkspace(
        input.selectedWorkspace,
      );
      const replaceActiveFromBackup =
        input.capability.replaceActiveFromBackup;
      if (
        replaceActiveFromBackup === undefined ||
        input.status.operationState !== 'idle' ||
        !selectedWorkspace.isActive ||
        selectedWorkspace.availability !== 'ready'
      ) {
        throw new Error('WORKSPACE_REPLACEMENT_UI_UNAVAILABLE');
      }
      const result = await replaceActiveFromBackup();
      return result === 'cancelled'
        ? Object.freeze({ type: 'cancelled' })
        : Object.freeze({ type: 'relaunching' });
    }
  }
}

async function refreshOrRelaunch(
  capability: WorkspaceManagementViewCapability,
  result: 'completed' | 'relaunching',
): Promise<WorkspaceManagementOperationOutcome> {
  if (result === 'relaunching') {
    return Object.freeze({ type: 'relaunching' });
  }
  return Object.freeze({
    status: await capability.getStatus(),
    type: 'refreshed',
  });
}

function requireSelectedWorkspace(
  workspace: WorkspaceManagementEntry | undefined,
): WorkspaceManagementEntry {
  if (workspace === undefined) {
    throw new Error('WORKSPACE_MANAGEMENT_UI_SELECTION_REQUIRED');
  }
  return workspace;
}
