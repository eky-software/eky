import { link, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES } from '../import/workspaceBackupImportJournalBytes.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createWorkspaceRegistryPaths, WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WORKSPACE_REGISTRY_MAX_BYTES } from '../registry/workspaceRegistryBytes.js';
import { CrashSafeByteSlotStore } from './crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem, sameCrashSafeFileSlotIdentity, type CrashSafeFileSlot } from './crashSafeFileSlot.js';
import type { ObservedRecoveryAuthority } from './crashSafeObservedRecovery.js';

const slots = ['current', 'backup', 'next'] as const;
type Kind = 'journal' | 'registryV1' | 'registryV2';
const journal = { formatVersion: 2, operationId: '33333333-3333-4333-8333-333333333333',
  workspaceId: '22222222-2222-4222-8222-222222222222', workspaceLabel: 'Synthetic imported',
  previousActiveWorkspaceId: null, state: 'prepared', createdAt: '2026-10-29T09:00:00.000Z', lineageIdentity: null };

async function fixture(test: TestContext, kind: Kind,
  initial: Partial<Record<CrashSafeFileSlot, string>>,
  previous?: { root: string; lease: InMemoryWorkspaceMaintenanceLease }) {
  const root = previous?.root ?? await mkdtemp(join(tmpdir(), 'eky-observed-recovery-'));
  if (!previous) test.onTestFinished(async () => {
    vi.restoreAllMocks();
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const paths = kind === 'journal'
    ? createWorkspaceBackupImportJournalPaths(root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME))
    : createWorkspaceRegistryPaths(root, join(root, WORKSPACE_REGISTRY_FILE_NAME));
  const maximum = kind === 'journal' ? WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES : WORKSPACE_REGISTRY_MAX_BYTES;
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximum);
  const store = kind === 'journal'
    ? new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: paths.currentPath, fileSystem: fs })
    : new WorkspaceRegistryStore({ installationRoot: root, filePath: paths.currentPath, fileSystem: fs });
  const value = kind === 'journal' ? journal : { formatVersion: kind === 'registryV1' ? 1 : 2, activeWorkspaceId: null, workspaces: [] };
  const bytes = Buffer.from(JSON.stringify(value));
  const path = (slot: CrashSafeFileSlot) => paths[`${slot}Path`];
  for (const slot of slots) if (initial[slot] !== undefined) {
    await writeFile(path(slot), initial[slot] === 'valid' ? bytes : initial[slot]!, { flag: 'wx', mode: 0o600 });
  }
  const lease = previous?.lease ?? new InMemoryWorkspaceMaintenanceLease();
  const held = await lease.acquire('import');
  const capturedLease = lease.captureCurrentOwner(['import'], held);
  const state = { current: true, external: true, first: undefined as { error: unknown } | undefined };
  const notifications = vi.fn((error: unknown) => { state.first ??= { error }; });
  const authority: ObservedRecoveryAuthority = {
    assertAuthority() {
      if (state.first) throw state.first.error;
      capturedLease(); if (!state.current) throw new Error('SYNTHETIC_OWNER_EXPIRED');
    },
    async assertExternalSelection() { if (!state.external) throw new Error('SYNTHETIC_EXTERNAL_CHANGED'); },
    onUncertain: notifications,
  };
  const snapshot = async () => {
    const result: Record<string, Buffer | undefined> = {};
    for (const slot of slots) {
      try { result[slot] = await readFile(path(slot)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') result[slot] = undefined; else throw error; }
    }
    return result;
  };
  return { root, fs, store, bytes, path, value, state, authority, notifications, held, lease, maximum, snapshot,
    inspect: () => store.inspectRecoverySelection(authority.assertAuthority),
  };
}

for (const kind of ['journal', 'registryV1', 'registryV2'] as const) {
  it.for([
    { current: 'valid' }, { backup: 'valid' }, { next: 'valid' },
    { current: 'valid', backup: '{torn' }, { current: 'valid', next: '' },
    { backup: 'valid', next: '{torn' }, { current: 'valid', backup: '', next: '{torn' },
  ])('cold ' + kind + ' recovers the existing authoritative slot combination %#', async (initial, test) => {
    const f = await fixture(test, kind, initial);
    const before = await f.snapshot(); const selection = await f.inspect();
    expect(await f.snapshot()).toEqual(before);
    expect(selection.value).toEqual(f.value);
    const original = selection.identities[selection.source!];
    const receipt = await f.store.recoverObservedSelection(selection, f.authority);
    expect(receipt.value).toEqual(f.value);
    expect(Buffer.from(receipt.bytes).equals(f.bytes)).toBe(true);
    expect(receipt.identity.ino).toBe(original?.ino);
    expect(receipt.identity.dev).toBe(original?.dev);
    const final = await f.inspect();
    expect(sameCrashSafeFileSlotIdentity(receipt.identity, final.identities.current!)).toBe(true);
    expect(await f.snapshot()).toEqual({ current: f.bytes, next: undefined, backup: undefined });
    expect(f.notifications).not.toHaveBeenCalled();
  });

  it('cold ' + kind + ' never reads oversized discarded sibling content', async test => {
    const f = await fixture(test, kind, { current: 'valid', next: 'x'.repeat(128 * 1024) });
    const read = vi.spyOn(f.fs, 'readSlot');
    const selection = await f.inspect(); await f.store.recoverObservedSelection(selection, f.authority);
    expect(read.mock.calls.every(([slot]) => slot === 'current')).toBe(true);
    expect(await f.snapshot()).toEqual({ current: f.bytes, next: undefined, backup: undefined });
  });

  it.for(['', '{invalid', 'x'.repeat(128 * 1024)])('cold ' + kind + ' refuses malformed authoritative bytes %#', async (value, test) => {
    const f = await fixture(test, kind, { current: value, backup: 'valid' });
    const before = await f.snapshot(); await expect(f.inspect()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });
}

it.for(['sourceBytes', 'sourceIdentity', 'siblingIdentity', 'sideAppears', 'main', 'lease', 'foreign'] as const)(
  'refuses stale cold selection on %s before any repair', async (change, test) => {
    const f = await fixture(test, 'journal', { current: 'valid', next: '' }); const selection = await f.inspect();
    if (change === 'sourceBytes') await writeFile(f.path('current'), JSON.stringify({ ...journal, workspaceLabel: 'Changed synthetic' }));
    if (change === 'sourceIdentity' || change === 'siblingIdentity') {
      const slot = change === 'sourceIdentity' ? 'current' : 'next';
      await rename(f.path(slot), join(f.root, 'retained-original'));
      await writeFile(f.path(slot), slot === 'current' ? f.bytes : '', { flag: 'wx' });
    }
    if (change === 'sideAppears') await writeFile(f.path('backup'), f.bytes, { flag: 'wx' });
    if (change === 'main') f.state.current = false;
    if (change === 'lease') { await f.held.release(); await f.lease.acquire('import'); }
    if (change === 'foreign') f.state.external = false;
    const before = await f.snapshot(); await expect(f.store.recoverObservedSelection(selection, f.authority)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before); expect(f.notifications).toHaveBeenCalledTimes(1);
  },
);

it.for(['lease', 'targetIdentity'] as const)('checks %s inside the actual file mutation guard', async (change, test) => {
  const f = await fixture(test, 'journal', { current: 'valid', next: '' }); const selection = await f.inspect();
  const remove = f.fs.removeSlot.bind(f.fs); let reached = false;
  vi.spyOn(f.fs, 'removeSlot').mockImplementation(async (slot, guard) => remove(slot, {
    assertAuthority: () => guard!.assertAuthority(),
    async beforeMutation() {
      await guard!.beforeMutation(); reached = true;
      if (change === 'lease') { await f.held.release(); await f.lease.acquire('import'); }
      else { await rename(f.path(slot), join(f.root, 'retained-target')); await writeFile(f.path(slot), '', { flag: 'wx' }); }
    },
  }));
  await expect(f.store.recoverObservedSelection(selection, f.authority)).rejects.toThrow();
  expect(reached).toBe(true); expect(await f.snapshot()).toEqual({ current: f.bytes, next: Buffer.alloc(0), backup: undefined });
});

it.for(['move', 'remove', 'sync'] as const)('lost %s reply cannot be adopted by the same owner', async (step, test) => {
  const f = await fixture(test, 'journal', step === 'move' ? { backup: 'valid' } : { current: 'valid', next: '' });
  const selection = await f.inspect(); const failure = new Error('SYNTHETIC_REPLY_LOST');
  const move = f.fs.moveSlot.bind(f.fs);
  const remove = f.fs.removeSlot.bind(f.fs);
  const sync = f.fs.syncDirectory.bind(f.fs);
  const spy = step === 'move'
    ? vi.spyOn(f.fs, 'moveSlot').mockImplementationOnce(async (...args) => { await move(...args); throw failure; })
    : step === 'remove'
      ? vi.spyOn(f.fs, 'removeSlot').mockImplementationOnce(async (...args) => { await remove(...args); throw failure; })
      : vi.spyOn(f.fs, 'syncDirectory').mockImplementationOnce(async (...args) => { await sync(...args); throw failure; });
  await expect(f.store.recoverObservedSelection(selection, f.authority)).rejects.toThrow();
  expect(f.state.first?.error).toBe(failure); const retained = await f.snapshot(); spy.mockRestore();
  await expect(f.store.recoverObservedSelection(selection, f.authority)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(retained);
  await f.held.release(); const next = await fixture(test, 'journal', {}, { root: f.root, lease: f.lease });
  const observed = await next.inspect(); expect((await next.store.recoverObservedSelection(observed, next.authority)).value).toEqual(journal);
  await expect(f.inspect()).rejects.toThrow();
  expect(f.state.first?.error).toBe(failure);
});

it('joins an awaited read and refuses its late repair after authority loss', async test => {
  const f = await fixture(test, 'journal', { current: 'valid', next: '' }); const selected = await f.inspect();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const read = f.fs.readSlot.bind(f.fs);
  vi.spyOn(f.fs, 'readSlot').mockImplementationOnce(async (...args) => { const result = await read(...args); enter(); await gate; return result; });
  const remove = vi.spyOn(f.fs, 'removeSlot');
  const work = f.store.recoverObservedSelection(selected, f.authority); const failed = expect(work).rejects.toThrow();
  await entered; f.state.current = false; const before = await f.snapshot(); release(); await failed;
  expect(remove).not.toHaveBeenCalled(); expect(await f.snapshot()).toEqual(before);
});

it('captures supplied buffers and callbacks before the first await', async test => {
  const f = await fixture(test, 'journal', { current: 'valid', next: '' }); const observed = await f.inspect();
  const authority = { ...f.authority, async assertExternalSelection() {
    observed.bytes!.fill(0); authority.assertAuthority = () => { throw new Error('REPLACED_CALLBACK'); };
    authority.onUncertain = () => { throw new Error('REPLACED_NOTIFICATION'); };
  } };
  const result = await f.store.recoverObservedSelection(observed, authority);
  expect(result.value).toEqual(journal); expect(Buffer.from(result.bytes).equals(f.bytes)).toBe(true);
});

it.for(['directory', 'hardlink'] as const)('does not discard an unsafe %s sibling', async (kind, test) => {
  const f = await fixture(test, 'journal', { current: 'valid' });
  if (kind === 'directory') await mkdir(f.path('next'));
  else { await writeFile(join(f.root, 'other'), 'preserve'); await link(join(f.root, 'other'), f.path('next')); }
  await expect(f.inspect()).rejects.toThrow();
  expect((await readFile(f.path('current'))).equals(f.bytes)).toBe(true);
  if (kind === 'hardlink') expect((await readFile(join(f.root, 'other'))).toString()).toBe('preserve');
});

it('never substitutes an unguarded read when metadata observation is unsupported', async test => {
  const f = await fixture(test, 'journal', { current: 'valid', next: '' });
  const fs = { prepareDirectory: f.fs.prepareDirectory.bind(f.fs), readSlot: f.fs.readSlot.bind(f.fs),
    createNextWriter: f.fs.createNextWriter.bind(f.fs), moveSlot: f.fs.moveSlot.bind(f.fs),
    removeSlot: f.fs.removeSlot.bind(f.fs), syncDirectory: f.fs.syncDirectory.bind(f.fs) };
  const before = await f.snapshot(); await expect(new CrashSafeByteSlotStore(fs).inspectRecoverySelection(() => {})).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['inspect', 'recover'] as const)('rejects asynchronous ownership assertions during %s', async (step, test) => {
  const f = await fixture(test, 'journal', { current: 'valid', next: '' }); const selection = await f.inspect();
  const before = await f.snapshot();
  if (step === 'inspect') await expect(f.store.inspectRecoverySelection(async () => {})).rejects.toThrow();
  else await expect(f.store.recoverObservedSelection(selection, { ...f.authority, assertAuthority: async () => {} })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('keeps the first ownership failure when its uncertainty observer also fails', async test => {
  const f = await fixture(test, 'journal', { current: 'valid', next: '' }); const selection = await f.inspect();
  const first = new Error('SYNTHETIC_FIRST_FAILURE'); const before = await f.snapshot();
  await expect(f.store.recoverObservedSelection(selection, { ...f.authority,
    async assertExternalSelection() { throw first; },
    onUncertain(error) { f.authority.onUncertain(error); throw new Error('SYNTHETIC_OBSERVER_FAILURE'); },
  })).rejects.toThrow();
  expect(f.state.first?.error).toBe(first); expect(f.notifications).toHaveBeenCalledExactlyOnceWith(first);
  expect(await f.snapshot()).toEqual(before);
});
