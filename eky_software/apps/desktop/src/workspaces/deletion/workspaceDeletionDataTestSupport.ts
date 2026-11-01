import { createHash } from 'node:crypto';
import { captureDeletionInventoryHeader, captureDeletionInventoryRecord, deletionInventoryFormatVersion } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionJournal, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';

export const deletionTestDigest = (value: string) => createHash('sha256').update(value).digest('hex');
export const deletionTestId = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
export const deletionTestHeader = captureDeletionInventoryHeader({ formatVersion: deletionInventoryFormatVersion,
  operationId: deletionTestId(1), workspaceId: deletionTestId(2),
  lineageIdentity: { formatVersion: 1, profileId: deletionTestDigest('lineage') },
  registryEntrySha256: deletionTestDigest('registry-entry') });

export function deletionTestRecord(value = 1) {
  return captureDeletionInventoryRecord({ role: 'activationFailed', ownerOperationId: deletionTestId(value),
    generationId: null, member: null, rootIdentity: deletionTestDigest(`root-${value}`),
    parentIdentity: deletionTestDigest('parent'), bindingSha256: deletionTestDigest(`binding-${value}`) });
}

export function deletionTestJournal(phase: WorkspaceDeletionJournalV1['phase'] = 'authorized') {
  return captureWorkspaceDeletionJournal({ formatVersion: 1, target: deletionTestHeader, phase,
    registryBeforeSha256: deletionTestDigest('before'), registryAfterSha256: deletionTestDigest('after'),
    previousActiveWorkspaceId: deletionTestHeader.workspaceId, backupDisposition: 'explicitDataLoss',
    inventory: { formatVersion: deletionInventoryFormatVersion, byteLength: 500, recordCount: 1, sha256: deletionTestDigest('inventory') },
    inventoryFileIdentity: deletionTestDigest('file'), operationRootIdentity: deletionTestDigest('operation-root'),
    operationParentIdentity: deletionTestDigest('operation-parent') });
}

export async function* deletionTestChunks(bytes: Uint8Array, size = 17) {
  for (let offset = 0; offset < bytes.byteLength; offset += size) yield bytes.subarray(offset, offset + size);
}

export async function* deletionTestRecords(count = 2) {
  for (let index = 1; index <= count; index++) yield deletionTestRecord(index);
}
