import {
  WORKSPACE_CREATION_JOURNAL_MAX_BYTES,
  parseWorkspaceCreationJournalBytes,
} from './workspaceCreationJournalBytes.js';
import {
  workspaceCreationJournalInvalid,
} from './workspaceCreationJournalError.js';
import type { WorkspaceCreationJournalV1 } from './workspaceCreationTypes.js';
import { validateWorkspaceCreationJournal } from './workspaceCreationJournalValidation.js';

export function serializeWorkspaceCreationJournal(
  value: unknown,
): Uint8Array {
  const journal = validateWorkspaceCreationJournal(value);
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
  if (bytes.byteLength > WORKSPACE_CREATION_JOURNAL_MAX_BYTES) {
    return workspaceCreationJournalInvalid();
  }
  return bytes;
}

export function assertCanonicalWorkspaceCreationJournalRoundTrip(
  bytes: Uint8Array,
): Readonly<WorkspaceCreationJournalV1> {
  const parsed = parseWorkspaceCreationJournalBytes(bytes);
  const serialized = serializeWorkspaceCreationJournal(parsed);
  if (
    bytes.byteLength !== serialized.byteLength ||
    !bytes.every((value, index) => value === serialized[index])
  ) {
    return workspaceCreationJournalInvalid();
  }
  return parsed;
}
