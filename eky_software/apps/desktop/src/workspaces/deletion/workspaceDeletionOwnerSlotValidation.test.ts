import { expect, it, vi } from 'vitest';
import { captureProfileRestoreActivationDeletionSlots } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { assertWorkspaceLegacyAdoptionTransition, captureWorkspaceLegacyAdoptionDeletionSlots,
  serializeWorkspaceLegacyAdoptionJournal } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { createAdoptionJournal } from '../adoption/workspaceLegacyAdoptionTestSupport.js';
import { parseWorkspaceBackupImportJournalBytes } from '../import/workspaceBackupImportJournalBytes.js';
import { serializeWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalSerializer.js';
import { captureWorkspaceBackupImportDeletionSlots } from '../import/workspaceBackupImportJournalStore.js';
import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import type { CrashSafeFileSlot, CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { deletionTestDigest as hash, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceRemnantBinding } from './workspaceRemnantBindingCodec.js';

const lineageIdentity = { formatVersion: 1, profileId: hash('lineage') } as const;
const operationId = id(1), workspaceId = validateWorkspaceId(id(2));
const binding = (owner: 'workspaceImport' | 'workspaceLegacyAdoption' | 'workspaceReplacement') =>
  captureWorkspaceRemnantBinding({ formatVersion: 1, owner, operationId, workspaceId, lineageIdentity });
const importJournal = (state: 'prepared' | 'candidateRootCreated') => serializeWorkspaceBackupImportJournal({
  formatVersion: 2, operationId, workspaceId, workspaceLabel: 'Synthetic import', createdAt: '2026-11-01T00:00:00.000Z',
  previousActiveWorkspaceId: null, state, lineageIdentity: null,
});
const adoptionJournal = (state: 'prepared' | 'candidatePrepared' | 'recoveryRequired') =>
  ({ ...createAdoptionJournal(state), operationId, workspaceId });
const activationJournal = (phase: 'prepared' | 'movingCurrentDatabase' | 'accepted', revision: number) =>
  Buffer.from(JSON.stringify({ formatVersion: 1, operationId, phase, revision, hadActiveDatabase: true, hadActiveDocuments: true }) + '\n');
const owners = [
  { name: 'import', owner: binding('workspaceImport'), capture: captureWorkspaceBackupImportDeletionSlots,
    before: importJournal('prepared'), after: importJournal('candidateRootCreated') },
  { name: 'adoption', owner: binding('workspaceLegacyAdoption'), capture: captureWorkspaceLegacyAdoptionDeletionSlots,
    before: serializeWorkspaceLegacyAdoptionJournal(adoptionJournal('prepared')),
    after: serializeWorkspaceLegacyAdoptionJournal(adoptionJournal('candidatePrepared')) },
  { name: 'activation', owner: binding('workspaceReplacement'), capture: captureProfileRestoreActivationDeletionSlots,
    before: activationJournal('prepared', 0), after: activationJournal('movingCurrentDatabase', 1) },
] as const;

function selected(values: Partial<Record<CrashSafeFileSlot, Uint8Array>> = {}) {
  const expectedSlots = { current: values.current, backup: values.backup, next: values.next };
  const expectedIdentities: Record<CrashSafeFileSlot, CrashSafeFileSlotIdentity | undefined> = {
    current: undefined, backup: undefined, next: undefined,
  };
  for (const [index, slot] of (['current', 'backup', 'next'] as const).entries()) {
    const bytes = expectedSlots[slot];
    if (bytes !== undefined) expectedIdentities[slot] = { dev: 1, ino: index + 1, size: bytes.byteLength, mtimeMs: 1, ctimeMs: 1 };
  }
  return { expectedSlots, expectedIdentities } satisfies Pick<CrashSafeByteSlotSelection, 'expectedSlots' | 'expectedIdentities'>;
}

function snapshot(input: Pick<CrashSafeByteSlotSelection, 'expectedSlots' | 'expectedIdentities'>) {
  return { bytes: (['current', 'backup', 'next'] as const).map(slot => {
    const value = input.expectedSlots[slot];
    return value === undefined ? undefined : Array.from(value);
  }), identities: structuredClone(input.expectedIdentities) };
}

it.for(owners)('captures $name legal slot relationships without invoking any authority or mutation callback', owner => {
  const noGrant = vi.fn(() => { throw new Error('UNEXPECTED_PERMISSION_OR_IO'); });
  for (const values of [{}, { current: owner.before }, { backup: owner.before }, { next: owner.before },
    { backup: owner.before, current: owner.after }, { current: owner.before, next: owner.after },
    { backup: owner.before, next: owner.after }, { current: owner.before, next: owner.before }]) {
    const input = { ...selected(values), assertAuthority: noGrant, assertExternalSelection: noGrant,
      assertDeletionPurged: noGrant, onUncertain: noGrant };
    const before = snapshot(input);
    const result = owner.capture(owner.owner, input);
    expect(snapshot(result)).toEqual(snapshot(selected(values)));
    expect(snapshot(input)).toEqual(before);
    expect(noGrant).not.toHaveBeenCalled();
  }
});

it.for(owners)('isolates $name journal bytes and supplied identities from later caller changes', owner => {
  const bytes = Uint8Array.from(owner.before), input = selected({ current: bytes });
  const originalIdentity = { ...input.expectedIdentities.current! };
  input.expectedIdentities.current = originalIdentity;
  const result = owner.capture(owner.owner, input);
  bytes[0] = 0; originalIdentity.ino = 99;
  expect(Array.from(result.expectedSlots.current!)).toEqual(Array.from(owner.before));
  expect(result.expectedIdentities.current!.ino).toBe(1);
  expect(result.expectedSlots.current === input.expectedSlots.current).toBe(false);
  expect(result.expectedIdentities.current === input.expectedIdentities.current).toBe(false);
});

it.for(owners)('rejects $name malformed or inconsistent inputs without borrowing cleanup authority', owner => {
  const cases = [selected({ current: Buffer.from('{') }), selected({ backup: owner.after, current: owner.before }),
    selected({ backup: owner.before, current: owner.before, next: owner.before })];
  const missingIdentity = selected({ current: owner.before }); missingIdentity.expectedIdentities.current = undefined;
  const orphanIdentity = selected(); orphanIdentity.expectedIdentities.next = { dev: 1, ino: 2, size: 1, mtimeMs: 1, ctimeMs: 1 };
  for (const input of [...cases, missingIdentity, orphanIdentity]) {
    const before = snapshot(input);
    expect(() => owner.capture(owner.owner, input)).toThrow();
    expect(snapshot(input)).toEqual(before);
  }
  expect(() => owner.capture({ ...owner.owner, operationId: id(9) }, selected({ current: owner.before }))).toThrow();
  expect(() => owner.capture({ ...owner.owner, owner: owner.name === 'import' ? 'workspaceLegacyAdoption' : 'workspaceImport' },
    selected({ current: owner.before }))).toThrow();
});

it('keeps early import null lineage unchanged and does not use it to attest content', () => {
  const input = selected({ current: importJournal('prepared') });
  const result = captureWorkspaceBackupImportDeletionSlots(binding('workspaceImport'), input);
  expect(parseWorkspaceBackupImportJournalBytes(result.expectedSlots.current!).lineageIdentity).toBeNull();
  expect(Object.keys(result).sort()).toEqual(['expectedIdentities', 'expectedSlots']);
});

it('retains only the named legacy recovery reset exception, not a changed ordinary transition rule', () => {
  const older = adoptionJournal('recoveryRequired'), newer = adoptionJournal('prepared');
  expect(() => assertWorkspaceLegacyAdoptionTransition(older, newer)).toThrow();
  expect(() => captureWorkspaceLegacyAdoptionDeletionSlots(binding('workspaceLegacyAdoption'), selected({
    backup: serializeWorkspaceLegacyAdoptionJournal(older), current: serializeWorkspaceLegacyAdoptionJournal(newer),
  }))).not.toThrow();
});

it('rejects an activation terminal restart and never invents company or lineage fields absent from that journal', () => {
  expect(() => captureProfileRestoreActivationDeletionSlots(binding('workspaceReplacement'), selected({
    backup: activationJournal('accepted', 0), current: activationJournal('prepared', 1),
  }))).toThrow();
  const result = captureProfileRestoreActivationDeletionSlots({ ...binding('workspaceReplacement'), workspaceId: id(8),
    lineageIdentity: { formatVersion: 1, profileId: hash('different') } }, selected({ current: activationJournal('prepared', 0) }));
  expect(Object.keys(result).sort()).toEqual(['expectedIdentities', 'expectedSlots']);
});
