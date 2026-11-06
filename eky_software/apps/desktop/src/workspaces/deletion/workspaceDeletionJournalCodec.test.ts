import { expect, it } from 'vitest';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes, parseWorkspaceDeletionJournalBytes,
  sameWorkspaceDeletionJournalBinding, serializeWorkspaceDeletionJournal, workspaceDeletionPhases } from './workspaceDeletionJournalCodec.js';
import { deletionTestDigest as hash, deletionTestId as id, deletionTestJournal as journal } from './workspaceDeletionDataTestSupport.js';

it.each(workspaceDeletionPhases)('round-trips %s with a copied immutable binding', phase => {
  const value = journal(phase);
  const bytes = serializeWorkspaceDeletionJournal(value);
  expect(bytes.byteLength).toBeLessThan(maximumWorkspaceDeletionJournalBytes);
  expect(bytes.at(-1)).toBe(10);
  expect(parseWorkspaceDeletionJournalBytes(bytes)).toEqual(value);
  expect(sameWorkspaceDeletionJournalBinding(value, journal())).toBe(true);
  expect(Object.isFrozen(value.inventory)).toBe(true);
  expect(Object.isFrozen(value.target)).toBe(true);
});

it.each([{ phase: 'finished' }, { formatVersion: 2 }, { path: 'outside' }, { backupDisposition: 'ignored' },
  { previousActiveWorkspaceId: '../other' }, { inventoryFileIdentity: '' }, { operationRootIdentity: '' },
  { operationParentIdentity: null }, { registryAfterSha256: hash('before') },
  { inventory: { ...journal().inventory, recordCount: -1 } }, { target: { ...journal().target, password: 'synthetic-only' } },
])('rejects invalid journal %# with a safe deletion code', change => {
  expect(() => captureWorkspaceDeletionJournal({ ...journal(), ...change })).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
});

it('rejects malformed, duplicate-key, invalid UTF-8, empty and excessive slot bytes', () => {
  const valid = serializeWorkspaceDeletionJournal(journal());
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(maximumWorkspaceDeletionJournalBytes + 1, 32),
    Buffer.from([255]), Buffer.from('{'), Buffer.from(valid.toString().replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1'))]) {
    expect(() => parseWorkspaceDeletionJournalBytes(bytes)).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  }
});

it('compares every immutable field and permits nullable prior selection', () => {
  const original = journal();
  for (const change of [{ registryBeforeSha256: hash('another') }, { registryAfterSha256: hash('another') },
    { previousActiveWorkspaceId: null }, { backupDisposition: 'verifiedBackup' },
    { inventory: { ...original.inventory, sha256: hash('another') } },
    { target: { ...original.target, workspaceId: id(9) } }]) {
    expect(sameWorkspaceDeletionJournalBinding(original, captureWorkspaceDeletionJournal({ ...original, ...change }))).toBe(false);
  }
});
