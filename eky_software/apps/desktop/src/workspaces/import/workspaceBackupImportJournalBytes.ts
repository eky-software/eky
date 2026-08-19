import { assertNoDuplicateWorkspaceBackupImportJournalKeys } from './workspaceBackupImportJournalDuplicateKeys.js';
import {
  WorkspaceBackupImportJournalValidationError,
  workspaceBackupImportJournalInvalid,
} from './workspaceBackupImportJournalError.js';
import type { WorkspaceBackupImportJournalV1 } from './workspaceBackupImportTypes.js';
import { validateWorkspaceBackupImportJournal } from './workspaceBackupImportJournalValidation.js';

export const WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES = 16 * 1024;

export function parseWorkspaceBackupImportJournalBytes(
  bytes: Uint8Array,
): Readonly<WorkspaceBackupImportJournalV1> {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES
    ) {
      return workspaceBackupImportJournalInvalid();
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceBackupImportJournalKeys(source);
    const value: unknown = JSON.parse(source);
    return validateWorkspaceBackupImportJournal(value);
  } catch (error) {
    if (error instanceof WorkspaceBackupImportJournalValidationError) {
      throw error;
    }
    return workspaceBackupImportJournalInvalid();
  }
}
