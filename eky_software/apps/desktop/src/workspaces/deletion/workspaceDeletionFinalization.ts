import type { WorkspaceDeletionContinuationAuthority } from '../management/workspaceManagementService.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { assertWorkspaceDeletionInventoryRetired, retireWorkspaceDeletionInventory } from './workspaceDeletionInventoryRetirement.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { assertWorkspaceDeletionMetadataAbsent } from './workspaceDeletionMetadataCleanup.js';
import { selectWorkspaceDeletionPayload } from './workspaceDeletionPayloadSelection.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { workspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

// Publishes durable completion, retires the inventory, and clears the journal last. No payload deletion.
export function createWorkspaceDeletionFinalizer(input: {
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertWritersAbsent(): Promise<void>;
}) {
  const root = input.userDataRoot, registry = { inspectSlots: input.registry.inspectSlots.bind(input.registry) };
  const writers = input.assertWritersAbsent.bind(input);
  let running = false;
  return async (operationId: string, authority: WorkspaceDeletionContinuationAuthority): Promise<WorkspaceDeletionJournalV1> => {
    if (running) return invalidDeletionData(invalidCode);
    const current = checkedDeletionAuthority(authority.assertCurrent.bind(authority), invalidCode), owned = authority.assertOwned.bind(authority);
    running = true;
    let active = true, failed = false;
    let firstFailure: unknown;
    const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
    const assertCurrent = () => {
      if (failed) throw firstFailure;
      try { if (!active) return invalidDeletionData(invalidCode); current(); }
      catch (error) { throw retain(error); }
    };
    try {
      const owner = { assertCurrent, async assertOwned() { assertCurrent(); await owned(); assertCurrent(); } };
      const store = new WorkspaceDeletionJournalStore(root);
      let expected: Readonly<{ journal: WorkspaceDeletionJournalV1; identity: Readonly<CrashSafeFileSlotIdentity> }> | undefined;
      while (true) {
        const phase = await captureWorkspaceDeletionPhaseSelection({ operationId, authority: owner,
          journal: store, registry, assertWritersAbsent: writers });
        try {
          const journal = phase.journal;
          if ((journal.phase !== 'purged' && journal.phase !== 'registryPublished') ||
              phase.registryState !== 'after' || phase.registryNeedsRecovery) return invalidDeletionData(invalidCode);
          if (expected !== undefined && (!serializeWorkspaceDeletionJournal(journal).equals(serializeWorkspaceDeletionJournal(expected.journal)) ||
              phase.journalSlots.current?.identity === undefined || phase.journalSlots.next !== undefined || phase.journalSlots.backup !== undefined ||
              !sameCrashSafeFileSlotIdentity(phase.journalSlots.current.identity, expected.identity))) return invalidDeletionData(invalidCode);
          const assertMetadataAbsent = async () => {
            try {
              await assertWorkspaceDeletionMetadataAbsent(root, journal.target, {
                assertAuthority: assertCurrent, assertExternalSelection: phase.assertExternalSelection,
              });
            } catch (error) { throw retain(error); }
          };
          const assertPurged = async () => {
            try {
              await phase.assertExternalSelection();
              let workspaces = 0;
              await new WorkspaceDeletionInventoryStore(root, operationId).consumeSelectedRecords({
                target: journal.target, inventory: journal.inventory, inventoryFileIdentity: journal.inventoryFileIdentity,
                operationRootIdentity: journal.operationRootIdentity, operationParentIdentity: journal.operationParentIdentity,
              }, { assertAuthority: assertCurrent, assertExternalSelection: phase.assertExternalSelection }, async row => {
                if (row.role === 'inspectionEvidence') return;
                if (row.role === 'workspace') workspaces++;
                const selected = await selectWorkspaceDeletionPayload(root, journal, captureDeletionInventoryPayloadRecord(row),
                  workspaceDeletionQuarantineFileSystem, assertCurrent, true);
                if (selected.state !== 'absent') return invalidDeletionData(invalidCode);
                await phase.assertExternalSelection();
              });
              if (workspaces !== 1) return invalidDeletionData(invalidCode);
              await assertMetadataAbsent(); await phase.assertExternalSelection(); assertCurrent();
            } catch (error) { throw retain(error); }
          };
          const mutation = { slots: phase.journalSlots, assertAuthority: assertCurrent, assertExternalSelection: assertPurged };
          if (phase.journalSlots.current === undefined || phase.journalSlots.next !== undefined || phase.journalSlots.backup !== undefined) {
            await assertPurged();
            const identity = await store.recover(mutation);
            expected = { journal, identity };
            continue;
          }
          if (journal.phase === 'purged') {
            await assertPurged();
            const terminal = captureWorkspaceDeletionJournal({ ...journal, phase: 'registryPublished' });
            const identity = await store.advance(terminal, mutation);
            expected = { journal: terminal, identity };
            continue;
          }
          // A solitary terminal current is the durable proof after inventory retirement has started.
          // The changing journal slots are owned by clearTerminal, not by its external guard.
          const technical = { assertAuthority: assertCurrent, async assertExternalSelection() {
            try {
              await phase.assertExternalSelection(); await assertMetadataAbsent(); await phase.assertExternalSelection(); assertCurrent();
            } catch (error) { throw retain(error); }
          } };
          await phase.assertSelected();
          await retireWorkspaceDeletionInventory(root, journal, { assertAuthority: assertCurrent, async assertExternalSelection() {
            try {
              await technical.assertExternalSelection(); await phase.assertSelected(); assertCurrent();
            } catch (error) { throw retain(error); }
          } });
          const assertRetired = () => assertWorkspaceDeletionInventoryRetired(root, journal, technical);
          await phase.assertSelected(); await assertRetired();
          await store.clearTerminal({ slots: phase.journalSlots, assertAuthority: assertCurrent,
            assertExternalSelection: technical.assertExternalSelection }, { assertInventoryAndOperationRootAbsent: assertRetired });
          await technical.assertExternalSelection();
          const after = await store.inspect(assertCurrent);
          if (after.plan.mode !== 'absent') return invalidDeletionData(invalidCode);
          await assertRetired(); await technical.assertExternalSelection(); assertCurrent();
          return journal;
        } finally { phase.revoke(); }
      }
    } catch (error) { throw retain(error); }
    finally { active = false; running = false; }
  };
}
