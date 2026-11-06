import { expect, it } from 'vitest';
import { deletionTestDigest as hash, deletionTestId as id, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionJournal, captureWorkspaceDeletionOriginalJournalProof, maximumWorkspaceDeletionJournalBytes,
  parseWorkspaceDeletionJournalBytes, sameWorkspaceDeletionJournalBinding, serializeWorkspaceDeletionJournal,
  workspaceDeletionOriginalJournalOwners, workspaceDeletionPhases } from './workspaceDeletionJournalCodec.js';
import { deletionTestOriginalJournalProof as proof, deletionTestJournalV2 as journal } from './workspaceDeletionOriginalJournalProofTestSupport.js';

it.each(workspaceDeletionOriginalJournalOwners)('captures exact immutable %s commitments without changing v1 bytes', owner => {
  const value = journal('authorized', [proof(owner)]);
  expect(parseWorkspaceDeletionJournalBytes(serializeWorkspaceDeletionJournal(value))).toEqual(value);
  expect(Object.isFrozen(value.originalJournalProofs)).toBe(true);
  expect(Object.isFrozen(value.originalJournalProofs[0]!.slots.current!.identity)).toBe(true);
  const old = deletionTestJournal();
  expect(serializeWorkspaceDeletionJournal(old)).toEqual(Buffer.from(JSON.stringify(old) + '\n'));
  expect(Object.hasOwn(parseWorkspaceDeletionJournalBytes(serializeWorkspaceDeletionJournal(old)), 'originalJournalProofs')).toBe(false);
});

it.each(workspaceDeletionPhases)('preserves the original commitments across %s', phase => {
  const value = journal(phase);
  expect(sameWorkspaceDeletionJournalBinding(value, journal())).toBe(true);
  const changed = captureWorkspaceDeletionJournal({ ...value, originalJournalProofs: [{ ...proof(),
    slots: { ...proof().slots, current: { ...proof().slots.current!, sha256: hash('changed original') } } }] });
  expect(sameWorkspaceDeletionJournalBinding(changed, value)).toBe(false);
});

it('fits all three fixed journal owners without changing the journal byte limit', () => {
  const value = journal('authorized', [proof('workspaceImport'), proof('workspaceLegacyAdoption'), proof('workspaceReplacement')]);
  expect(serializeWorkspaceDeletionJournal(value).byteLength).toBeLessThanOrEqual(maximumWorkspaceDeletionJournalBytes);
  expect(parseWorkspaceDeletionJournalBytes(serializeWorkspaceDeletionJournal(value))).toEqual(value);
  expect(journal('authorized', []).originalJournalProofs).toEqual([]);
});

it('copies supplied proof bytes and identity fields before retaining the journal', () => {
  const original = proof();
  const supplied = { ...original, slots: { ...original.slots,
    current: { ...original.slots.current!, identity: { ...original.slots.current!.identity } } } };
  const value = captureWorkspaceDeletionJournal({ ...deletionTestJournal(), formatVersion: 2, originalJournalProofs: [supplied] });
  supplied.slots.current.identity.size = 999;
  supplied.slots.current.sha256 = hash('changed caller');
  if (value.formatVersion !== 2) throw new Error('SYNTHETIC_DELETION_VERSION_INVALID');
  expect(value.originalJournalProofs).toEqual([original]);
});

it('rejects unknown fields, owners, references, slot counts and identity shapes safely', () => {
  const p = proof(), current = p.slots.current!;
  const invalid = [
    { ...p, extra: true }, { ...p, owner: 'profileInspection' }, { ...p, operationId: '../outside' },
    { ...p, bindingSha256: hash('wrong binding') },
    { ...p, slots: { ...p.slots, extra: null } }, { ...p, slots: { current: null, next: null, backup: null } },
    { ...p, slots: { current, next: current, backup: current } },
    { ...p, slots: { ...p.slots, current: { ...current, extra: true } } },
    { ...p, slots: { ...p.slots, current: { ...current, sha256: '' } } },
    ...[{ ...current.identity, ino: 0 }, { ...current.identity, size: 0 },
      { ...current.identity, dev: NaN }, { ...current.identity, mtimeMs: Infinity },
      { ...current.identity, extra: true }].map(identity => ({ ...p, slots: { ...p.slots, current: { ...current, identity } } })),
  ];
  for (const value of invalid) {
    expect(() => captureWorkspaceDeletionOriginalJournalProof(deletionTestJournal().target, value)).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(() => captureWorkspaceDeletionJournal({ ...deletionTestJournal(), formatVersion: 2, originalJournalProofs: [value] })).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  }
  expect(() => captureWorkspaceDeletionOriginalJournalProof({ ...deletionTestJournal().target, workspaceId: id(99) }, p)).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
});

it('rejects duplicate physical owners, noncanonical order, oversized lists and invented v1 evidence', () => {
  for (const proofs of [[proof(), proof()], [proof('workspaceReplacement'), proof('workspaceActivationMigration')],
    [proof('workspaceLegacyAdoption'), proof()], [proof(), proof(), proof(), proof()]]) {
    expect(() => captureWorkspaceDeletionJournal({ ...deletionTestJournal(), formatVersion: 2, originalJournalProofs: proofs })).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  }
  expect(() => captureWorkspaceDeletionJournal({ ...deletionTestJournal(), originalJournalProofs: [] })).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(() => captureWorkspaceDeletionJournal({ ...deletionTestJournal(), formatVersion: 2, originalJournalProofs: [], companyName: 'forbidden' })).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
});

it.each(['sparse', 'getter', 'map', 'prototype'] as const)('rejects a %s proof array without invoking supplied code', kind => {
  const values: unknown[] = kind === 'sparse' ? new Array<unknown>(1) : [proof()];
  let calls = 0;
  if (kind === 'getter') Object.defineProperty(values, '0', { enumerable: true, get() { calls++; return proof(); } });
  if (kind === 'map') Object.defineProperty(values, 'map', { value() { calls++; return []; } });
  if (kind === 'prototype') Object.setPrototypeOf(values, { map() { calls++; return []; } });
  expect(() => captureWorkspaceDeletionJournal({ ...deletionTestJournal(), formatVersion: 2, originalJournalProofs: values })).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(calls).toBe(0);
});
