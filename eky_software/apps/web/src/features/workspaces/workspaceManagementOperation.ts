import type {
  WorkspaceManagementCapability,
  WorkspaceManagementEntry,
  WorkspaceManagementStatus,
} from '../../app/desktopWorkspaceManagement.js';
import type { WorkspaceSelectorMode } from './workspaceSelectorState.js';

type WorkspaceOperationMode = Exclude<WorkspaceSelectorMode, 'list'>;

export type WorkspaceManagementOperationOutcome =
  | Readonly<{ type: 'cancelled' }>
  | Readonly<{ type: 'refreshed'; status: WorkspaceManagementStatus }>
  | Readonly<{ type: 'relaunching' }>;

export async function runWorkspaceManagementOperation(input: {
  readonly capability: WorkspaceManagementCapability;
  readonly mode: WorkspaceOperationMode;
  readonly selectedWorkspace?: WorkspaceManagementEntry;
  readonly status: WorkspaceManagementStatus;
  readonly workspaceLabel: string;
}): Promise<WorkspaceManagementOperationOutcome> {
  switch (input.mode) {
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
  capability: WorkspaceManagementCapability,
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
