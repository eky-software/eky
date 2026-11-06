import type { WorkspaceDeletionContinuationAuthority } from '../management/workspaceManagementService.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureWorkspaceDeletionJournal, parseWorkspaceDeletionJournalBytes, sameWorkspaceDeletionJournalBinding,
  type WorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { planWorkspaceDeletionJournalSlots } from './workspaceDeletionJournalSlots.js';
import type { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionRegistryState } from './workspaceDeletionRegistryState.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

// Pins one observed phase. Inventory membership and payload/cleanup preconditions remain the executor's job.
export async function captureWorkspaceDeletionPhaseSelection(input: {
  operationId: string;
  authority: WorkspaceDeletionContinuationAuthority;
  journal: Pick<WorkspaceDeletionJournalStore, 'inspect'>;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertWritersAbsent(): Promise<void>;
  readonly expectedBinding?: WorkspaceDeletionJournal;
}) {
  const operationId = validateWorkspaceBackupReplacementOperationId(input.operationId);
  const expectedBinding = input.expectedBinding === undefined ? undefined : captureWorkspaceDeletionJournal(input.expectedBinding);
  const check = checkedDeletionAuthority(input.authority.assertCurrent.bind(input.authority), invalidCode);
  const owned = input.authority.assertOwned.bind(input.authority);
  const writers = input.assertWritersAbsent.bind(input);
  const readJournal = input.journal.inspect.bind(input.journal);
  const readRegistry = input.registry.inspectSlots.bind(input.registry);
  let active = true, failed = false;
  let firstFailure: unknown;
  const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
  const assertCurrent = () => {
    if (failed) throw firstFailure;
    try { if (!active) return invalidDeletionData(invalidCode); check(); }
    catch (error) { throw retain(error); }
  };
  const checked = async (work: () => Promise<void>) => {
    try { assertCurrent(); await work(); assertCurrent(); }
    catch (error) { throw retain(error); }
  };
  const assertOwner = async () => {
    await checked(owned);
    await checked(writers);
    await checked(owned);
  };
  try {
    await assertOwner();
    const journalSlots = copySlots((await readJournal(assertCurrent)).slots, parseWorkspaceDeletionJournalBytes);
    assertCurrent();
    const plan = planWorkspaceDeletionJournalSlots(journalSlots);
    if (plan.mode !== 'published' || plan.selected.target.operationId !== operationId ||
        (expectedBinding !== undefined && !sameWorkspaceDeletionJournalBinding(plan.selected, expectedBinding))) return invalidDeletionData(invalidCode);
    const registrySlots = copySlots(await readRegistry(assertCurrent), parseWorkspaceRegistryBytes);
    assertCurrent();
    const registryState = captureWorkspaceDeletionRegistryState(plan.selected, registrySlots);
    const assertExternalSelection = () => checked(async () => {
      await assertOwner();
      assertSameSlots(registrySlots, await readRegistry(assertCurrent));
      assertCurrent();
      await assertOwner();
    });
    const assertJournalSelected = () => checked(async () => {
      await assertOwner();
      assertSameSlots(journalSlots, (await readJournal(assertCurrent)).slots);
      assertCurrent();
      await assertOwner();
    });
    const assertJournalReadOwned = () => checked(async () => {
      await assertOwner();
      await assertOwner();
    });
    const assertSelected = () => checked(async () => {
      await assertExternalSelection();
      assertSameSlots(journalSlots, (await readJournal(assertCurrent)).slots);
      assertCurrent();
      await assertExternalSelection();
    });
    await assertSelected();
    return Object.freeze({
      journal: plan.selected,
      registryState: registryState.state,
      registryNeedsRecovery: registryState.needsRecovery,
      afterRegistry: registryState.after,
      // Separate copies: mutating the values passed to a byte store cannot change the pinned observations.
      journalSlots: copySlots(journalSlots, parseWorkspaceDeletionJournalBytes),
      registrySlots: copySlots(registrySlots, parseWorkspaceRegistryBytes),
      assertCurrent, assertSelected, assertExternalSelection, assertJournalSelected, assertJournalReadOwned,
      revoke() { active = false; },
    });
  } catch (error) { active = false; throw retain(error); }
}

function copySlots<T>(slots: ReadOnlyJournalSlots<T>, parse: (bytes: Uint8Array) => Readonly<T>): ReadOnlyJournalSlots<T> {
  const captured: Record<'current' | 'backup' | 'next', ReadOnlyJournalSlots<T>['current']> = {
    current: undefined, backup: undefined, next: undefined,
  };
  for (const name of ['current', 'backup', 'next'] as const) {
    const slot = slots[name];
    if (slot === undefined) continue;
    if (slot.identity === undefined) return invalidDeletionData(invalidCode);
    const bytes = Uint8Array.from(slot.bytes);
    captured[name] = Object.freeze({ bytes, value: parse(bytes), identity: Object.freeze({ ...slot.identity }) });
  }
  return Object.freeze(captured);
}

function assertSameSlots<T>(expected: ReadOnlyJournalSlots<T>, actual: ReadOnlyJournalSlots<T>): void {
  for (const name of ['current', 'backup', 'next'] as const) {
    const before = expected[name], after = actual[name];
    if (before === undefined) { if (after !== undefined) return invalidDeletionData(invalidCode); }
    else if (after === undefined || before.identity === undefined || after.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(before.identity, after.identity) || !Buffer.from(before.bytes).equals(Buffer.from(after.bytes))) {
      return invalidDeletionData(invalidCode);
    }
  }
}
