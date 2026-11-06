import type { WorkspaceDeletionContinuationAuthority } from '../management/workspaceManagementService.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { assertWorkspaceDeletionInventoryRetired, retireWorkspaceDeletionInventory } from './workspaceDeletionInventoryRetirement.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal, type WorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { assertWorkspaceDeletionMetadataAbsent } from './workspaceDeletionMetadataCleanup.js';
import { captureWorkspaceDeletionOriginalPayloadAbsence } from './workspaceDeletionOriginalPayloadAbsence.js';
import { selectWorkspaceDeletionPayload } from './workspaceDeletionPayloadSelection.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { workspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';
import { captureWorkspaceRemnantBinding } from './workspaceRemnantBindingCodec.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

// Publishes durable completion, retires the inventory, and clears the journal last. No payload deletion.
export function createWorkspaceDeletionFinalizer(input: {
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertWritersAbsent(): Promise<void>;
  assertStableSelection?(): Promise<void>;
  assertColdReadOwned?(): Promise<void>;
}) {
  const suppliedReadOwned = input.assertColdReadOwned;
  if (suppliedReadOwned !== undefined && typeof suppliedReadOwned !== 'function') return invalidDeletionData(invalidCode);
  const readOwned = suppliedReadOwned?.bind(input);
  const root = input.userDataRoot, registry = { inspectSlots: input.registry.inspectSlots.bind(input.registry) };
  const writers = input.assertWritersAbsent.bind(input);
  const stable = input.assertStableSelection?.bind(input);
  let running = false;
  return async (operationId: string, authority: WorkspaceDeletionContinuationAuthority,
    expectedBinding?: WorkspaceDeletionJournal): Promise<WorkspaceDeletionJournal> => {
    if (running) return invalidDeletionData(invalidCode);
    const binding = expectedBinding === undefined ? undefined : captureWorkspaceDeletionJournal(expectedBinding);
    const current = checkedDeletionAuthority(authority.assertCurrent.bind(authority), invalidCode), owned = authority.assertOwned.bind(authority);
    running = true;
    let active = true, failed = false;
    let firstFailure: unknown;
    let completedPurgedReadFailure: { error: unknown } | undefined;
    let completedRetirementReadFailure: { error: unknown } | undefined;
    const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
    const assertCurrent = () => {
      if (failed) throw firstFailure;
      try { if (!active) return invalidDeletionData(invalidCode); current(); }
      catch (error) { throw retain(error); }
    };
    try {
      const owner = { assertCurrent, async assertOwned() { assertCurrent(); await owned(); assertCurrent(); } };
      const store = new WorkspaceDeletionJournalStore(root);
      let expected: Readonly<{ journal: WorkspaceDeletionJournal; identity: Readonly<CrashSafeFileSlotIdentity> }> | undefined;
      while (true) {
        const phase = await captureWorkspaceDeletionPhaseSelection({ operationId, authority: owner,
          journal: store, registry, assertWritersAbsent: writers, ...(binding === undefined ? {} : { expectedBinding: binding }) });
        try {
          const journal = phase.journal;
          if ((journal.phase !== 'purged' && journal.phase !== 'registryPublished') ||
              phase.registryState !== 'after' || phase.registryNeedsRecovery) return invalidDeletionData(invalidCode);
          if (expected !== undefined && (!serializeWorkspaceDeletionJournal(journal).equals(serializeWorkspaceDeletionJournal(expected.journal)) ||
              phase.journalSlots.current?.identity === undefined || phase.journalSlots.next !== undefined || phase.journalSlots.backup !== undefined ||
              !sameCrashSafeFileSlotIdentity(phase.journalSlots.current.identity, expected.identity))) return invalidDeletionData(invalidCode);
          const originalAbsences: Awaited<ReturnType<typeof captureWorkspaceDeletionOriginalPayloadAbsence>>[] = [];
          if (journal.formatVersion === 2) {
            if (stable !== undefined) { assertCurrent(); await stable(); assertCurrent(); }
            for (const original of journal.originalJournalProofs) {
              originalAbsences.push(await captureWorkspaceDeletionOriginalPayloadAbsence(root, captureWorkspaceRemnantBinding({
                formatVersion: 1, owner: original.owner, operationId: original.operationId,
                workspaceId: journal.target.workspaceId, lineageIdentity: journal.target.lineageIdentity,
              }), {
                assertAuthority: assertCurrent, assertExternalSelection: phase.assertExternalSelection,
                assertWritersAbsent: writers,
                async assertReadSelection() {
                  assertCurrent(); phase.assertCurrent();
                  try {
                    await owner.assertOwned(); assertCurrent(); phase.assertCurrent();
                    await writers(); assertCurrent(); phase.assertCurrent();
                    await owner.assertOwned(); assertCurrent(); phase.assertCurrent();
                  } catch (error) { throw retain(error); }
                },
              }));
            }
            if (stable !== undefined) { await stable(); assertCurrent(); }
          }
          const assertMetadataAbsent = async (readSelection?: () => Promise<void>) => {
            let reading = true;
            const assertReadCurrent = () => {
              assertCurrent(); phase.assertCurrent();
              if (!reading) return invalidDeletionData(invalidCode);
            };
            const assertReadOwned = async () => {
              // An expired callback is rejected without poisoning a later active read.
              assertReadCurrent();
              try {
                if (readSelection !== undefined) {
                  const result: unknown = await readSelection(); assertReadCurrent();
                  if (result !== undefined) return invalidDeletionData(invalidCode);
                } else {
                  await owner.assertOwned(); assertReadCurrent();
                  await writers(); assertReadCurrent();
                  await owner.assertOwned(); assertReadCurrent();
                }
              } catch (error) { throw retain(error); }
            };
            try {
              if (readSelection === undefined) { await phase.assertExternalSelection(); assertReadCurrent(); }
              await assertWorkspaceDeletionMetadataAbsent(root, journal.target, {
                assertAuthority: assertReadCurrent, assertExternalSelection: assertReadOwned,
              });
              if (readSelection === undefined) { await phase.assertExternalSelection(); assertReadCurrent(); }
            } catch (error) { throw retain(error); }
            finally { reading = false; }
            try {
              for (const absence of originalAbsences) { await absence.assertAbsent(); assertCurrent(); }
            } catch (error) { throw retain(error); }
          };
          const assertPurged = async () => {
            try {
              assertCurrent(); if (stable !== undefined) { await stable(); assertCurrent(); }
              await phase.assertExternalSelection();
              let reading = true, readFailed = false;
              let readFailure: unknown;
              const failRead = (error: unknown) => {
                if (!reading) return;
                readFailed = true; readFailure = retain(error); reading = false;
              };
              const assertReadCurrent = () => {
                if (readFailed) throw readFailure;
                if (!reading) return invalidDeletionData(invalidCode);
                assertCurrent(); phase.assertCurrent();
              };
              const scope = { assertAuthority: assertReadCurrent, async assertExternalSelection() {
                assertReadCurrent();
                try { await phase.assertJournalReadOwned(); assertReadCurrent(); }
                catch (error) { failRead(error); throw readFailed ? readFailure : error; }
              } };
              let workspaces = 0;
              try {
                await new WorkspaceDeletionInventoryStore(root, operationId).consumeSelectedRecords({
                  target: journal.target, inventory: journal.inventory, inventoryFileIdentity: journal.inventoryFileIdentity,
                  operationRootIdentity: journal.operationRootIdentity, operationParentIdentity: journal.operationParentIdentity,
                }, scope, async row => {
                  assertReadCurrent();
                  if (row.role === 'inspectionEvidence') return;
                  if (row.role === 'workspace') workspaces++;
                  const selected = await selectWorkspaceDeletionPayload(root, journal, captureDeletionInventoryPayloadRecord(row),
                    workspaceDeletionQuarantineFileSystem, assertReadCurrent, true);
                  if (selected.state !== 'absent') return invalidDeletionData(invalidCode);
                  await scope.assertExternalSelection(); assertReadCurrent();
                }, failRead);
                if (workspaces !== 1) return invalidDeletionData(invalidCode);
              } catch (error) {
                failRead(error);
                completedPurgedReadFailure ??= { error };
                throw completedPurgedReadFailure.error;
              } finally { reading = false; }
              // The metadata reader's existing leading full guard closes this read.
              await assertMetadataAbsent(); await phase.assertExternalSelection(); assertCurrent();
              if (stable !== undefined) { await stable(); assertCurrent(); }
            } catch (error) {
              if (completedPurgedReadFailure !== undefined) throw completedPurgedReadFailure.error;
              throw retain(error);
            }
          };
          const withJournalReadSelection = async (work: (selection: { assertBeforeSlotRead(): Promise<void> }) => Promise<Readonly<CrashSafeFileSlotIdentity>>) => {
            let reading = true, readFailed = false;
            let readFailure: unknown;
            const assertReadCurrent = () => {
              if (readFailed) throw readFailure;
              if (!reading) return invalidDeletionData(invalidCode);
              assertCurrent(); phase.assertCurrent();
            };
            try {
              return await work({ async assertBeforeSlotRead() {
                assertReadCurrent();
                try {
                  if (stable !== undefined) { await stable(); assertReadCurrent(); }
                  await phase.assertExternalSelection(); assertReadCurrent();
                  if (stable !== undefined) { await stable(); assertReadCurrent(); }
                } catch (error) {
                  readFailed = true; readFailure = retain(error); reading = false;
                  throw readFailure;
                }
              } });
            } finally { reading = false; }
          };
          const mutation = { slots: phase.journalSlots, assertAuthority: assertCurrent, assertExternalSelection: assertPurged };
          if (phase.journalSlots.current === undefined || phase.journalSlots.next !== undefined || phase.journalSlots.backup !== undefined) {
            await assertPurged();
            const identity = await withJournalReadSelection(read => store.recover(mutation, read));
            expected = { journal, identity };
            continue;
          }
          if (journal.phase === 'purged') {
            await assertPurged();
            const terminal = captureWorkspaceDeletionJournal({ ...journal, phase: 'registryPublished' });
            const identity = await withJournalReadSelection(read => store.advance(terminal, mutation, read));
            expected = { journal: terminal, identity };
            continue;
          }
          // A solitary terminal current is the durable proof after inventory retirement has started.
          // The changing journal slots are owned by clearTerminal, not by its external guard.
          const assertTerminalMetadataAbsent = async () => {
            let reading = true;
            const assertReadCurrent = () => {
              assertCurrent(); phase.assertCurrent();
              if (!reading) return invalidDeletionData(invalidCode);
            };
            const assertReadOwned = async () => {
              if (readOwned !== undefined) {
                assertReadCurrent();
                const result: unknown = await readOwned();
                assertReadCurrent();
                if (result !== undefined) return invalidDeletionData(invalidCode);
                return;
              }
              assertReadCurrent(); await owner.assertOwned(); assertReadCurrent();
              await writers(); assertReadCurrent();
              await owner.assertOwned(); assertReadCurrent();
            };
            try {
              await phase.assertExternalSelection();
              await assertMetadataAbsent(assertReadOwned);
              await phase.assertExternalSelection(); assertCurrent();
            } catch (error) { throw retain(error); }
            finally { reading = false; }
          };
          const technical = { assertAuthority: assertCurrent, async assertExternalSelection() {
            try {
              assertCurrent(); if (stable !== undefined) { await stable(); assertCurrent(); }
              await assertTerminalMetadataAbsent(); assertCurrent();
              if (stable !== undefined) { await stable(); assertCurrent(); }
            } catch (error) { throw retain(error); }
          } };
          await phase.assertSelected();
          let retirementActive = true;
          try { await retireWorkspaceDeletionInventory(root, journal, { assertAuthority: assertCurrent, async assertExternalSelection() {
            try {
              await technical.assertExternalSelection(); await phase.assertSelected(); assertCurrent();
            } catch (error) { throw retain(error); }
          } }, undefined, { async assertExternalSelection() {
            try { await phase.assertSelected(); assertCurrent(); }
            catch (error) { throw retain(error); }
          } }, error => {
            if (!retirementActive) return invalidDeletionData(invalidCode);
            completedRetirementReadFailure ??= { error };
            retain(error);
          }); }
          finally { retirementActive = false; }
          const assertRetired = () => assertWorkspaceDeletionInventoryRetired(root, journal, technical);
          await phase.assertSelected(); await assertRetired();
          // Slot-read prefixes are scoped; clearTerminal retains the full trailing guards.
          let readingSlots = true, slotReadFailed = false;
          let slotReadFailure: unknown;
          const assertSlotReadCurrent = () => {
            if (slotReadFailed) throw slotReadFailure;
            if (!readingSlots) return invalidDeletionData(invalidCode);
            assertCurrent(); phase.assertCurrent();
          };
          const slotReadSelection = { async assertBeforeSlotRead() {
            assertSlotReadCurrent();
            try {
              if (stable !== undefined) { await stable(); assertSlotReadCurrent(); }
              await phase.assertExternalSelection(); assertSlotReadCurrent();
              if (stable !== undefined) { await stable(); assertSlotReadCurrent(); }
            } catch (error) {
              slotReadFailed = true; slotReadFailure = retain(error); readingSlots = false;
              throw slotReadFailure;
            }
          } };
          try { await store.clearTerminal({ slots: phase.journalSlots, assertAuthority: assertCurrent,
            assertExternalSelection: technical.assertExternalSelection }, { async assertInventoryAndOperationRootAbsent() {
              let reading = true;
              const assertReadCurrent = () => {
                assertCurrent(); phase.assertCurrent();
                if (!reading) return invalidDeletionData(invalidCode);
              };
              const scope = { assertAuthority: assertReadCurrent, async assertExternalSelection() {
                if (readOwned !== undefined) {
                  assertReadCurrent();
                  const result: unknown = await readOwned();
                  assertReadCurrent();
                  if (result !== undefined) return invalidDeletionData(invalidCode);
                  return;
                }
                assertReadCurrent(); await owner.assertOwned(); assertReadCurrent();
                await writers(); assertReadCurrent();
                await owner.assertOwned(); assertReadCurrent();
              } };
              try { await assertWorkspaceDeletionInventoryRetired(root, journal, scope); }
              catch (error) { throw retain(error); }
              finally { reading = false; }
            } }, slotReadSelection); }
          finally { readingSlots = false; }
          await technical.assertExternalSelection();
          const after = await store.inspect(assertCurrent);
          if (after.plan.mode !== 'absent') return invalidDeletionData(invalidCode);
          if (stable === undefined) await assertRetired();
          else {
            let reading = true;
            const assertReadCurrent = () => {
              assertCurrent(); phase.assertCurrent();
              if (!reading) return invalidDeletionData(invalidCode);
            };
            const scope = { assertAuthority: assertReadCurrent, async assertExternalSelection() {
              if (readOwned !== undefined) {
                assertReadCurrent();
                const result: unknown = await readOwned();
                assertReadCurrent();
                if (result !== undefined) return invalidDeletionData(invalidCode);
                return;
              }
              assertReadCurrent(); await owner.assertOwned(); assertReadCurrent();
              await writers(); assertReadCurrent();
              await owner.assertOwned(); assertReadCurrent();
            } };
            try { await assertWorkspaceDeletionInventoryRetired(root, journal, scope); }
            catch (error) { throw retain(error); }
            finally { reading = false; }
          } await technical.assertExternalSelection(); assertCurrent();
          return journal;
        } finally { phase.revoke(); }
      }
    } catch (error) {
      if (completedRetirementReadFailure !== undefined) throw completedRetirementReadFailure.error;
      if (completedPurgedReadFailure !== undefined) throw completedPurgedReadFailure.error;
      throw retain(error);
    }
    finally { active = false; running = false; }
  };
}
