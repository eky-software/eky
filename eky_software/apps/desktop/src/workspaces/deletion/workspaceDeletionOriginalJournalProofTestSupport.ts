import { deletionTestDigest as hash, deletionTestId as id, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionJournal, captureWorkspaceDeletionOriginalJournalProof,
  type WorkspaceDeletionJournal, type WorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';

// Controlled commitment fields for codec/storage tests, not proof of a live original-owner selection.
export function deletionTestOriginalJournalProof(owner: WorkspaceDeletionOriginalJournalProof['owner'] = 'workspaceImport') {
  const target = deletionTestJournal().target;
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner, operationId: id(201),
    workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
  return captureWorkspaceDeletionOriginalJournalProof(target, { owner, operationId: binding.operationId,
    bindingSha256: workspaceRemnantBindingSha256(binding), slots: {
      current: { sha256: hash('controlled original journal bytes'), identity: { dev: 1, ino: 2, size: 80, mtimeMs: 3, ctimeMs: 4 } },
      next: null, backup: null,
    } });
}

export function deletionTestJournalV2(phase: WorkspaceDeletionJournal['phase'] = 'authorized',
  proofs: readonly WorkspaceDeletionOriginalJournalProof[] = [deletionTestOriginalJournalProof()]) {
  const journal = captureWorkspaceDeletionJournal({ ...deletionTestJournal(phase), formatVersion: 2, originalJournalProofs: proofs });
  if (journal.formatVersion !== 2) throw new Error('SYNTHETIC_DELETION_VERSION_INVALID');
  return journal;
}
