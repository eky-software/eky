import {
  WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES,
  parseWorkspaceBackupImportJournalBytes,
} from './workspaceBackupImportJournalBytes.js';
import {
  workspaceBackupImportJournalInvalid,
} from './workspaceBackupImportJournalError.js';
import type { WorkspaceBackupImportJournalV1 } from './workspaceBackupImportTypes.js';
import { validateWorkspaceBackupImportJournal } from './workspaceBackupImportJournalValidation.js';

export function serializeWorkspaceBackupImportJournal(
  value: unknown,
): Uint8Array {
  const journal = validateWorkspaceBackupImportJournal(value);
  const canonical = {
    formatVersion: 1,
    operationId: journal.operationId,
    workspaceId: journal.workspaceId,
    workspaceLabel: journal.workspaceLabel,
    previousActiveWorkspaceId: journal.previousActiveWorkspaceId,
    state: journal.state,
    createdAt: journal.createdAt,
    lineageIdentity: journal.lineageIdentity === null
      ? null
      : {
          formatVersion: 1,
          profileId: journal.lineageIdentity.profileId,
        },
  } as const;
  const bytes = new TextEncoder().encode(`${JSON.stringify(canonical)}\n`);
  if (bytes.byteLength > WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES) {
    return workspaceBackupImportJournalInvalid();
  }
  return bytes;
}

export function assertCanonicalWorkspaceBackupImportJournalRoundTrip(
  bytes: Uint8Array,
): Readonly<WorkspaceBackupImportJournalV1> {
  const parsed = parseWorkspaceBackupImportJournalBytes(bytes);
  const serialized = serializeWorkspaceBackupImportJournal(parsed);
  if (
    bytes.byteLength !== serialized.byteLength ||
    !bytes.every((value, index) => value === serialized[index])
  ) {
    return workspaceBackupImportJournalInvalid();
  }
  return parsed;
}
