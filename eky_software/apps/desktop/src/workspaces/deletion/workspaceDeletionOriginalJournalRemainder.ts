import { createHash } from 'node:crypto';
import { captureProfileRestoreActivationDeletionSlots } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { captureWorkspaceLegacyAdoptionDeletionSlots } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { captureWorkspaceBackupImportDeletionSlots } from '../import/workspaceBackupImportJournalStore.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

// Comparison only. The caller must prove purged/after-registry, owner and payload absence before retirement.
export function captureWorkspaceDeletionOriginalJournalRemainder(
  targetValue: unknown, proofValue: unknown, bindingValue: unknown,
  slots: ReadOnlyJournalSlots<unknown>, mode: 'selected' | 'purged',
) {
  if (mode !== 'selected' && mode !== 'purged') return invalidDeletionData(invalidCode);
  const target = captureDeletionInventoryHeader(targetValue);
  const proof = captureWorkspaceDeletionOriginalJournalProof(target, proofValue);
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: proof.owner, operationId: proof.operationId,
    workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
  if (bindingValue === undefined) {
    if (mode !== 'purged' || Object.values(slots).some(slot => slot !== undefined)) return invalidDeletionData(invalidCode);
  } else if (workspaceRemnantBindingSha256(captureWorkspaceRemnantBinding(bindingValue)) !== proof.bindingSha256) {
    return invalidDeletionData(invalidCode);
  }
  const selection = {
    expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
    expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity },
  };
  if (binding.owner === 'workspaceImport') captureWorkspaceBackupImportDeletionSlots(binding, selection);
  else if (binding.owner === 'workspaceLegacyAdoption') captureWorkspaceLegacyAdoptionDeletionSlots(binding, selection);
  else captureProfileRestoreActivationDeletionSlots(binding, selection);

  let survivor = false;
  for (const name of ['next', 'backup', 'current'] as const) {
    const expected = proof.slots[name], actual = slots[name];
    if (expected === null) {
      if (actual !== undefined) return invalidDeletionData(invalidCode);
      continue;
    }
    if (actual === undefined) {
      if (mode !== 'purged' || survivor) return invalidDeletionData(invalidCode);
      continue;
    }
    survivor = true;
    if (actual.identity === undefined || !sameCrashSafeFileSlotIdentity(actual.identity, expected.identity) ||
        createHash('sha256').update(actual.bytes).digest('hex') !== expected.sha256) return invalidDeletionData(invalidCode);
  }
  return Object.freeze({ binding, proof });
}
