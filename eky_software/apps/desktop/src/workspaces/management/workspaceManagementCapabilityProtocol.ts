import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import {
  hasExactDataKeys,
  isPlainDataRecord,
} from '../registry/workspaceRegistryValueShape.js';
import { parseWorkspaceManagementStatus } from './workspaceManagementStatus.js';
import type { WorkspaceManagementStatusV1 } from './workspaceManagementTypes.js';

export const workspaceManagementCapabilityProtocolVersion = 1 as const;

export const getWorkspaceManagementStatusIpcChannel =
  'eky:workspace-management:v1:get-status';
export const createEmptyWorkspaceIpcChannel =
  'eky:workspace-management:v1:create-empty';
export const importWorkspaceBackupAsNewIpcChannel =
  'eky:workspace-management:v1:import-backup-as-new';
export const replaceActiveWorkspaceFromBackupIpcChannel =
  'eky:workspace-management:v1:replace-active-from-backup';
export const switchWorkspaceIpcChannel =
  'eky:workspace-management:v1:switch';
export const renameWorkspaceIpcChannel =
  'eky:workspace-management:v1:rename';

export const workspaceManagementIpcChannels = Object.freeze([
  getWorkspaceManagementStatusIpcChannel,
  createEmptyWorkspaceIpcChannel,
  importWorkspaceBackupAsNewIpcChannel,
  replaceActiveWorkspaceFromBackupIpcChannel,
  switchWorkspaceIpcChannel,
  renameWorkspaceIpcChannel,
] as const);

export interface WorkspaceLabelRequest {
  readonly workspaceLabel: string;
}

export interface WorkspaceIdRequest {
  readonly workspaceId: string;
}

export interface WorkspaceRenameRequest extends WorkspaceIdRequest {
  readonly workspaceLabel: string;
}

export type WorkspaceOperationResult = Readonly<{
  formatVersion: 1;
  status: 'cancelled' | 'completed' | 'relaunching';
}>;

export function createWorkspaceOperationResult(
  status: WorkspaceOperationResult['status'],
): WorkspaceOperationResult {
  return Object.freeze({
    formatVersion: workspaceManagementCapabilityProtocolVersion,
    status,
  });
}

export function parseWorkspaceLabelRequest(value: unknown): WorkspaceLabelRequest {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, ['workspaceLabel'])
  ) {
    return invalidCapabilityValue();
  }
  try {
    return Object.freeze({
      workspaceLabel: validateWorkspaceLabel(value.workspaceLabel),
    });
  } catch {
    return invalidCapabilityValue();
  }
}

export function parseWorkspaceIdRequest(value: unknown): WorkspaceIdRequest {
  if (!isPlainDataRecord(value) || !hasExactDataKeys(value, ['workspaceId'])) {
    return invalidCapabilityValue();
  }
  try {
    return Object.freeze({
      workspaceId: validateWorkspaceId(value.workspaceId),
    });
  } catch {
    return invalidCapabilityValue();
  }
}

export function parseWorkspaceRenameRequest(
  value: unknown,
): WorkspaceRenameRequest {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, ['workspaceId', 'workspaceLabel'])
  ) {
    return invalidCapabilityValue();
  }
  try {
    return Object.freeze({
      workspaceId: validateWorkspaceId(value.workspaceId),
      workspaceLabel: validateWorkspaceLabel(value.workspaceLabel),
    });
  } catch {
    return invalidCapabilityValue();
  }
}

export function parseWorkspaceStatusResult(
  value: unknown,
): Readonly<WorkspaceManagementStatusV1> {
  try {
    return parseWorkspaceManagementStatus(value);
  } catch {
    return invalidCapabilityValue();
  }
}

function invalidCapabilityValue(): never {
  throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
}
