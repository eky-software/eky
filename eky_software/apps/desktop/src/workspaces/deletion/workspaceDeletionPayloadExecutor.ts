import type { WorkspaceDeletionContinuationAuthority } from '../management/workspaceManagementService.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryPayloadRecord, deletionInventoryLine,
  type WorkspaceDeletionInventoryPayloadRecord, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { assertWorkspaceDeletionInspectionEvidence } from './workspaceDeletionInspectionEvidence.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionPayloadBinding } from './workspaceDeletionPayloadBinding.js';
import { selectWorkspaceDeletionPayload } from './workspaceDeletionPayloadSelection.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { purgeWorkspaceDeletionPayload, type WorkspaceDeletionPurgeFileSystem } from './workspaceDeletionPurge.js';
import { quarantineWorkspaceDeletionPayload, workspaceDeletionQuarantineFileSystem,
  type WorkspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';
type ExpectedState = 'admitted' | 'quarantine' | 'absent';

// The shared physical stage only. Registry publication, owner cleanup and the completed receipt follow it.
export function createWorkspaceDeletionPayloadExecutor(input: {
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertWritersAbsent(): Promise<void>;
}, fileSystems: Readonly<{ quarantine?: WorkspaceDeletionQuarantineFileSystem; purge?: WorkspaceDeletionPurgeFileSystem }> = {}) {
  const root = input.userDataRoot;
  const registry = { inspectSlots: input.registry.inspectSlots.bind(input.registry) };
  const writers = input.assertWritersAbsent.bind(input);
  const quarantine = fileSystems.quarantine, purge = fileSystems.purge;
  let running = false;
  return async (operationId: string, authority: WorkspaceDeletionContinuationAuthority): Promise<WorkspaceDeletionJournalV1> => {
    if (running) return invalidDeletionData(invalidCode);
    running = true;
    try {
      const owner = { assertCurrent: authority.assertCurrent.bind(authority), assertOwned: authority.assertOwned.bind(authority) };
      const journalStore = new WorkspaceDeletionJournalStore(root);
      let expected: Readonly<{ journal: WorkspaceDeletionJournalV1; identity: Readonly<CrashSafeFileSlotIdentity> }> | undefined;
      while (true) {
        const phase = await captureWorkspaceDeletionPhaseSelection({ operationId, authority: owner, registry,
          journal: journalStore, assertWritersAbsent: writers });
        try {
          const journal = phase.journal;
          if (journal.phase === 'registryPublished') return invalidDeletionData(invalidCode);
          if (expected !== undefined && (!serializeWorkspaceDeletionJournal(journal).equals(serializeWorkspaceDeletionJournal(expected.journal)) ||
              phase.journalSlots.current?.identity === undefined || phase.journalSlots.next !== undefined || phase.journalSlots.backup !== undefined ||
              !sameCrashSafeFileSlotIdentity(phase.journalSlots.current.identity, expected.identity))) return invalidDeletionData(invalidCode);
          const inventoryStore = new WorkspaceDeletionInventoryStore(root, journal.target.operationId);
          const inventory = { target: journal.target, inventory: journal.inventory, inventoryFileIdentity: journal.inventoryFileIdentity,
            operationRootIdentity: journal.operationRootIdentity, operationParentIdentity: journal.operationParentIdentity };
          const journalBytes = serializeWorkspaceDeletionJournal(journal);
          let workspace: WorkspaceDeletionInventoryPayloadRecord | undefined;
          await inventoryStore.consumeSelectedRecords(inventory, {
            assertAuthority: phase.assertCurrent, assertExternalSelection: phase.assertSelected,
          }, async row => {
            if (row.role === 'workspace') {
              if (workspace !== undefined) return invalidDeletionData(invalidCode);
              workspace = captureDeletionInventoryPayloadRecord(row);
            }
          });
          if (workspace === undefined) return invalidDeletionData(invalidCode);
          const coveringWorkspace = workspace;

          const consume = async (state: ExpectedState, action: 'validate' | 'move' | 'purge', includeJournal: boolean) => {
            const assertPhase = includeJournal ? phase.assertSelected : phase.assertExternalSelection;
            await inventoryStore.consumeSelectedRecords(inventory, {
              assertAuthority: phase.assertCurrent, assertExternalSelection: assertPhase,
            }, async (row: WorkspaceDeletionInventoryRecord) => {
              let active = true;
              const check = checkedDeletionAuthority(phase.assertCurrent, invalidCode);
              const assertAuthority = () => { if (!active) return invalidDeletionData(invalidCode); check(); };
              const rowAuthority = { assertAuthority, assertExternalSelection: assertPhase,
                async assertWritersAbsent() { assertAuthority(); await writers(); assertAuthority(); } };
              try {
                const binding = journal.phase === 'purged' || row.role === 'workspace' ? undefined
                  : await captureWorkspaceDeletionPayloadBinding(root, journal.target, row, rowAuthority);
                const assertRowSelected = async () => {
                  assertAuthority();
                  // The binding owner already brackets its reads with this exact phase selection and writer proof.
                  if (binding === undefined) await assertPhase();
                  else await binding.assertSelected();
                  assertAuthority();
                };
                if (row.role === 'inspectionEvidence') {
                  if (journal.phase === 'authorized' || journal.phase === 'quarantined') {
                    await assertWorkspaceDeletionInspectionEvidence(root, journal, coveringWorkspace, row,
                      { ...rowAuthority, assertExternalSelection: assertRowSelected });
                  }
                  await assertRowSelected();
                  return;
                }
                const payload = captureDeletionInventoryPayloadRecord(row);
                const payloadAuthority = { assertAuthority,
                  async assertSelected(selectedJournal: WorkspaceDeletionJournalV1, selectedRow: WorkspaceDeletionInventoryPayloadRecord) {
                    if (!serializeWorkspaceDeletionJournal(selectedJournal).equals(journalBytes) ||
                        !deletionInventoryLine(selectedRow).equals(deletionInventoryLine(payload))) return invalidDeletionData(invalidCode);
                    await assertRowSelected();
                  } };
                if (action === 'move') await quarantineWorkspaceDeletionPayload(root, journal, payload, payloadAuthority, quarantine);
                else if (action === 'purge') await purgeWorkspaceDeletionPayload(root, journal, payload, payloadAuthority, purge);
                else {
                  await assertRowSelected();
                  const selected = await selectWorkspaceDeletionPayload(root, journal, payload,
                    workspaceDeletionQuarantineFileSystem, assertAuthority,
                    journal.phase === 'purgeAuthorized' || journal.phase === 'purged');
                  if ((state === 'quarantine' && selected.state !== 'quarantine') ||
                      (state === 'absent' && selected.state !== 'absent') ||
                      (state === 'admitted' && journal.phase === 'quarantined' && selected.state !== 'quarantine') ||
                      (state === 'admitted' && journal.phase === 'purgeAuthorized' && selected.state === 'source') ||
                      (state === 'admitted' && journal.phase === 'purged' && selected.state !== 'absent')) return invalidDeletionData(invalidCode);
                  await assertRowSelected();
                }
              } finally { active = false; }
            });
          };

          await consume('admitted', 'validate', true);
          if (phase.journalSlots.current === undefined || phase.journalSlots.backup !== undefined || phase.journalSlots.next !== undefined) {
            // The byte store owns its changing slots; this guard proves only the original external state.
            const identity = await journalStore.recover({ slots: phase.journalSlots, assertAuthority: phase.assertCurrent,
              assertExternalSelection: () => consume('admitted', 'validate', false) });
            expected = { journal, identity };
            continue;
          }
          if (journal.phase === 'purged') return journal;
          if (journal.phase === 'authorized') await consume('admitted', 'move', true);
          else if (journal.phase === 'purgeAuthorized') await consume('admitted', 'purge', true);
          const state = journal.phase === 'purgeAuthorized' ? 'absent' : 'quarantine';
          await consume(state, 'validate', true);
          const next = captureWorkspaceDeletionJournal({ ...journal, phase: journal.phase === 'authorized' ? 'quarantined'
            : journal.phase === 'quarantined' ? 'purgeAuthorized' : 'purged' });
          const identity = await journalStore.advance(next, { slots: phase.journalSlots, assertAuthority: phase.assertCurrent,
            assertExternalSelection: () => consume(state, 'validate', false) });
          expected = { journal: next, identity };
        } finally { phase.revoke(); }
      }
    } finally { running = false; }
  };
}
