import { createHash } from 'node:crypto';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// Observation only. Slot recovery and registry publication still require payload absence and fresh authority.
export function captureWorkspaceDeletionRegistryState(
  journalValue: unknown, slots: ReadOnlyJournalSlots<LocalWorkspaceRegistry>,
) {
  const journal = captureWorkspaceDeletionJournal(journalValue);
  const read = (name: 'current' | 'backup' | 'next') => {
    const slot = slots[name];
    if (slot === undefined) return undefined;
    if (slot.identity === undefined) return invalidDeletionData(invalidCode);
    const bytes = Uint8Array.from(slot.bytes);
    const value = parseWorkspaceRegistryBytes(bytes);
    if (value.formatVersion !== 2) return invalidDeletionData(invalidCode);
    const sha256 = digest(bytes);
    if (sha256 !== journal.registryBeforeSha256 && sha256 !== journal.registryAfterSha256) return invalidDeletionData(invalidCode);
    return Object.freeze({ bytes, value, identity: Object.freeze({ ...slot.identity }),
      state: sha256 === journal.registryBeforeSha256 ? 'before' as const : 'after' as const });
  };
  const current = read('current'), backup = read('backup'), next = read('next');
  const captured = Object.freeze({ current, backup, next });
  if ((current === undefined && backup === undefined) ||
      (current !== undefined && backup !== undefined && next !== undefined)) return invalidDeletionData(invalidCode);

  if (journal.phase === 'registryPublished') {
    if (current?.state !== 'after' || backup !== undefined || next !== undefined) return invalidDeletionData(invalidCode);
  } else if (journal.phase !== 'purged') {
    if (current?.state !== 'before' || backup !== undefined || next !== undefined) return invalidDeletionData(invalidCode);
  } else {
    // These are exactly the states of one before -> after replaceSelected, never a newer unrelated write.
    if (backup !== undefined && backup.state !== 'before') return invalidDeletionData(invalidCode);
    if (next !== undefined && (next.state !== 'after' || current?.state === 'after')) return invalidDeletionData(invalidCode);
    if (current?.state === 'before' && backup !== undefined) return invalidDeletionData(invalidCode);
  }
  const selected = current ?? backup!;
  const before = current?.state === 'before' ? current : backup;
  let after = current?.state === 'after' ? current.value : next?.value;
  if (before !== undefined) {
    const entry = before.value.workspaces.find(value => value.workspaceId === journal.target.workspaceId);
    if (entry === undefined || entry.lineageIdentity.profileId !== journal.target.lineageIdentity.profileId ||
        workspaceRegistryEntrySha256(entry) !== journal.target.registryEntrySha256) return invalidDeletionData(invalidCode);
    const derived = removeWorkspaceEntry({ registry: before.value, expectedActiveWorkspaceId: journal.previousActiveWorkspaceId,
      targetWorkspaceId: journal.target.workspaceId });
    if (derived.formatVersion !== 2 || digest(serializeWorkspaceRegistry(derived)) !== journal.registryAfterSha256) {
      return invalidDeletionData(invalidCode);
    }
    after = derived;
  }
  if (after === undefined || after.workspaces.some(entry => entry.workspaceId === journal.target.workspaceId) ||
      after.activeWorkspaceId !== (journal.previousActiveWorkspaceId === journal.target.workspaceId ? null : journal.previousActiveWorkspaceId)) {
    return invalidDeletionData(invalidCode);
  }
  return Object.freeze({ slots: captured, state: selected.state, after,
    needsRecovery: current === undefined || backup !== undefined || next !== undefined });
}
