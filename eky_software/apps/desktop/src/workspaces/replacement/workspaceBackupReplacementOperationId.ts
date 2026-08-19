import { randomUUID } from 'node:crypto';

import { WorkspaceBackupReplacementError } from './workspaceBackupReplacementError.js';

declare const workspaceBackupReplacementOperationIdBrand: unique symbol;

export type WorkspaceBackupReplacementOperationId = string & {
  readonly [workspaceBackupReplacementOperationIdBrand]:
    'WorkspaceBackupReplacementOperationId';
};

const canonicalOperationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function generateWorkspaceBackupReplacementOperationId(): WorkspaceBackupReplacementOperationId {
  return validateWorkspaceBackupReplacementOperationId(randomUUID());
}

export function validateWorkspaceBackupReplacementOperationId(
  value: unknown,
): WorkspaceBackupReplacementOperationId {
  if (
    typeof value !== 'string' ||
    !canonicalOperationIdPattern.test(value)
  ) {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_INVALID',
      'inputValidation',
    );
  }
  return value as WorkspaceBackupReplacementOperationId;
}
