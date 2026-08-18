import { randomUUID } from 'node:crypto';

import {
  workspaceCreationJournalInvalid,
} from './workspaceCreationJournalError.js';
import type { WorkspaceCreationOperationId } from './workspaceCreationTypes.js';

const canonicalOperationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function generateWorkspaceCreationOperationId(): WorkspaceCreationOperationId {
  return validateWorkspaceCreationOperationId(randomUUID());
}

export function validateWorkspaceCreationOperationId(
  value: unknown,
): WorkspaceCreationOperationId {
  if (
    typeof value !== 'string' ||
    !canonicalOperationIdPattern.test(value)
  ) {
    return workspaceCreationJournalInvalid();
  }
  return value as WorkspaceCreationOperationId;
}
