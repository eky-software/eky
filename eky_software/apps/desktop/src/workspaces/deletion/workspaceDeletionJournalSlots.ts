import type { CrashSafeFileSlot, CrashSafeFileSlotFileSystem, CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import {
  captureWorkspaceDeletionJournal, parseWorkspaceDeletionJournalBytes, sameWorkspaceDeletionJournalBinding,
  workspaceDeletionPhases, type WorkspaceDeletionJournal,
} from './workspaceDeletionJournalCodec.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

export function planWorkspaceDeletionJournalSlots(slots: ReadOnlyJournalSlots<WorkspaceDeletionJournal>) {
  const current = slots.current === undefined ? undefined : captureWorkspaceDeletionJournal(slots.current.value);
  const backup = slots.backup === undefined ? undefined : captureWorkspaceDeletionJournal(slots.backup.value);
  const next = slots.next === undefined ? undefined : captureWorkspaceDeletionJournal(slots.next.value);
  const all = [current, backup, next].filter(value => value !== undefined);
  if (all.length === 0) return Object.freeze({ mode: 'absent' as const });
  if (all.length === 3 || all.some(value => !sameWorkspaceDeletionJournalBinding(value, all[0]!))) {
    return invalidDeletionData(invalidCode);
  }
  const selected = current ?? backup;
  if (selected === undefined) {
    if (next?.phase !== 'authorized') return invalidDeletionData(invalidCode);
    return Object.freeze({ mode: 'unpublished' as const });
  }
  const rank = (value: WorkspaceDeletionJournal) => workspaceDeletionPhases.indexOf(value.phase);
  if ((backup !== undefined && current !== undefined && rank(current) !== rank(backup) + 1) ||
      (next !== undefined && rank(next) !== rank(selected) + 1)) return invalidDeletionData(invalidCode);
  return Object.freeze({ mode: 'published' as const, selected,
    terminalOnly: current?.phase === 'registryPublished' && all.length === 1 });
}

// Observation does not repair slots, establish a filesystem snapshot, or grant mutation authority.
export async function inspectWorkspaceDeletionJournal(
  fileSystem: CrashSafeFileSlotFileSystem, assertCurrent: () => void,
) {
  const slots: Record<CrashSafeFileSlot, ReadOnlyJournalSlots<WorkspaceDeletionJournal>['current']> = {
    current: undefined, next: undefined, backup: undefined,
  };
  for (const slot of ['current', 'backup', 'next'] as const) {
    assertCurrent();
    let identity: CrashSafeFileSlotIdentity | undefined;
    const bytes = await fileSystem.readSlot(slot, value => { identity = value; });
    assertCurrent();
    if (bytes !== undefined) slots[slot] = Object.freeze({ bytes: Uint8Array.from(bytes),
      value: parseWorkspaceDeletionJournalBytes(bytes), ...(identity === undefined ? {} : { identity: Object.freeze({ ...identity }) }) });
  }
  assertCurrent();
  const observed = Object.freeze(slots);
  return Object.freeze({ slots: observed, plan: planWorkspaceDeletionJournalSlots(observed) });
}
