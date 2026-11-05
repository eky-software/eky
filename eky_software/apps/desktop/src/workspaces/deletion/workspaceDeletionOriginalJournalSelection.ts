import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { captureProfileRestoreActivationDeletionSlots, ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { captureWorkspaceLegacyAdoptionDeletionSlots, WorkspaceLegacyAdoptionJournalStore } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { captureWorkspaceBackupImportDeletionSlots, WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { deriveWorkspaceBackupReplacementOperationsPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionJournal, captureWorkspaceDeletionOriginalJournalProof,
  type WorkspaceDeletionJournal, type WorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceDeletionOriginalJournalRemainder } from './workspaceDeletionOriginalJournalRemainder.js';
import { captureWorkspaceDeletionOriginalPayloadAbsence } from './workspaceDeletionOriginalPayloadAbsence.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey, workspaceRemnantBindingSha256,
  type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';
type OriginalSlots = ReadOnlyJournalSlots<{ readonly operationId: string }>;
type Group = {
  owners: readonly WorkspaceDeletionOriginalJournalProof['owner'][];
  read(): Promise<OriginalSlots>;
  validate(binding: unknown, slots: Pick<CrashSafeByteSlotSelection, 'expectedSlots' | 'expectedIdentities'>): unknown;
};
type BindingSelection = { store: WorkspaceRemnantBindingStore; slots: ReadOnlyJournalSlots<WorkspaceRemnantBindingV1> };

// Publication-only observation. Neither a receipt nor the durable proof grants metadata retirement.
export async function captureWorkspaceDeletionOriginalJournals(
  root: string, targetValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  assertReadOwned?: () => Promise<void>,
) {
  return captureOriginalJournals(root, targetValue, authority, undefined, assertReadOwned);
}

// Read-only comparison against an already published journal. The caller still owns fresh phase admission.
export async function captureWorkspaceDeletionOriginalJournalContinuation(
  root: string, journalValue: unknown, registryState: 'before' | 'after', authority: WorkspaceInspectionRemnantAuthority,
) {
  const journal = captureWorkspaceDeletionJournal(journalValue);
  if (registryState !== 'before' && registryState !== 'after') return invalidDeletionData(invalidCode);
  const mode = (journal.phase === 'purged' || journal.phase === 'registryPublished') && registryState === 'after'
    ? 'purged' as const : 'selected' as const;
  return captureOriginalJournals(root, journal.target, authority, { journal, mode });
}

async function captureOriginalJournals(
  root: string, targetValue: unknown, authority: WorkspaceInspectionRemnantAuthority,
  continuation?: Readonly<{ journal: WorkspaceDeletionJournal; mode: 'selected' | 'purged' }>,
  assertReadOwned?: () => Promise<void>,
) {
  const target = captureDeletionInventoryHeader(targetValue);
  const operationPaths = deriveWorkspaceBackupReplacementOperationsPaths(root);
  const userDataRoot = operationPaths.userDataRoot;
  const check = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority), writers = authority.assertWritersAbsent.bind(authority);
  let active = true, failed = false;
  let firstFailure: unknown;
  const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
  const guard = () => {
    if (failed) throw firstFailure;
    try { if (!active) return invalidDeletionData(invalidCode); check(); }
    catch (error) { throw retain(error); }
  };
  const checked = async <T>(work: () => Promise<T>) => {
    try { guard(); const result = await work(); guard(); return result; }
    catch (error) { throw retain(error); }
  };
  const assertExternalSelection = () => checked(async () => {
    await checked(assertReadOwned ?? external); await checked(writers); await checked(external);
  });
  // The finite original-owner pass brackets the full target selection; nested reads never grant mutation.
  const bindingAuthority = { assertAuthority: guard, assertExternalSelection: () => checked(writers) };
  const imported = new WorkspaceBackupImportJournalStore({ installationRoot: userDataRoot, filePath: join(userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME) });
  const adopted = new WorkspaceLegacyAdoptionJournalStore(userDataRoot);
  const activated = new ProfileRestoreActivationJournalStore(operationPaths.activationJournalPath);
  const groups: Group[] = [
    { owners: ['workspaceImport'], read: () => imported.inspectSlots(guard), validate: captureWorkspaceBackupImportDeletionSlots },
    { owners: ['workspaceLegacyAdoption'], read: () => adopted.inspectSlots(guard), validate: captureWorkspaceLegacyAdoptionDeletionSlots },
    { owners: ['workspaceReplacement', 'workspaceActivationMigration'], read: () => activated.inspectDeletionSlots(guard), validate: captureProfileRestoreActivationDeletionSlots },
  ];
  const selected: { group: Group; slots: OriginalSlots; bindings: BindingSelection[] }[] = [];
  const proofs: WorkspaceDeletionOriginalJournalProof[] = [];
  const originalAbsences: Awaited<ReturnType<typeof captureWorkspaceDeletionOriginalPayloadAbsence>>[] = [];
  const read = (group: Group) => checked(async () => {
    const slots = copySlots(await checked(group.read));
    return slots;
  });
  const assertSelected = () => checked(async () => {
    await assertExternalSelection();
    for (const selection of selected) {
      assertSameSlots(selection.slots, await read(selection.group));
      for (const binding of selection.bindings) {
        const current = await checked(() => binding.store.inspect(bindingAuthority));
        assertSameSlots(binding.slots, current.slots);
      }
    }
    for (const absence of originalAbsences) await checked(() => absence.assertAbsent());
    await assertExternalSelection();
  });
  try {
    await assertExternalSelection();
    for (const group of groups) {
      const slots = await read(group), bindings: BindingSelection[] = [];
      const present = Object.values(slots).find(slot => slot !== undefined);
      const original = continuation?.journal.formatVersion === 2
        ? continuation.journal.originalJournalProofs.find(proof => group.owners.includes(proof.owner)) : undefined;
      if (continuation !== undefined && original === undefined && present !== undefined) return invalidDeletionData(invalidCode);
      if (present !== undefined || original !== undefined) {
        let binding: WorkspaceRemnantBindingV1 | undefined;
        for (const owner of group.owners) {
          const expected = captureWorkspaceRemnantBinding({ formatVersion: 1, owner, operationId: original?.operationId ?? present!.value.operationId,
            workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
          const store = new WorkspaceRemnantBindingStore(userDataRoot, workspaceRemnantBindingKey(expected));
          const current = await checked(() => store.inspect(bindingAuthority));
          bindings.push({ store, slots: copySlots(current.slots) });
          if (current.mode === 'absent') continue;
          if (binding !== undefined || current.bindingSha256 !== workspaceRemnantBindingSha256(expected)) return invalidDeletionData(invalidCode);
          binding = expected;
        }
        if (original !== undefined) {
          const remainder = captureWorkspaceDeletionOriginalJournalRemainder(target, original, binding, slots, continuation!.mode);
          proofs.push(remainder.proof);
          if (continuation!.mode === 'purged') {
            originalAbsences.push(await checked(() => captureWorkspaceDeletionOriginalPayloadAbsence(userDataRoot, remainder.binding, {
              ...bindingAuthority, assertWritersAbsent: () => checked(writers),
            })));
          }
        } else {
          if (binding === undefined) return invalidDeletionData(invalidCode);
          group.validate(binding, { expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
            expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity } });
          const commitment = (slot: OriginalSlots['current']) => slot === undefined ? null : {
            sha256: createHash('sha256').update(slot.bytes).digest('hex'), identity: slot.identity,
          };
          proofs.push(captureWorkspaceDeletionOriginalJournalProof(target, { owner: binding.owner, operationId: binding.operationId,
            bindingSha256: workspaceRemnantBindingSha256(binding), slots: {
              current: commitment(slots.current), next: commitment(slots.next), backup: commitment(slots.backup),
            } }));
        }
      }
      selected.push({ group, slots, bindings });
    }
    await assertSelected();
    return Object.freeze({ userDataRoot, target, proofs: Object.freeze(proofs), assertSelected, revoke() { active = false; } });
  } catch (error) { active = false; throw retain(error); }
}

function copySlots<T>(slots: ReadOnlyJournalSlots<T>): ReadOnlyJournalSlots<T> {
  const copy: Record<'current' | 'next' | 'backup', ReadOnlyJournalSlots<T>['current']> = {
    current: undefined, next: undefined, backup: undefined,
  };
  for (const name of ['current', 'next', 'backup'] as const) {
    const slot = slots[name];
    if (slot === undefined) continue;
    if (slot.identity === undefined) return invalidDeletionData(invalidCode);
    copy[name] = Object.freeze({ value: slot.value, bytes: Uint8Array.from(slot.bytes), identity: Object.freeze({ ...slot.identity }) });
  }
  return Object.freeze(copy);
}

function assertSameSlots<T>(expected: ReadOnlyJournalSlots<T>, actual: ReadOnlyJournalSlots<T>) {
  for (const name of ['current', 'next', 'backup'] as const) {
    const before = expected[name], after = actual[name];
    if (before === undefined ? after !== undefined : after === undefined || before.identity === undefined || after.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(before.identity, after.identity) || !Buffer.from(before.bytes).equals(Buffer.from(after.bytes))) {
      return invalidDeletionData(invalidCode);
    }
  }
}

export type WorkspaceDeletionOriginalJournalSelection = Awaited<ReturnType<typeof captureWorkspaceDeletionOriginalJournals>>;
