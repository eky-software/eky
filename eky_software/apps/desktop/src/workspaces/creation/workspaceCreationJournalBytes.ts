import {
  WorkspaceCreationJournalValidationError,
  workspaceCreationJournalInvalid,
} from './workspaceCreationJournalError.js';
import { assertNoDuplicateWorkspaceCreationJournalKeys } from './workspaceCreationJournalDuplicateKeys.js';
import type { WorkspaceCreationJournalV1 } from './workspaceCreationTypes.js';
import { validateWorkspaceCreationJournal } from './workspaceCreationJournalValidation.js';

export const WORKSPACE_CREATION_JOURNAL_MAX_BYTES = 16 * 1024;

export function parseWorkspaceCreationJournalBytes(
  bytes: Uint8Array,
): Readonly<WorkspaceCreationJournalV1> {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > WORKSPACE_CREATION_JOURNAL_MAX_BYTES
    ) {
      return workspaceCreationJournalInvalid();
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceCreationJournalKeys(source);
    const value: unknown = JSON.parse(source);
    return validateWorkspaceCreationJournal(value);
  } catch (error) {
    if (error instanceof WorkspaceCreationJournalValidationError) throw error;
    return workspaceCreationJournalInvalid();
  }
}
