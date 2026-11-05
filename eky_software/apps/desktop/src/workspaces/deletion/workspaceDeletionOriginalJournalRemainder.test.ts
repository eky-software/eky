import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createAdoptionJournal } from '../adoption/workspaceLegacyAdoptionTestSupport.js';
import { serializeWorkspaceLegacyAdoptionJournal } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { serializeWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalSerializer.js';
import { validateWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalValidation.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { deletionTestHeader as target, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionOriginalJournalProof, workspaceDeletionOriginalJournalOwners,
  type WorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceDeletionOriginalJournalRemainder as capture } from './workspaceDeletionOriginalJournalRemainder.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';

const absent = Object.freeze({ current: undefined, next: undefined, backup: undefined });

function fixture(owner: WorkspaceDeletionOriginalJournalProof['owner'] = 'workspaceImport') {
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner, operationId: id(201),
    workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
  const bytes = owner === 'workspaceImport' ? serializeWorkspaceBackupImportJournal(validateWorkspaceBackupImportJournal({
    formatVersion: 2, operationId: binding.operationId, workspaceId: binding.workspaceId, workspaceLabel: 'Synthetic remainder',
    createdAt: '2026-11-02T00:00:00.000Z', previousActiveWorkspaceId: null, state: 'prepared', lineageIdentity: null,
  })) : owner === 'workspaceLegacyAdoption' ? serializeWorkspaceLegacyAdoptionJournal({ ...createAdoptionJournal('prepared'),
    operationId: binding.operationId, workspaceId: binding.workspaceId })
    : Buffer.from(JSON.stringify({ formatVersion: 1, operationId: binding.operationId, phase: 'prepared', revision: 0,
      hadActiveDatabase: true, hadActiveDocuments: true }) + '\n');
  // Real owner-valid bytes with controlled file identities; native replacement is verified separately.
  const current = { bytes, value: {}, identity: { dev: 1, ino: 42, size: bytes.byteLength, mtimeMs: 3, ctimeMs: 4 } };
  const backup = { ...current, identity: { ...current.identity, ino: 41 } };
  const slots: ReadOnlyJournalSlots<unknown> = { current, next: undefined, backup };
  const commitment = (slot: typeof current) => ({ sha256: createHash('sha256').update(slot.bytes).digest('hex'), identity: slot.identity });
  const proof = captureWorkspaceDeletionOriginalJournalProof(target, { owner, operationId: binding.operationId,
    bindingSha256: workspaceRemnantBindingSha256(binding), slots: { current: commitment(current), next: null, backup: commitment(backup) } });
  return { binding, bytes, current, backup, slots, proof };
}

it.for(workspaceDeletionOriginalJournalOwners)('compares exact %s owner bytes without granting cleanup authority', owner => {
  const f = fixture(owner);
  expect(capture(target, f.proof, f.binding, f.slots, 'selected')).toEqual({ binding: f.binding, proof: f.proof });
  expect(capture(target, f.proof, f.binding, f.slots, 'purged')).toEqual({ binding: f.binding, proof: f.proof });
});

it.for(workspaceDeletionOriginalJournalOwners)('admits only a purged retirement prefix for %s', owner => {
  const f = fixture(owner), partial = { ...f.slots, backup: undefined };
  expect(() => capture(target, f.proof, f.binding, partial, 'selected')).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(capture(target, f.proof, f.binding, partial, 'purged').binding).toEqual(f.binding);
  expect(() => capture(target, f.proof, f.binding, { ...f.slots, current: undefined }, 'purged')).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(() => capture(target, f.proof, undefined, partial, 'purged')).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(capture(target, f.proof, undefined, absent, 'purged').proof).toEqual(f.proof);
  expect(() => capture(target, f.proof, undefined, absent, 'selected')).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
});

it.for(['bytes', 'identity', 'newSlot', 'owner', 'target', 'bindingOperation'] as const)(
  'rejects %s changes without modifying the supplied observations', attack => {
    const f = fixture(), slots = { ...f.slots };
    let binding: unknown = f.binding, selectedTarget: unknown = target;
    if (attack === 'bytes') slots.current = { ...f.current, bytes: Buffer.concat([f.bytes, Buffer.from(' ')]) };
    if (attack === 'identity') slots.current = { ...f.current, identity: { ...f.current.identity, ino: 900 } };
    if (attack === 'newSlot') slots.next = f.current;
    if (attack === 'owner') binding = { ...f.binding, owner: 'workspaceLegacyAdoption' };
    if (attack === 'target') selectedTarget = { ...target, workspaceId: id(900) };
    if (attack === 'bindingOperation') binding = { ...f.binding, operationId: id(900) };
    const before = JSON.stringify({ slots, binding, selectedTarget });
    expect(() => capture(selectedTarget, f.proof, binding, slots, 'purged')).toThrow();
    expect(JSON.stringify({ slots, binding, selectedTarget })).toBe(before);
  },
);

it('rejects an owner-invalid slot relationship even when the byte and identity commitments agree', () => {
  const f = fixture();
  const bytes = serializeWorkspaceBackupImportJournal(validateWorkspaceBackupImportJournal({
    formatVersion: 2, operationId: id(999), workspaceId: f.binding.workspaceId, workspaceLabel: 'Synthetic foreign original',
    createdAt: '2026-11-02T00:00:00.000Z', previousActiveWorkspaceId: null, state: 'prepared', lineageIdentity: null,
  }));
  const current = { ...f.current, bytes, identity: { ...f.current.identity, size: bytes.byteLength } };
  const proof = captureWorkspaceDeletionOriginalJournalProof(target, { ...f.proof, slots: { ...f.proof.slots,
    current: { sha256: createHash('sha256').update(bytes).digest('hex'), identity: current.identity } } });
  expect(() => capture(target, proof, f.binding, { ...f.slots, current }, 'purged')).toThrow();
});
