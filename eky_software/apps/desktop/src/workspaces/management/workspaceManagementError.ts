import { EmptyWorkspaceCreationError } from '../creation/emptyWorkspaceCreationError.js';
import { WorkspaceBackupImportError } from '../import/workspaceBackupImportError.js';
import { WorkspaceMaintenanceLeaseBusyError } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceRegistryMutationError } from '../registry/workspaceRegistryMutations.js';
import { WorkspaceRegistryValidationError } from '../registry/workspaceRegistryError.js';
import { WorkspaceBackupReplacementError } from '../replacement/workspaceBackupReplacementError.js';
import { WorkspaceSwitchError } from '../switch/workspaceSwitchError.js';
import { WorkspaceManagementRecoveryRequiredError } from './workspaceManagementOperationGuard.js';
import type { WorkspaceManagementOperationKind } from './workspaceManagementTypes.js';

export type WorkspaceManagementErrorCode =
  | 'WORKSPACE_MANAGEMENT_BUSY'
  | 'WORKSPACE_MANAGEMENT_INVALID'
  | 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED'
  | 'WORKSPACE_MANAGEMENT_CREATE_FAILED'
  | 'WORKSPACE_MANAGEMENT_IMPORT_FAILED'
  | 'WORKSPACE_MANAGEMENT_REPLACE_FAILED'
  | 'WORKSPACE_MANAGEMENT_SWITCH_FAILED'
  | 'WORKSPACE_MANAGEMENT_RENAME_FAILED';

export class WorkspaceManagementError extends Error {
  constructor(
    readonly code: WorkspaceManagementErrorCode,
    readonly operationKind: WorkspaceManagementOperationKind,
  ) {
    super(code);
    this.name = 'WorkspaceManagementError';
  }
}

export function mapWorkspaceManagementError(
  error: unknown,
  operationKind: WorkspaceManagementOperationKind,
): WorkspaceManagementError {
  if (error instanceof WorkspaceManagementError) return error;
  if (
    error instanceof WorkspaceMaintenanceLeaseBusyError ||
    isCoordinatorBusyError(error)
  ) {
    return new WorkspaceManagementError(
      'WORKSPACE_MANAGEMENT_BUSY',
      operationKind,
    );
  }
  if (isInvalidError(error)) {
    return new WorkspaceManagementError(
      'WORKSPACE_MANAGEMENT_INVALID',
      operationKind,
    );
  }
  if (isRecoveryRequiredError(error)) {
    return new WorkspaceManagementError(
      'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
      operationKind,
    );
  }
  return new WorkspaceManagementError(
    failureCodeByOperation[operationKind],
    operationKind,
  );
}

const failureCodeByOperation = {
  status: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
  create: 'WORKSPACE_MANAGEMENT_CREATE_FAILED',
  import: 'WORKSPACE_MANAGEMENT_IMPORT_FAILED',
  replace: 'WORKSPACE_MANAGEMENT_REPLACE_FAILED',
  switch: 'WORKSPACE_MANAGEMENT_SWITCH_FAILED',
  rename: 'WORKSPACE_MANAGEMENT_RENAME_FAILED',
} as const satisfies Record<
  WorkspaceManagementOperationKind,
  WorkspaceManagementErrorCode
>;

function isCoordinatorBusyError(error: unknown): boolean {
  return (
    (error instanceof EmptyWorkspaceCreationError &&
      error.code === 'WORKSPACE_CREATION_BUSY') ||
    (error instanceof WorkspaceBackupImportError &&
      error.code === 'WORKSPACE_IMPORT_BUSY') ||
    (error instanceof WorkspaceBackupReplacementError &&
      error.code === 'WORKSPACE_REPLACEMENT_BUSY') ||
    (error instanceof WorkspaceSwitchError &&
      error.code === 'WORKSPACE_SWITCH_BUSY')
  );
}

function isInvalidError(error: unknown): boolean {
  return (
    error instanceof WorkspaceRegistryValidationError ||
    (error instanceof WorkspaceRegistryMutationError &&
      error.failure === 'workspaceNotFound') ||
    (error instanceof EmptyWorkspaceCreationError &&
      error.code === 'WORKSPACE_CREATION_INVALID') ||
    (error instanceof WorkspaceBackupImportError &&
      error.code === 'WORKSPACE_IMPORT_INVALID') ||
    (error instanceof WorkspaceBackupReplacementError &&
      (error.code === 'WORKSPACE_REPLACEMENT_INVALID' ||
        error.code === 'WORKSPACE_REPLACEMENT_TARGET_INELIGIBLE' ||
        error.code === 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH')) ||
    (error instanceof WorkspaceSwitchError &&
      error.code === 'WORKSPACE_SWITCH_INVALID')
  );
}

function isRecoveryRequiredError(error: unknown): boolean {
  return (
    (error instanceof EmptyWorkspaceCreationError &&
      error.code === 'WORKSPACE_CREATION_RECOVERY_REQUIRED') ||
    (error instanceof WorkspaceBackupImportError &&
      error.code === 'WORKSPACE_IMPORT_RECOVERY_REQUIRED') ||
    (error instanceof WorkspaceBackupReplacementError &&
      (error.code === 'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED' ||
        error.code === 'WORKSPACE_REPLACEMENT_OPERATION_UNRESOLVED')) ||
    error instanceof WorkspaceManagementRecoveryRequiredError ||
    (error instanceof WorkspaceSwitchError &&
      error.code === 'WORKSPACE_SWITCH_RECOVERY_REQUIRED')
  );
}
