import { chmod, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { captureWorkspaceRemnantBinding } from '../deletion/workspaceRemnantBindingCodec.js';
import type { CrashSafeFileSlot, CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { createNodeWorkspaceBackupImportJournalFileSystem } from './workspaceBackupImportJournalFileSystem.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from './workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { captureWorkspaceBackupImportDeletionSlots, WorkspaceBackupImportJournalStore } from './workspaceBackupImportJournalStore.js';
import { validateWorkspaceBackupImportJournal, WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES as states } from './workspaceBackupImportJournalValidation.js';
import type { WorkspaceBackupImportJournalState } from './workspaceBackupImportTypes.js';

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const lineageIdentity = { formatVersion: 1, profileId: 'a'.repeat(64) } as const;
const invalid = 'WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID';
const unavailable = 'WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE';
type Selection = Parameters<WorkspaceBackupImportJournalStore['clearAfterDeletionPurged']>[1];

function journal(state: WorkspaceBackupImportJournalState, changes: Record<string, unknown> = {}) {
  return validateWorkspaceBackupImportJournal({ formatVersion: 2, operationId, workspaceId,
    workspaceLabel: 'Synthetic import', previousActiveWorkspaceId: null, state,
    createdAt: '2026-11-01T00:00:00.000Z',
    lineageIdentity: ['candidateValidated', 'rootPublished', 'registryPublished'].includes(state) ? lineageIdentity : null,
    ...changes });
}

// Real selected journal I/O; the caller's deletion, inventory, binding and process proofs are controlled here.
async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-import-delete-cleanup-'));
  await chmod(root, 0o700);
  const pending: Promise<unknown>[] = [], releases: (() => void)[] = [];
  const state = { current: true, external: true, purged: true };
  const ownerError = new Error('SYNTHETIC_OWNER_LOST'), externalError = new Error('SYNTHETIC_EXTERNAL_CHANGED');
  const purgedError = new Error('SYNTHETIC_DELETION_NOT_PROVEN');
  const assertAuthority = vi.fn(() => { test.signal.throwIfAborted(); if (!state.current) throw ownerError; });
  const external = vi.fn(async () => { if (!state.external) throw externalError; });
  const purged = vi.fn(async () => { if (!state.purged) throw purgedError; });
  const onUncertain = vi.fn((_error: unknown): unknown => undefined);
  test.onTestFinished(async () => {
    state.current = false;
    for (const release of releases) release();
    await Promise.allSettled(pending);
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const paths = createWorkspaceBackupImportJournalPaths(root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME));
  const fs = createNodeWorkspaceBackupImportJournalFileSystem(paths);
  const store = new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: paths.currentPath, fileSystem: fs });
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport', operationId, workspaceId, lineageIdentity });
  const keptPath = join(root, 'other-company-evidence');
  await writeFile(keptPath, 'synthetic-preserved-bytes', { mode: 0o600, flag: 'wx' });
  const select = async (): Promise<Selection> => {
    const expectedSlots: Record<CrashSafeFileSlot, Uint8Array | undefined> = { current: undefined, next: undefined, backup: undefined };
    const expectedIdentities: Record<CrashSafeFileSlot, CrashSafeFileSlotIdentity | undefined> = {
      current: undefined, next: undefined, backup: undefined,
    };
    for (const slot of ['current', 'next', 'backup'] as const) {
      assertAuthority();
      const reading = fs.readSlot(slot, identity => { expectedIdentities[slot] = { ...identity }; });
      pending.push(reading); expectedSlots[slot] = await reading; assertAuthority();
    }
    return { expectedSlots, expectedIdentities, assertAuthority, assertExternalSelection: external,
      assertDeletionPurged: purged, onUncertain };
  };
  const clear = (selected?: Selection, value: unknown = binding) => {
    const result = (async () => store.clearAfterDeletionPurged(value, selected ?? await select()))();
    pending.push(result); return result;
  };
  const snapshot = async () => {
    const result: Record<string, string> = {};
    for (const name of await readdir(root)) result[name] = (await readFile(join(root, name))).toString('hex');
    return result;
  };
  return { root, paths, fs, store, binding, state, ownerError, externalError, purgedError,
    external, purged, onUncertain, select, clear, snapshot, releases,
    put: (slot: CrashSafeFileSlot, value: ReturnType<typeof journal>) =>
      writeFile(paths[`${slot}Path`], serializeWorkspaceBackupImportJournal(value), { mode: 0o600, flag: 'wx' }),
    async assertEmpty() {
      expect(await readdir(root)).toEqual(['other-company-evidence']);
      expect(await readFile(keptPath, 'utf8')).toBe('synthetic-preserved-bytes');
    } };
}

it('validates real import slots through the non-repairing reader without borrowing purged authority', async test => {
  const f = await fixture(test);
  await f.put('backup', journal('prepared')); await f.put('current', journal('candidateRootCreated'));
  f.state.purged = false;
  const writes = (['createNextWriter', 'moveSlot', 'removeSlot', 'syncDirectory'] as const).map(name => vi.spyOn(f.fs, name));
  try {
    const authority = await f.select(), observed = await f.store.inspectSlots(authority.assertAuthority);
    const input = { expectedSlots: { current: observed.current?.bytes, backup: observed.backup?.bytes, next: observed.next?.bytes },
      expectedIdentities: { current: observed.current?.identity, backup: observed.backup?.identity, next: observed.next?.identity } };
    const before = await f.snapshot();
    expect(captureWorkspaceBackupImportDeletionSlots(f.binding, input)).toEqual(input);
    expect(await f.snapshot()).toEqual(before);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(f.purged).not.toHaveBeenCalled();
    expect(f.onUncertain).not.toHaveBeenCalled();
  } finally { for (const write of writes) write.mockRestore(); }
});

it.for(states)('clears %s only with the explicit deletion proof, preserving required null lineage', async (state, test) => {
  const f = await fixture(test), value = journal(state);
  await f.put('current', value);
  await f.clear();
  expect(f.purged).toHaveBeenCalled(); expect(f.external).toHaveBeenCalled();
  expect(f.onUncertain).not.toHaveBeenCalled();
  await f.assertEmpty();
});

const pairs = states.slice(0, -1).flatMap((state, index) =>
  (['currentNext', 'backupCurrent', 'backupNext'] as const).map(slots => ({ state, next: states[index + 1]!, slots })));
it.for(pairs)('retires actual interrupted $slots slots at $state without promotion', async ({ state, next, slots }, test) => {
  const f = await fixture(test);
  const older = slots === 'currentNext' ? 'current' : 'backup', newer = slots === 'backupCurrent' ? 'current' : 'next';
  await f.put(older, journal(state)); await f.put(newer, journal(next));
  const remove = vi.spyOn(f.fs, 'removeSlot');
  const move = vi.spyOn(f.fs, 'moveSlot');
  await f.clear();
  expect(remove.mock.calls.map(([slot]) => slot)).toEqual(slots === 'backupCurrent' ? ['backup', 'current']
    : slots === 'backupNext' ? ['next', 'backup'] : ['next', 'current']);
  expect(move).not.toHaveBeenCalled();
  await f.assertEmpty();
});

it.for(['backup', 'next'] as const)('accepts a committed %s-only cleanup but not ordinary removal', async (slot, test) => {
  const f = await fixture(test), value = journal('rootPublished');
  await f.put(slot, value);
  const selected = await f.select(), before = await f.snapshot();
  await expect(f.store.removeSelected(value.operationId, selected)).rejects.toThrow(invalid);
  await expect(f.store.discardBeforePublicationSelected(value.operationId, selected)).rejects.toThrow(invalid);
  expect(await f.snapshot()).toEqual(before);
  await f.clear(selected); await f.assertEmpty();
});

it('does not loosen ordinary current-only rootPublished removal', async test => {
  const f = await fixture(test), value = journal('rootPublished'); await f.put('current', value);
  const selected = await f.select(), before = await f.snapshot();
  await expect(f.store.removeSelected(value.operationId, selected)).rejects.toThrow(invalid);
  await expect(f.store.discardBeforePublicationSelected(value.operationId, selected)).rejects.toThrow(invalid);
  expect(await f.snapshot()).toEqual(before);
  await f.clear(selected); await f.assertEmpty();
});

it('confirms a fully absent journal only after fresh proof and directory sync', async test => {
  const f = await fixture(test), sync = vi.spyOn(f.fs, 'syncDirectory');
  await f.clear(); await f.clear();
  expect(sync).toHaveBeenCalledTimes(2); expect(f.purged).toHaveBeenCalled();
  await f.assertEmpty();
});

it('accepts equal-state idempotent writes without requiring identical JSON formatting', async test => {
  const f = await fixture(test); await f.put('backup', journal('prepared'));
  await writeFile(f.paths.currentPath, ` ${Buffer.from(serializeWorkspaceBackupImportJournal(journal('prepared'))).toString()}`, { mode: 0o600 });
  await f.clear(); await f.assertEmpty();
});

it.for(['bindingOwner', 'operation', 'workspace', 'lineage', 'malformedCurrent', 'malformedSide'] as const)(
  'preserves every byte for %s conflict', async (change, test) => {
    const f = await fixture(test);
    await f.put('current', journal('candidateValidated', change === 'operation' ? { operationId: otherId }
      : change === 'workspace' ? { workspaceId: otherId }
      : change === 'lineage' ? { lineageIdentity: { formatVersion: 1, profileId: 'b'.repeat(64) } } : {}));
    if (change === 'malformedCurrent') await writeFile(f.paths.currentPath, '{', { mode: 0o600 });
    if (change === 'malformedSide') await writeFile(f.paths.nextPath, '{', { mode: 0o600, flag: 'wx' });
    const selected = await f.select(), before = await f.snapshot();
    const value = change === 'bindingOwner' ? { ...f.binding, owner: 'workspaceReplacement' } : f.binding;
    await expect(f.clear(selected, value)).rejects.toThrow(invalid);
    expect(f.onUncertain).toHaveBeenCalledOnce(); expect(await f.snapshot()).toEqual(before);
  });

it.for(['workspaceLabel', 'previousActiveWorkspaceId', 'createdAt', 'formatVersion', 'foreignOperation', 'foreignWorkspace', 'foreignLineage'] as const)(
  'rejects a side slot with changed %s', async (field, test) => {
    const f = await fixture(test); await f.put('backup', journal('candidateValidated'));
    const changes = field === 'workspaceLabel' ? { workspaceLabel: 'Other synthetic' }
      : field === 'previousActiveWorkspaceId' ? { previousActiveWorkspaceId: otherId }
      : field === 'createdAt' ? { createdAt: '2026-11-02T00:00:00.000Z' }
      : field === 'formatVersion' ? { formatVersion: 1 }
      : field === 'foreignOperation' ? { operationId: otherId }
      : field === 'foreignWorkspace' ? { workspaceId: otherId }
      : { lineageIdentity: { formatVersion: 1, profileId: 'b'.repeat(64) } };
    await f.put('current', journal('rootPublished', changes));
    const before = await f.snapshot();
    await expect(f.clear()).rejects.toThrow(invalid);
    expect(await f.snapshot()).toEqual(before);
  });

it.for(['skip', 'reverse', 'allThree'] as const)('rejects impossible %s slot relationships without repair', async (change, test) => {
  const f = await fixture(test);
  if (change === 'skip') { await f.put('current', journal('prepared')); await f.put('next', journal('backupStaged')); }
  else if (change === 'reverse') { await f.put('backup', journal('candidateRootCreated')); await f.put('current', journal('prepared')); }
  else {
    await f.put('backup', journal('prepared')); await f.put('current', journal('candidateRootCreated'));
    await f.put('next', journal('backupStaged'));
  }
  const before = await f.snapshot();
  await expect(f.clear()).rejects.toThrow(invalid);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['external', 'purged'] as const)('requires the original %s proof and retains its first cause', async (stage, test) => {
  const f = await fixture(test); await f.put('current', journal('rootPublished'));
  const before = await f.snapshot();
  if (stage === 'external') f.state.external = false; else f.state.purged = false;
  await expect(f.clear()).rejects.toThrow(unavailable);
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(stage === 'external' ? f.externalError : f.purgedError);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['backupBefore', 'backupAfter', 'currentBefore', 'currentAfter', 'syncBefore', 'syncAfter'] as const)(
  'resumes a fresh selection after a real %s cleanup cut and notifies the original I/O cause', async (boundary, test) => {
    const f = await fixture(test), first = new Error('SYNTHETIC_NATIVE_CLEANUP_CUT');
    await f.put('backup', journal('candidateMigrated')); await f.put('current', journal('candidateValidated'));
    const remove = f.fs.removeSlot.bind(f.fs), sync = f.fs.syncDirectory.bind(f.fs);
    f.fs.removeSlot = async (slot, guard) => {
      if (boundary === `${slot}Before`) throw first;
      const removed = await remove(slot, guard);
      if (boundary === `${slot}After`) throw first;
      return removed;
    };
    f.fs.syncDirectory = async guard => {
      if (boundary === 'syncBefore') throw first;
      await sync(guard); if (boundary === 'syncAfter') throw first;
    };
    await expect(f.clear()).rejects.toThrow(unavailable);
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    const remaining = await f.select();
    expect(remaining.expectedSlots.backup === undefined).toBe(boundary !== 'backupBefore');
    expect(remaining.expectedSlots.current === undefined).toBe(['currentAfter', 'syncBefore', 'syncAfter'].includes(boundary));
    if (remaining.expectedSlots.backup !== undefined) expect(Buffer.from(remaining.expectedSlots.backup)).toEqual(Buffer.from(serializeWorkspaceBackupImportJournal(journal('candidateMigrated'))));
    if (remaining.expectedSlots.current !== undefined) expect(Buffer.from(remaining.expectedSlots.current)).toEqual(Buffer.from(serializeWorkspaceBackupImportJournal(journal('candidateValidated'))));
    f.fs.removeSlot = remove; f.fs.syncDirectory = sync;
    await f.clear(remaining); await f.assertEmpty();
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

it.for(['identity', 'rawBytes'] as const)('rejects a late %s change without deleting either version', async (change, test) => {
  const f = await fixture(test); await f.put('current', journal('rootPublished'));
  const bytes = await readFile(f.paths.currentPath), remove = f.fs.removeSlot.bind(f.fs);
  f.fs.removeSlot = async (...args) => {
    if (change === 'identity') {
      await rename(f.paths.currentPath, join(f.root, 'preserved-journal'));
      await writeFile(f.paths.currentPath, bytes, { mode: 0o600, flag: 'wx' });
    } else await writeFile(f.paths.currentPath, Buffer.concat([Buffer.from(' '), bytes]), { mode: 0o600 });
    return remove(...args);
  };
  await expect(f.clear()).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(change === 'identity' ? bytes : Buffer.concat([Buffer.from(' '), bytes]));
  if (change === 'identity') expect(await readFile(join(f.root, 'preserved-journal'))).toEqual(bytes);
});

it('captures caller bytes, identities, binding and callbacks before any proof await', async test => {
  const f = await fixture(test); await f.put('current', journal('rootPublished'));
  const selected = await f.select(), binding = { ...f.binding, lineageIdentity: { ...f.binding.lineageIdentity } };
  f.external.mockImplementationOnce(async () => {
    selected.expectedSlots.current!.fill(0);
    Object.assign(selected.expectedIdentities.current!, { ino: 0 });
    binding.lineageIdentity.profileId = 'b'.repeat(64);
    selected.assertAuthority = () => { throw new Error('SYNTHETIC_REPLACED_CALLBACK'); };
    selected.assertExternalSelection = selected.assertDeletionPurged = async () => { throw new Error('SYNTHETIC_REPLACED_CALLBACK'); };
    selected.onUncertain = () => { throw new Error('SYNTHETIC_REPLACED_CALLBACK'); };
  });
  await f.clear(selected, binding); await f.assertEmpty();
  expect(f.purged).toHaveBeenCalled(); expect(f.onUncertain).not.toHaveBeenCalled();
});

it('does not let a throwing uncertainty notification replace the first failure', async test => {
  const f = await fixture(test), first = new Error('SYNTHETIC_NATIVE_CUT'); await f.put('current', journal('prepared'));
  f.fs.removeSlot = async () => { throw first; };
  f.onUncertain.mockImplementationOnce(() => { throw new Error('SYNTHETIC_NOTIFICATION_FAILED'); });
  const before = await f.snapshot();
  await expect(f.clear()).rejects.toThrow(unavailable);
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first); expect(await f.snapshot()).toEqual(before);
});

it('does not await an asynchronous uncertainty notification', async test => {
  const f = await fixture(test); await f.put('current', journal('prepared')); f.state.purged = false;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  f.onUncertain.mockImplementationOnce(async () => { enter(); await pending; });
  let settled = false;
  const result = f.clear().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('SYNTHETIC_NOTIFICATION_NOT_CALLED'); })]);
    await setImmediate(); expect(settled).toBe(true);
    expect(await result).toMatchObject({ message: unavailable });
  } finally { release(); await result; }
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.purgedError);
});

it('joins pending removal, refuses concurrency and reports the owner cause before filesystem mapping', async test => {
  const f = await fixture(test); await f.put('current', journal('rootPublished'));
  const before = await f.snapshot(), remove = f.fs.removeSlot.bind(f.fs);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  f.fs.removeSlot = async (...args) => { enter(); await pending; return remove(...args); };
  let settled = false;
  const result = f.clear().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('SYNTHETIC_REMOVAL_NOT_PENDING'); })]);
    await expect(f.store.inspectSlots()).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY');
    f.state.current = false; await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toMatchObject({ message: unavailable });
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.ownerError);
  expect(await f.snapshot()).toEqual(before);
});
