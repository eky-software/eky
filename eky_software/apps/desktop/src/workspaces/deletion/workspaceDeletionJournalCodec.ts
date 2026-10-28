import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { deletionDataRecord, deletionDigest, invalidDeletionData, parseDeletionJson } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryCommitment, captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';

export const maximumWorkspaceDeletionJournalBytes = 16 * 1_024;
export const workspaceDeletionPhases = Object.freeze([
  'authorized', 'quarantined', 'purgeAuthorized', 'purged', 'registryPublished',
] as const);
const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

export function captureWorkspaceDeletionJournal(value: unknown) {
  try {
    deletionDataRecord(value, ['formatVersion', 'target', 'phase', 'registryBeforeSha256', 'registryAfterSha256',
      'previousActiveWorkspaceId', 'backupDisposition', 'inventory', 'inventoryFileIdentity',
      'operationRootIdentity', 'operationParentIdentity'], invalidCode);
    if (value.formatVersion !== 1 || !workspaceDeletionPhases.some(phase => phase === value.phase) ||
        (value.backupDisposition !== 'verifiedBackup' && value.backupDisposition !== 'explicitDataLoss')) {
      return invalidDeletionData(invalidCode);
    }
    const registryBeforeSha256 = deletionDigest(value.registryBeforeSha256, invalidCode);
    const registryAfterSha256 = deletionDigest(value.registryAfterSha256, invalidCode);
    if (registryBeforeSha256 === registryAfterSha256) return invalidDeletionData(invalidCode);
    return Object.freeze({
      formatVersion: 1 as const, target: captureDeletionInventoryHeader(value.target),
      phase: value.phase as (typeof workspaceDeletionPhases)[number], registryBeforeSha256, registryAfterSha256,
      previousActiveWorkspaceId: value.previousActiveWorkspaceId === null ? null : validateWorkspaceId(value.previousActiveWorkspaceId),
      backupDisposition: value.backupDisposition,
      inventory: captureDeletionInventoryCommitment(value.inventory),
      inventoryFileIdentity: deletionDigest(value.inventoryFileIdentity, invalidCode),
      operationRootIdentity: deletionDigest(value.operationRootIdentity, invalidCode),
      operationParentIdentity: deletionDigest(value.operationParentIdentity, invalidCode),
    });
  } catch { return invalidDeletionData(invalidCode); }
}
export type WorkspaceDeletionJournalV1 = ReturnType<typeof captureWorkspaceDeletionJournal>;

export function serializeWorkspaceDeletionJournal(value: WorkspaceDeletionJournalV1): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(captureWorkspaceDeletionJournal(value))}\n`);
  if (bytes.byteLength > maximumWorkspaceDeletionJournalBytes) return invalidDeletionData(invalidCode);
  return bytes;
}

export function parseWorkspaceDeletionJournalBytes(bytes: Uint8Array): WorkspaceDeletionJournalV1 {
  return captureWorkspaceDeletionJournal(parseDeletionJson(bytes, maximumWorkspaceDeletionJournalBytes, invalidCode));
}

export function sameWorkspaceDeletionJournalBinding(left: WorkspaceDeletionJournalV1, right: WorkspaceDeletionJournalV1): boolean {
  const { phase: _left, ...before } = captureWorkspaceDeletionJournal(left);
  const { phase: _right, ...after } = captureWorkspaceDeletionJournal(right);
  return JSON.stringify(before) === JSON.stringify(after);
}
