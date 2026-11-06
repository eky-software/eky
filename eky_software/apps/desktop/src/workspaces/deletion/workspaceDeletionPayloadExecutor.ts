import type { WorkspaceDeletionContinuationAuthority } from '../management/workspaceManagementService.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryPayloadRecord, deletionInventoryLine,
  type WorkspaceDeletionInventoryPayloadRecord, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { WorkspaceDeletionInventoryStore, type WorkspaceDeletionInventoryAuthority } from './workspaceDeletionInventoryStore.js';
import { assertWorkspaceDeletionInspectionEvidence } from './workspaceDeletionInspectionEvidence.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal, type WorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
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
  assertStableSelection?(): Promise<void>;
}, fileSystems: Readonly<{ quarantine?: WorkspaceDeletionQuarantineFileSystem; purge?: WorkspaceDeletionPurgeFileSystem }> = {}) {
  const root = input.userDataRoot;
  const registry = { inspectSlots: input.registry.inspectSlots.bind(input.registry) };
  const writers = input.assertWritersAbsent.bind(input);
  const stable = input.assertStableSelection?.bind(input);
  const quarantine = fileSystems.quarantine, purge = fileSystems.purge;
  let running = false;
  return async (operationId: string, authority: WorkspaceDeletionContinuationAuthority,
    expectedBinding?: WorkspaceDeletionJournal): Promise<WorkspaceDeletionJournal> => {
    if (running) return invalidDeletionData(invalidCode);
    const binding = expectedBinding === undefined ? undefined : captureWorkspaceDeletionJournal(expectedBinding);
    running = true;
    let coldFailure: { cause: unknown } | undefined;
    try {
      const originalCurrent = checkedDeletionAuthority(authority.assertCurrent.bind(authority), invalidCode);
      const owner = { assertCurrent: () => { if (coldFailure !== undefined) throw coldFailure.cause; originalCurrent(); }, assertOwned: authority.assertOwned.bind(authority) };
      const assertStable = async () => {
        try {
          owner.assertCurrent(); const result: unknown = await stable!(); owner.assertCurrent();
          if (result !== undefined) return invalidDeletionData(invalidCode);
        } catch (cause) { coldFailure ??= { cause }; throw coldFailure.cause; }
      };
      const journalStore = new WorkspaceDeletionJournalStore(root);
      let expected: Readonly<{ journal: WorkspaceDeletionJournal; identity: Readonly<CrashSafeFileSlotIdentity> }> | undefined;
      while (true) {
        const phase = await captureWorkspaceDeletionPhaseSelection({ operationId, authority: owner, registry,
          journal: journalStore, assertWritersAbsent: writers, ...(binding === undefined ? {} : { expectedBinding: binding }) });
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
          const readRecords = async (assertPhase: () => Promise<void>, consume: (
            row: WorkspaceDeletionInventoryRecord, scope: WorkspaceDeletionInventoryAuthority,
          ) => Promise<void>) => {
            if (stable !== undefined) { phase.assertCurrent(); await assertStable(); phase.assertCurrent(); }
            let reading = true, failed = false;
            let firstFailure: unknown;
            const assertReadCurrent = () => {
              if (failed) throw firstFailure;
              phase.assertCurrent();
              if (!reading) return invalidDeletionData(invalidCode);
            };
            const scope = { assertAuthority: assertReadCurrent, async assertExternalSelection() {
              assertReadCurrent(); await writers(); assertReadCurrent();
            } };
            try {
              await assertPhase(); assertReadCurrent();
              await inventoryStore.consumeSelectedRecords(inventory, scope, async row => {
                assertReadCurrent(); await consume(row, scope); assertReadCurrent();
              });
              await assertPhase(); assertReadCurrent();
            } catch (error) { failed = true; firstFailure = error; throw error; }
            finally { reading = false; }
            if (stable !== undefined) { phase.assertCurrent(); await assertStable(); phase.assertCurrent(); }
          };
          let workspace: WorkspaceDeletionInventoryPayloadRecord | undefined;
          await readRecords(phase.assertSelected, async row => {
            if (row.role === 'workspace') {
              if (workspace !== undefined) return invalidDeletionData(invalidCode);
              workspace = captureDeletionInventoryPayloadRecord(row);
            }
          });
          if (workspace === undefined) return invalidDeletionData(invalidCode);
          const coveringWorkspace = workspace;

          const consume = async (state: ExpectedState, action: 'validate' | 'move' | 'purge', includeJournal: boolean) => {
            const assertPhase = includeJournal ? phase.assertSelected : phase.assertExternalSelection;
            const processRow = async (row: WorkspaceDeletionInventoryRecord, scope?: WorkspaceDeletionInventoryAuthority) => {
              const assertRowPhase = scope?.assertExternalSelection ?? assertPhase;
              let active = true;
              const check = checkedDeletionAuthority(scope?.assertAuthority ?? phase.assertCurrent, invalidCode);
              const assertAuthority = () => { if (!active) return invalidDeletionData(invalidCode); check(); };
              const rowAuthority = { assertAuthority, assertExternalSelection: assertRowPhase,
                async assertWritersAbsent() { assertAuthority(); await writers(); assertAuthority(); } };
              try {
                const binding = journal.phase === 'purged' || row.role === 'workspace' ? undefined
                  : await captureWorkspaceDeletionPayloadBinding(root, journal.target, row, rowAuthority);
                const assertRowSelected = async () => {
                  if (stable !== undefined && scope === undefined) { assertAuthority(); await assertStable(); assertAuthority(); }
                  assertAuthority();
                  // The binding owner already brackets its reads with this exact phase selection and writer proof.
                  if (binding === undefined) await assertRowPhase();
                  else await binding.assertSelected();
                  assertAuthority();
                  if (stable !== undefined && scope === undefined) { await assertStable(); assertAuthority(); }
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
                  async assertSelected(selectedJournal: WorkspaceDeletionJournal, selectedRow: WorkspaceDeletionInventoryPayloadRecord) {
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
            };
            if (action === 'validate') await readRecords(assertPhase, processRow);
            else await readRecords(assertPhase, row => processRow(row));
          };

          await consume('admitted', 'validate', true);
          if (phase.journalSlots.current === undefined || phase.journalSlots.backup !== undefined || phase.journalSlots.next !== undefined) {
            // The byte store owns its changing slots; this guard proves only the original external state.
            const identity = await journalStore.recover({ slots: phase.journalSlots, assertAuthority: phase.assertCurrent,
              assertExternalSelection: () => consume('admitted', 'validate', false) }, { assertBeforeSlotRead: phase.assertExternalSelection });
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
          let fullFailure: { cause: unknown } | undefined;
          let advancing = true, advanceFailed = false;
          let advanceFailure: unknown;
          const assertAdvanceCurrent = () => {
            if (!advancing) return invalidDeletionData(invalidCode);
            if (advanceFailed) throw advanceFailure;
            phase.assertCurrent();
          };
          let identity: Readonly<CrashSafeFileSlotIdentity>;
          try {
            identity = await journalStore.advance(next, { slots: phase.journalSlots, assertAuthority: phase.assertCurrent,
              async assertExternalSelection() {
                try { await consume(state, 'validate', false); }
                catch (cause) { fullFailure ??= { cause }; throw fullFailure.cause; }
              } }, { assertBeforeSlotRead: phase.assertExternalSelection }, {
              async assertAfterSlotRead() {
                assertAdvanceCurrent();
                try {
                  if (stable !== undefined) { await assertStable(); assertAdvanceCurrent(); }
                  await phase.assertExternalSelection(); assertAdvanceCurrent();
                  if (stable !== undefined) { await assertStable(); assertAdvanceCurrent(); }
                } catch (error) {
                  if (!advanceFailed) { advanceFailed = true; advanceFailure = error; }
                  throw advanceFailure;
                }
              },
            });
          } catch (cause) {
            if (fullFailure !== undefined) throw fullFailure.cause;
            throw cause;
          } finally { advancing = false; }
          expected = { journal: next, identity };
        } finally { phase.revoke(); }
      }
    } catch (cause) {
      if (coldFailure !== undefined) throw coldFailure.cause;
      throw cause;
    } finally { running = false; }
  };
}
