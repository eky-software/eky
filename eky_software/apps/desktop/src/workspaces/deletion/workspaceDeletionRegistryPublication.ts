import type { WorkspaceDeletionContinuationAuthority } from '../management/workspaceManagementService.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { selectWorkspaceDeletionPayload } from './workspaceDeletionPayloadSelection.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { workspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';
import { captureWorkspaceDeletionRegistryState } from './workspaceDeletionRegistryState.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

// Registry stage only: the purged journal and inventory remain for owner cleanup and terminal publication.
export function createWorkspaceDeletionRegistryPublisher(input: {
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots' | 'writeSelected' | 'recoverSelected'>;
  assertWritersAbsent(): Promise<void>;
}) {
  const root = input.userDataRoot;
  const readRegistry = input.registry.inspectSlots.bind(input.registry);
  const writeRegistry = input.registry.writeSelected.bind(input.registry);
  const recoverRegistry = input.registry.recoverSelected.bind(input.registry);
  const writers = input.assertWritersAbsent.bind(input);
  let running = false;
  return async (operationId: string, authority: WorkspaceDeletionContinuationAuthority) => {
    if (running) return invalidDeletionData(invalidCode);
    running = true;
    try {
      const phase = await captureWorkspaceDeletionPhaseSelection({ operationId, authority,
        journal: new WorkspaceDeletionJournalStore(root), registry: { inspectSlots: readRegistry }, assertWritersAbsent: writers });
      let failed = false;
      let firstFailure: unknown;
      const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
      const assertCurrent = () => {
        if (failed) throw firstFailure;
        try { phase.assertCurrent(); } catch (error) { throw retain(error); }
      };
      try {
        const journal = phase.journal;
        if (journal.phase !== 'purged' || phase.journalSlots.current === undefined ||
            phase.journalSlots.next !== undefined || phase.journalSlots.backup !== undefined) return invalidDeletionData(invalidCode);
        const inventory = { target: journal.target, inventory: journal.inventory, inventoryFileIdentity: journal.inventoryFileIdentity,
          operationRootIdentity: journal.operationRootIdentity, operationParentIdentity: journal.operationParentIdentity };
        const inventoryStore = new WorkspaceDeletionInventoryStore(root, journal.target.operationId);
        const assertAbsent = async () => {
          try {
            assertCurrent();
            await phase.assertJournalSelected();
            let workspaces = 0;
            await inventoryStore.consumeSelectedRecords(inventory, {
              assertAuthority: assertCurrent, assertExternalSelection: phase.assertJournalSelected,
            }, async row => {
              if (row.role === 'inspectionEvidence') return;
              if (row.role === 'workspace') workspaces++;
              const selected = await selectWorkspaceDeletionPayload(root, journal, captureDeletionInventoryPayloadRecord(row),
                workspaceDeletionQuarantineFileSystem, assertCurrent, true);
              if (selected.state !== 'absent') return invalidDeletionData(invalidCode);
              await phase.assertJournalSelected();
            });
            if (workspaces !== 1) return invalidDeletionData(invalidCode);
            await phase.assertJournalSelected();
            assertCurrent();
          } catch (error) { throw retain(error); }
        };
        const mutation = (slots: ReadOnlyJournalSlots<LocalWorkspaceRegistry>): Parameters<WorkspaceRegistryStore['writeSelected']>[1] => ({
          expectedSlots: { current: slots.current?.bytes, backup: slots.backup?.bytes, next: slots.next?.bytes },
          expectedIdentities: { current: slots.current?.identity, backup: slots.backup?.identity, next: slots.next?.identity },
          assertAuthority: assertCurrent, assertExternalSelection: assertAbsent,
          onUncertain(error) { retain(error); },
        });
        const readReceipt = async (identity: Readonly<CrashSafeFileSlotIdentity>, expectedState: 'before' | 'after') => {
          await assertAbsent();
          const observed = captureWorkspaceDeletionRegistryState(journal, await readRegistry(phase.assertCurrent));
          phase.assertCurrent();
          if (observed.needsRecovery || observed.state !== expectedState || observed.slots.current?.identity === undefined ||
              !sameCrashSafeFileSlotIdentity(observed.slots.current.identity, identity)) return invalidDeletionData(invalidCode);
          await assertAbsent();
          assertSameSlots(observed.slots, await readRegistry(phase.assertCurrent));
          await phase.assertJournalSelected();
          return observed;
        };
        await phase.assertSelected();
        await assertAbsent();
        let selected = captureWorkspaceDeletionRegistryState(journal, phase.registrySlots);
        if (selected.needsRecovery) {
          const identity = await recoverRegistry(mutation(selected.slots));
          selected = await readReceipt(identity, selected.state);
        }
        if (selected.state === 'before') {
          const identity = await writeRegistry(selected.after, mutation(selected.slots));
          selected = await readReceipt(identity, 'after');
        } else {
          await assertAbsent();
          assertSameSlots(selected.slots, await readRegistry(phase.assertCurrent));
          await phase.assertJournalSelected();
        }
        if (selected.state !== 'after') return invalidDeletionData(invalidCode);
        phase.assertCurrent();
        return Object.freeze({ journal, registryState: 'after' as const });
      } catch (error) {
        // A registry store may generalize a guard failure; retain the phase owner's original cause.
        assertCurrent();
        throw error;
      } finally { phase.revoke(); }
    } finally { running = false; }
  };
}

function assertSameSlots(expected: ReadOnlyJournalSlots<LocalWorkspaceRegistry>, actual: ReadOnlyJournalSlots<LocalWorkspaceRegistry>): void {
  for (const slot of ['current', 'backup', 'next'] as const) {
    const before = expected[slot], after = actual[slot];
    if (before === undefined) { if (after !== undefined) return invalidDeletionData(invalidCode); }
    else if (after === undefined || before.identity === undefined || after.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(before.identity, after.identity) || !Buffer.from(before.bytes).equals(Buffer.from(after.bytes))) {
      return invalidDeletionData(invalidCode);
    }
  }
}
