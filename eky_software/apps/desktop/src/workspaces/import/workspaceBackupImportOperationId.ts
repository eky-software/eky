import { randomUUID } from 'node:crypto';

import {
  workspaceBackupImportJournalInvalid,
} from './workspaceBackupImportJournalError.js';
import type { WorkspaceBackupImportOperationId } from './workspaceBackupImportTypes.js';

const canonicalOperationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function generateWorkspaceBackupImportOperationId(): WorkspaceBackupImportOperationId {
  return validateWorkspaceBackupImportOperationId(randomUUID());
}

export function validateWorkspaceBackupImportOperationId(
  value: unknown,
): WorkspaceBackupImportOperationId {
  if (
    typeof value !== 'string' ||
    !canonicalOperationIdPattern.test(value)
  ) {
    return workspaceBackupImportJournalInvalid();
  }
  return value as WorkspaceBackupImportOperationId;
}
