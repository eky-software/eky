import { join } from 'node:path';
import { captureProfileRestoreActivationDeletionSlots, ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { captureWorkspaceLegacyAdoptionDeletionSlots, WorkspaceLegacyAdoptionJournalStore } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { captureWorkspaceBackupImportDeletionSlots, WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import type { WorkspaceDeletionContinuationAuthority } from '../management/workspaceManagementService.js';
import type { CrashSafeByteSlotSelection, ObservedRecoveryAuthority } from '../persistence/crashSafeByteSlotStore.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { deriveWorkspaceBackupReplacementOperationsPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryPayloadRecord, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { WorkspaceDeletionInventoryStore, type WorkspaceDeletionInventoryAuthority } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { workspaceDeletionPayloadBindingKeys } from './workspaceDeletionPayloadBinding.js';
import { selectWorkspaceDeletionPayload } from './workspaceDeletionPayloadSelection.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { workspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';
import { workspaceRemnantBindingOwners, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { observeWorkspaceRemnantBindingDirectory } from './workspaceRemnantBindingEnumeration.js';
import { WorkspaceRemnantBindingStore, type WorkspaceRemnantBindingCleanup } from './workspaceRemnantBindingStore.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';
type RetirementAuthority = CrashSafeByteSlotSelection & ObservedRecoveryAuthority & { assertDeletionPurged(): Promise<void> };

// Owns metadata ordering only. Terminal publication and journal-last retirement remain outside this stage.
export function createWorkspaceDeletionMetadataCleaner(input: {
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertWritersAbsent(): Promise<void>;
}) {
  const root = input.userDataRoot, registry = { inspectSlots: input.registry.inspectSlots.bind(input.registry) };
  const writers = input.assertWritersAbsent.bind(input);
  let running = false;
  return async (operationId: string, authority: WorkspaceDeletionContinuationAuthority, expectedBinding?: WorkspaceDeletionJournalV1) => {
    if (running) return invalidDeletionData(invalidCode);
    const binding = expectedBinding === undefined ? undefined : captureWorkspaceDeletionJournal(expectedBinding);
    running = true;
    try {
      const phase = await captureWorkspaceDeletionPhaseSelection({ operationId, authority, registry,
        journal: new WorkspaceDeletionJournalStore(root), assertWritersAbsent: writers, ...(binding === undefined ? {} : { expectedBinding: binding }) });
      let failed = false;
      let firstFailure: unknown;
      const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
      const assertCurrent = () => { if (failed) throw firstFailure; try { phase.assertCurrent(); } catch (error) { throw retain(error); } };
      try {
        const journal = phase.journal;
        if (journal.phase !== 'purged' || phase.registryState !== 'after' || phase.registryNeedsRecovery ||
            phase.journalSlots.current === undefined || phase.journalSlots.next !== undefined || phase.journalSlots.backup !== undefined) {
          return invalidDeletionData(invalidCode);
        }
        const inventory = { target: journal.target, inventory: journal.inventory, inventoryFileIdentity: journal.inventoryFileIdentity,
          operationRootIdentity: journal.operationRootIdentity, operationParentIdentity: journal.operationParentIdentity };
        // Iteration and nested validation have distinct store scopes; neither re-enters its own reader.
        const iterator = new WorkspaceDeletionInventoryStore(root, operationId), validation = new WorkspaceDeletionInventoryStore(root, operationId);
        const phaseAuthority = { assertAuthority: assertCurrent, assertExternalSelection: phase.assertSelected };
        const assertPurged = async () => {
          try {
            await phase.assertSelected(); let workspaces = 0;
            await validation.consumeSelectedRecords(inventory, phaseAuthority, async row => {
              if (row.role === 'inspectionEvidence') return;
              if (row.role === 'workspace') workspaces++;
              const selected = await selectWorkspaceDeletionPayload(root, journal, captureDeletionInventoryPayloadRecord(row),
                workspaceDeletionQuarantineFileSystem, assertCurrent, true);
              if (selected.state !== 'absent') return invalidDeletionData(invalidCode);
              await phase.assertSelected();
            });
            if (workspaces !== 1) return invalidDeletionData(invalidCode);
            await phase.assertSelected(); assertCurrent();
          } catch (error) { throw retain(error); }
        };
        const proof = (row: WorkspaceDeletionInventoryRecord): WorkspaceRemnantBindingCleanup => {
          if (row.bindingSha256 === null) return invalidDeletionData(invalidCode);
          return { ...phaseAuthority, mode: 'deletionPurged', bindingSha256: row.bindingSha256, assertPayloadsAbsent: assertPurged };
        };
        const importJournal = new WorkspaceBackupImportJournalStore({ installationRoot: root,
          filePath: join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME) });
        const adoptionJournal = new WorkspaceLegacyAdoptionJournalStore(root);
        const activationJournal = new ProfileRestoreActivationJournalStore(deriveWorkspaceBackupReplacementOperationsPaths(root).activationJournalPath);
        await assertPurged();
        const contexts = [
          journalContext(await importJournal.inspectSlots(assertCurrent), () => importJournal.inspectSlots(assertCurrent),
            binding => binding.owner === 'workspaceImport',
            (value, binding) => binding.owner === 'workspaceImport' && value.operationId === binding.operationId && value.workspaceId === binding.workspaceId,
            captureWorkspaceBackupImportDeletionSlots,
            importJournal.clearAfterDeletionPurged.bind(importJournal)),
          journalContext(await adoptionJournal.inspectSlots(assertCurrent), () => adoptionJournal.inspectSlots(assertCurrent),
            binding => binding.owner === 'workspaceLegacyAdoption',
            (value, binding) => binding.owner === 'workspaceLegacyAdoption' && value.operationId === binding.operationId && value.workspaceId === binding.workspaceId,
            captureWorkspaceLegacyAdoptionDeletionSlots,
            adoptionJournal.clearAfterDeletionPurged.bind(adoptionJournal)),
          journalContext(await activationJournal.inspectDeletionSlots(assertCurrent), () => activationJournal.inspectDeletionSlots(assertCurrent),
            binding => binding.owner === 'workspaceReplacement' || binding.owner === 'workspaceActivationMigration',
            (value, binding) => (binding.owner === 'workspaceReplacement' || binding.owner === 'workspaceActivationMigration') && value.operationId === binding.operationId,
            captureProfileRestoreActivationDeletionSlots,
            activationJournal.clearAfterDeletionPurged.bind(activationJournal)),
        ];
        const assertJournalsSelected = async (changing?: (typeof contexts)[number]) => {
          for (const context of contexts) if (context !== changing) { assertCurrent(); await context.assertSelected(); assertCurrent(); }
          await phase.assertSelected();
        };
        const bindingsFor = async (row: WorkspaceDeletionInventoryRecord, consume: (store: WorkspaceRemnantBindingStore,
          slots: ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>) => Promise<void>) => {
          for (const key of workspaceDeletionPayloadBindingKeys(journal.target, row)) {
            if ((row.role === 'importCandidate' && key.owner !== 'workspaceImport') ||
                (row.role === 'adoptionCandidate' && key.owner !== 'workspaceLegacyAdoption') ||
                (row.role === 'replacementImport' && key.owner !== 'workspaceReplacement')) continue;
            const store = new WorkspaceRemnantBindingStore(root, key);
            const slots = await store.inspectCommittedAfterPayloadsAbsent(journal.target, proof(row));
            assertCurrent(); await consume(store, slots); assertCurrent();
          }
        };

        // Preflight all three fixed journal owners before removing any evidence that binds them to the target.
        await iterator.consumeSelectedRecords(inventory, phaseAuthority, async row => {
          await assertJournalsSelected();
          await bindingsFor(row, async (store, slots) => {
            const value = Object.values(slots).find(record => record !== undefined)?.value;
            if (value === undefined) return;
            for (const context of contexts) if (context.matches(value)) context.bind(value, async () => {
              assertSameSlots(slots, await store.inspectCommittedAfterPayloadsAbsent(journal.target, proof(row)));
            });
          });
          await assertJournalsSelected();
        });
        for (const context of contexts) context.assertAdmitted();
        for (const context of contexts) {
          let active = true;
          const assertRetirementCurrent = () => { if (!active) return invalidDeletionData(invalidCode); assertCurrent(); };
          try {
            await assertJournalsSelected();
            await context.retire({ assertAuthority: assertRetirementCurrent,
              async assertExternalSelection() { assertRetirementCurrent(); await assertJournalsSelected(context); assertRetirementCurrent(); },
              assertDeletionPurged: assertPurged, onUncertain(error) { retain(error); } });
            await assertJournalsSelected();
          } finally { active = false; }
        }
        const assertJournalsAbsent = async () => {
          await assertJournalsSelected();
          if (contexts.some(context => context.present())) return invalidDeletionData(invalidCode);
        };
        await assertJournalsAbsent();
        await iterator.consumeSelectedRecords(inventory, phaseAuthority, async row => {
          await bindingsFor(row, async (store, slots) => {
            await assertJournalsAbsent();
            await store.clearCommittedAfterPayloadsAbsent(journal.target, { ...proof(row), expectedDeletionSlots: slots,
              async assertExternalSelection() { await phase.assertSelected(); await assertJournalsAbsent(); },
            });
            if (Object.values(await store.inspectCommittedAfterPayloadsAbsent(journal.target, proof(row))).some(record => record !== undefined)) {
              return invalidDeletionData(invalidCode);
            }
            await assertJournalsAbsent();
          });
        });
        await assertWorkspaceDeletionMetadataAbsent(root, journal.target, {
          assertAuthority: assertCurrent, assertExternalSelection: assertJournalsAbsent,
        });
        await assertPurged(); await assertJournalsAbsent(); assertCurrent();
        return journal;
      } catch (error) { assertCurrent(); throw error; }
      finally { phase.revoke(); }
    } finally { running = false; }
  };
}

// A read-only terminal precondition, not authority to retire an unselected journal or binding.
export async function assertWorkspaceDeletionMetadataAbsent(
  root: string, targetValue: unknown, authority: WorkspaceDeletionInventoryAuthority,
): Promise<void> {
  const target = captureDeletionInventoryHeader(targetValue);
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority);
  const assertSelected = async () => { check(); await external(); check(); };
  const journals = [
    () => new WorkspaceBackupImportJournalStore({ installationRoot: root,
      filePath: join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME) }).inspectSlots(check),
    () => new WorkspaceLegacyAdoptionJournalStore(root).inspectSlots(check),
    () => new ProfileRestoreActivationJournalStore(deriveWorkspaceBackupReplacementOperationsPaths(root).activationJournalPath).inspectDeletionSlots(check),
  ];
  for (const read of journals) {
    await assertSelected();
    const slots = await read(); check();
    if (Object.values(slots).some(record => record !== undefined)) return invalidDeletionData(invalidCode);
    await assertSelected();
  }
  for (const owner of workspaceRemnantBindingOwners) {
    for await (const row of observeWorkspaceRemnantBindingDirectory(root, owner, {
      assertAuthority: check, assertExternalSelection: assertSelected,
    })) {
      if (row.kind === 'binding' && row.binding.value.workspaceId === target.workspaceId) return invalidDeletionData(invalidCode);
    }
    await assertSelected();
  }
}

// Fixed-size owner selection; the inventory remains streamed.
function journalContext<T>(initial: ReadOnlyJournalSlots<T>, read: () => Promise<ReadOnlyJournalSlots<T>>,
  accepts: (binding: WorkspaceRemnantBindingV1) => boolean,
  matches: (value: Readonly<T>, binding: WorkspaceRemnantBindingV1) => boolean,
  validate: (binding: unknown, selection: Pick<CrashSafeByteSlotSelection, 'expectedSlots' | 'expectedIdentities'>) => unknown,
  clear: (binding: unknown, authority: RetirementAuthority) => Promise<void>) {
  let slots = initial;
  let binding: WorkspaceRemnantBindingV1 | undefined;
  let assertBinding: (() => Promise<void>) | undefined;
  const present = () => Object.values(slots).some(record => record !== undefined);
  const selectedSlots = () => ({
    expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
    expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity },
  });
  return {
    present,
    matches(value: WorkspaceRemnantBindingV1) { return accepts(value) && Object.values(slots).every(record => record === undefined || matches(record.value, value)); },
    bind(value: WorkspaceRemnantBindingV1, check: () => Promise<void>) { binding ??= value; assertBinding ??= check; },
    assertAdmitted() {
      if (!present() && binding === undefined) return;
      if (binding === undefined) return invalidDeletionData(invalidCode);
      validate(binding, selectedSlots());
    },
    async assertSelected() { assertSameSlots(slots, await read()); },
    async retire(authority: Omit<RetirementAuthority, 'expectedSlots' | 'expectedIdentities'>) {
      if (!present() && binding === undefined) return;
      if (binding === undefined || assertBinding === undefined) return invalidDeletionData(invalidCode);
      const selectedBinding = assertBinding;
      await clear(binding, { ...authority, ...selectedSlots(),
        async assertExternalSelection() { await authority.assertExternalSelection(); await selectedBinding(); authority.assertAuthority(); },
      });
      authority.assertAuthority();
      const after = await read(); authority.assertAuthority();
      if (Object.values(after).some(record => record !== undefined)) return invalidDeletionData(invalidCode);
      slots = after;
    },
  };
}

function assertSameSlots<T>(expected: ReadOnlyJournalSlots<T>, actual: ReadOnlyJournalSlots<T>): void {
  for (const name of ['current', 'backup', 'next'] as const) {
    const before = expected[name], after = actual[name];
    if (before === undefined ? after !== undefined : after === undefined || before.identity === undefined || after.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(before.identity, after.identity) || !Buffer.from(before.bytes).equals(Buffer.from(after.bytes))) {
      return invalidDeletionData(invalidCode);
    }
  }
}
