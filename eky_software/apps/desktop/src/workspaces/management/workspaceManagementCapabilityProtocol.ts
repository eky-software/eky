import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import {
  isWorkspaceDeletionFailureCode,
  type WorkspaceDeletionFailureCode,
} from '../../observability/workspaceManagementFailureContext.js';
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

export interface WorkspaceDeletionRequest {
  readonly formatVersion: 1;
  readonly workspaceId: ReturnType<typeof validateWorkspaceId>;
  readonly typedLabel: string;
  readonly backupChoice: 'createBackup' | 'explicitDataLoss';
}

export type WorkspaceOperationResult = Readonly<{
  formatVersion: 1;
  status: 'cancelled' | 'completed' | 'relaunching';
}>;

export type WorkspaceDeletionOperationResult = Readonly<
  | { formatVersion: 1; status: 'cancelled'; nextAction: 'continue' | 'relaunching' | 'restartRequired' }
  | { formatVersion: 1; status: 'completed'; navigation: 'selector' | 'reopenPrevious' }
  | { formatVersion: 1; status: 'failed'; errorCode: WorkspaceDeletionFailureCode;
      sideEffectState: 'none'; nextAction: 'continue' | 'restartRequired' }
  | { formatVersion: 1; status: 'recoveryRequired'; errorCode: WorkspaceDeletionFailureCode;
      sideEffectState: 'unknown'; nextAction: 'restartRequired' }
>;

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

export function parseWorkspaceDeletionRequest(
  value: unknown,
): Readonly<WorkspaceDeletionRequest> {
  try {
    if (
      !isPlainDataRecord(value) ||
      !hasExactDataKeys(value, ['formatVersion', 'workspaceId', 'typedLabel', 'backupChoice']) ||
      value.formatVersion !== workspaceManagementCapabilityProtocolVersion ||
      (value.backupChoice !== 'createBackup' && value.backupChoice !== 'explicitDataLoss')
    ) {
      return invalidCapabilityValue();
    }
    return Object.freeze({
      formatVersion: workspaceManagementCapabilityProtocolVersion,
      workspaceId: validateWorkspaceId(value.workspaceId),
      typedLabel: validateWorkspaceLabel(value.typedLabel),
      backupChoice: value.backupChoice,
    });
  } catch {
    return invalidCapabilityValue();
  }
}

// This validates a projection, not deletion, recovery or runtime authority.
export function parseWorkspaceDeletionOperationResult(
  value: unknown,
): WorkspaceDeletionOperationResult {
  try {
    if (!isPlainDataRecord(value)) return invalidCapabilityValue();
    if (hasExactDataKeys(value, ['formatVersion', 'status', 'navigation'])) {
      if (value.formatVersion !== workspaceManagementCapabilityProtocolVersion ||
          value.status !== 'completed' ||
          (value.navigation !== 'selector' && value.navigation !== 'reopenPrevious')) {
        return invalidCapabilityValue();
      }
      return Object.freeze({ formatVersion: workspaceManagementCapabilityProtocolVersion,
        status: 'completed', navigation: value.navigation });
    }
    if (hasExactDataKeys(value, ['formatVersion', 'status', 'nextAction'])) {
      if (value.formatVersion !== workspaceManagementCapabilityProtocolVersion ||
          value.status !== 'cancelled' ||
          (value.nextAction !== 'continue' && value.nextAction !== 'relaunching' && value.nextAction !== 'restartRequired')) {
        return invalidCapabilityValue();
      }
      return Object.freeze({ formatVersion: workspaceManagementCapabilityProtocolVersion,
        status: 'cancelled', nextAction: value.nextAction });
    }
    if (!hasExactDataKeys(value, ['formatVersion', 'status', 'errorCode', 'sideEffectState', 'nextAction']) ||
        value.formatVersion !== workspaceManagementCapabilityProtocolVersion ||
        !isWorkspaceDeletionFailureCode(value.errorCode)) return invalidCapabilityValue();
    if (value.status === 'failed' && value.sideEffectState === 'none' &&
        (value.nextAction === 'continue' || value.nextAction === 'restartRequired')) {
      return Object.freeze({ formatVersion: workspaceManagementCapabilityProtocolVersion,
        status: 'failed', errorCode: value.errorCode, sideEffectState: 'none', nextAction: value.nextAction });
    }
    if (value.status === 'recoveryRequired' && value.sideEffectState === 'unknown' && value.nextAction === 'restartRequired') {
      return Object.freeze({ formatVersion: workspaceManagementCapabilityProtocolVersion,
        status: 'recoveryRequired', errorCode: value.errorCode, sideEffectState: 'unknown', nextAction: 'restartRequired' });
    }
    return invalidCapabilityValue();
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
