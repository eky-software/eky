import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionJournal, workspaceDeletionPhases, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceDeletionRegistryState } from './workspaceDeletionRegistryState.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function fixture(phase: WorkspaceDeletionJournalV1['phase'] = 'purged',
  active: typeof TEST_SOURCE_WORKSPACE_ID | null = TEST_SOURCE_WORKSPACE_ID, last = false) {
  const before = parseWorkspaceRegistryBytes(serializeWorkspaceRegistry({ ...createSwitchRegistry(), formatVersion: 2,
    activeWorkspaceId: active, ...(last ? { workspaces: [createSwitchRegistry().workspaces[1]!] } : {}) }));
  const after = removeWorkspaceEntry({ registry: before, targetWorkspaceId: TEST_TARGET_WORKSPACE_ID,
    expectedActiveWorkspaceId: active });
  const beforeBytes = Buffer.from(JSON.stringify(before, null, 2)), afterBytes = serializeWorkspaceRegistry(after);
  const target = before.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)!;
  const journal = captureWorkspaceDeletionJournal({ ...deletionTestJournal(phase),
    target: { ...deletionTestJournal().target, workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity,
      registryEntrySha256: workspaceRegistryEntrySha256(target) }, previousActiveWorkspaceId: active,
    registryBeforeSha256: hash(beforeBytes), registryAfterSha256: hash(afterBytes) });
  const beforeSlot = { bytes: beforeBytes, value: before,
    identity: { dev: 1, ino: 1, size: beforeBytes.byteLength, mtimeMs: 1, ctimeMs: 1 } };
  const afterSlot = { bytes: afterBytes, value: after,
    identity: { dev: 1, ino: 2, size: afterBytes.byteLength, mtimeMs: 2, ctimeMs: 2 } };
  const slots = (combination: string): ReadOnlyJournalSlots<LocalWorkspaceRegistry> => {
    const slot = (index: number) => combination[index] === 'B' ? beforeSlot : combination[index] === 'A' ? afterSlot : undefined;
    return { current: slot(0), backup: slot(1), next: slot(2) };
  };
  return { journal, before, after, beforeSlot, afterSlot, slots };
}

const combinations = ['-', 'B', 'A'].flatMap(current => ['-', 'B', 'A'].flatMap(backup =>
  ['-', 'B', 'A'].map(next => `${current}${backup}${next}`)));
const matrix = workspaceDeletionPhases.flatMap(phase => combinations.map(slots => ({ phase, slots })));
it.for(matrix)('classifies only admitted registry slots $slots in $phase', ({ phase, slots }) => {
  const f = fixture(phase);
  const permitted = phase === 'purged' ? ['B--', 'B-A', '-B-', '-BA', 'AB-', 'A--']
    : phase === 'registryPublished' ? ['A--'] : ['B--'];
  if (!permitted.includes(slots)) expect(() => captureWorkspaceDeletionRegistryState(f.journal, f.slots(slots))).toThrow();
  else {
    const selected = captureWorkspaceDeletionRegistryState(f.journal, f.slots(slots));
    expect(selected.state).toBe(slots[0] === 'A' ? 'after' : 'before');
    expect(selected.after).toEqual(f.after);
    expect(selected.needsRecovery).toBe(slots !== 'B--' && slots !== 'A--');
    expect(Object.isFrozen(selected)).toBe(true);
  }
});

it.for([TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID, null])('preserves passive or active selection %s', active => {
  const f = fixture('purged', active);
  const result = captureWorkspaceDeletionRegistryState(f.journal, f.slots('B--'));
  expect(result.after.activeWorkspaceId).toBe(active === TEST_TARGET_WORKSPACE_ID ? null : active);
  expect(result.after.workspaces).toEqual([f.before.workspaces[0]]);
  expect(f.before.workspaces).toHaveLength(2);
});

it('retains the empty v2 registry after deleting the last company', () => {
  const f = fixture('purged', TEST_TARGET_WORKSPACE_ID, true);
  const result = captureWorkspaceDeletionRegistryState(f.journal, f.slots('B--'));
  expect(result.after).toEqual({ formatVersion: 2, activeWorkspaceId: null, workspaces: [] });
  expect(captureWorkspaceDeletionRegistryState({ ...f.journal, phase: 'registryPublished' }, f.slots('A--')).after).toEqual(result.after);
});

it.for(['lineage', 'entry', 'active', 'afterHash'] as const)('rejects journal %s even when before bytes match', change => {
  const f = fixture();
  const journal = { ...f.journal,
    ...(change === 'lineage' ? { target: { ...f.journal.target, lineageIdentity: { formatVersion: 1, profileId: 'f'.repeat(64) } } } : {}),
    ...(change === 'entry' ? { target: { ...f.journal.target, registryEntrySha256: 'e'.repeat(64) } } : {}),
    ...(change === 'active' ? { previousActiveWorkspaceId: null } : {}),
    ...(change === 'afterHash' ? { registryAfterSha256: 'd'.repeat(64) } : {}),
  };
  expect(() => captureWorkspaceDeletionRegistryState(journal, f.slots('B--'))).toThrow();
});

it('rejects a changed other company instead of overwriting it from an older snapshot', () => {
  const f = fixture();
  const changed = { ...f.before, workspaces: f.before.workspaces.map((entry, index) => index === 0
    ? { ...entry, workspaceLabel: 'Changed other company' } : entry) };
  const slots = f.slots('B--');
  expect(() => captureWorkspaceDeletionRegistryState(f.journal, { ...slots,
    current: { ...f.beforeSlot, bytes: serializeWorkspaceRegistry(changed), value: changed } })).toThrow();
  expect(changed.workspaces[0]!.workspaceLabel).toBe('Changed other company');
});

it.for(['current', 'backup', 'next'] as const)('requires identity and valid bytes for every %s slot', slot => {
  const f = fixture(), slots = f.slots(slot === 'current' ? 'B--' : slot === 'backup' ? 'AB-' : 'B-A');
  const observed = slots[slot]!;
  expect(() => captureWorkspaceDeletionRegistryState(f.journal, { ...slots, [slot]: { ...observed, identity: undefined } })).toThrow();
  expect(() => captureWorkspaceDeletionRegistryState(f.journal, { ...slots, [slot]: { ...observed, bytes: Buffer.from('{') } })).toThrow();
});

it('captures original slot bytes and ignores a caller-supplied parsed value', () => {
  const f = fixture();
  const selected = captureWorkspaceDeletionRegistryState(f.journal, { ...f.slots('B--'), current: {
    ...f.beforeSlot, value: f.after,
  } });
  expect(selected.slots.current!.value).toEqual(f.before);
  f.beforeSlot.bytes.fill(0);
  expect(hash(selected.slots.current!.bytes)).toBe(f.journal.registryBeforeSha256);
  expect(selected.after).toEqual(f.after);
});

it.for(['targetPresent', 'wrongSelection', 'v1'] as const)('rejects invalid terminal %s even if its digest was supplied', change => {
  const f = fixture('registryPublished');
  const invalid = change === 'targetPresent' ? f.before
    : change === 'wrongSelection' ? { ...f.after, activeWorkspaceId: null }
    : { ...f.after, formatVersion: 1 as const };
  const bytes = serializeWorkspaceRegistry(invalid);
  expect(() => captureWorkspaceDeletionRegistryState({ ...f.journal, registryAfterSha256: hash(bytes) }, {
    ...f.slots('A--'), current: { ...f.afterSlot, bytes, value: invalid },
  })).toThrow();
});
