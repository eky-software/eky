import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readDeletionInventoryDirectoryIdentity, workspaceDeletionInventoryDirectoryReads } from './workspaceDeletionInventoryFile.js';
import { assertWorkspaceDeletionInventoryRetired, retireWorkspaceDeletionInventory } from './workspaceDeletionInventoryRetirement.js';
import { deletionInventoryRetirementFixture as fixture } from './workspaceDeletionInventoryStoreTestSupport.js';

vi.mock('./workspaceDeletionInventoryFile.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./workspaceDeletionInventoryFile.js')>();
  return { ...actual, workspaceDeletionInventoryDirectoryReads: {
    ...actual.workspaceDeletionInventoryDirectoryReads,
    identity: vi.fn(actual.workspaceDeletionInventoryDirectoryReads.identity),
  } };
});

const identity = vi.mocked(workspaceDeletionInventoryDirectoryReads.identity);
beforeEach(() => { identity.mockImplementation(readDeletionInventoryDirectoryIdentity); });
afterEach(() => { identity.mockReset(); vi.restoreAllMocks(); });

for (const operation of ['retire', 'assertRetired'] as const) {
  for (const kind of ['error', 'undefined'] as const) {
    it(`preserves first ${kind} identity rejection before later authority loss in ${operation}`, async context => {
      const f = await fixture(context), before = await f.snapshot();
      const journal = await readFile(f.journalPaths.currentPath);
      const first = kind === 'error' ? Object.assign(new Error('SYNTHETIC_TERMINAL_IDENTITY_READ'), { code: 'EACCES' }) : undefined;
      let reached = false;
      identity.mockImplementation(async (path, assertCurrent) => {
        if (path === f.paths.directoryPath) { reached = true; f.expire(); throw first; }
        return readDeletionInventoryDirectoryIdentity(path, assertCurrent);
      });
      const remove = vi.spyOn(f.fileSystem, 'removeSlot');
      const work = operation === 'retire'
        ? retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { inventory: f.fileSystem })
        : assertWorkspaceDeletionInventoryRetired(f.root, f.expected, f.authority);
      await expect(work).rejects.toBe(first);
      expect(reached).toBe(true); expect(remove).not.toHaveBeenCalled();
      expect(await f.snapshot()).toEqual(before);
      expect(await readFile(f.journalPaths.currentPath)).toEqual(journal);
    });
  }

  it(`rejects expected identity absence after authority loss in ${operation}`, async context => {
    const f = await fixture(context), before = await f.snapshot();
    const journal = await readFile(f.journalPaths.currentPath);
    let reached = false;
    identity.mockImplementation(async (path, assertCurrent) => {
      if (path === f.paths.directoryPath) {
        reached = true; f.expire();
        throw Object.assign(new Error('SYNTHETIC_EXPECTED_ABSENCE'), { code: 'ENOENT' });
      }
      return readDeletionInventoryDirectoryIdentity(path, assertCurrent);
    });
    const work = operation === 'retire'
      ? retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { inventory: f.fileSystem })
      : assertWorkspaceDeletionInventoryRetired(f.root, f.expected, f.authority);
    await expect(work).rejects.toThrow('SYNTHETIC_LEASE_LOST');
    expect(reached).toBe(true);
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(journal);
  });

  it(`checks revoked authority before starting identity work in ${operation}`, async context => {
    const f = await fixture(context), before = await f.snapshot();
    identity.mockClear(); f.expire();
    const work = operation === 'retire'
      ? retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { inventory: f.fileSystem })
      : assertWorkspaceDeletionInventoryRetired(f.root, f.expected, f.authority);
    await expect(work).rejects.toThrow('SYNTHETIC_LEASE_LOST');
    expect(identity).not.toHaveBeenCalled(); expect(await f.snapshot()).toEqual(before);
  });

  it(`joins a held identity rejection before settling after authority loss in ${operation}`, async context => {
    const f = await fixture(context), before = await f.snapshot();
    const journal = await readFile(f.journalPaths.currentPath);
    const first = Object.assign(new Error('SYNTHETIC_HELD_TERMINAL_IDENTITY_READ'), { code: 'EIO' });
    let entered!: () => void, rejectRead!: (error: unknown) => void, settled = false;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<string>((_resolve, reject) => { rejectRead = reject; });
    void held.catch(() => undefined);
    identity.mockImplementation(async (path, assertCurrent) => {
      if (path === f.paths.directoryPath) { entered(); return held; }
      return readDeletionInventoryDirectoryIdentity(path, assertCurrent);
    });
    const remove = vi.spyOn(f.fileSystem, 'removeSlot');
    const work = operation === 'retire'
      ? retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { inventory: f.fileSystem })
      : assertWorkspaceDeletionInventoryRetired(f.root, f.expected, f.authority);
    const outcome = work.then(() => ({ status: 'completed' as const }), error => ({ status: 'failed' as const, error }));
    void outcome.then(() => { settled = true; });
    try {
      await Promise.race([entering, outcome.then(() => { throw new Error('SYNTHETIC_IDENTITY_HOLD_NOT_REACHED'); })]);
      f.expire(); await Promise.resolve();
      expect(settled).toBe(false); expect(remove).not.toHaveBeenCalled();
      rejectRead(first);
      expect(await outcome).toEqual({ status: 'failed', error: first });
      expect((await outcome as { error: unknown }).error).toBe(first);
    } finally { rejectRead(first); await outcome; }
    expect(remove).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(journal);
  });
}

it('does not replace disallowed ENOENT with later authority loss during retirement', async context => {
  const f = await fixture(context), before = await f.snapshot();
  const journal = await readFile(f.journalPaths.currentPath);
  const first = Object.assign(new Error('SYNTHETIC_REQUIRED_DIRECTORY_MISSING'), { code: 'ENOENT' });
  let targetReads = 0;
  identity.mockImplementation(async (path, assertCurrent) => {
    if (path === f.paths.directoryPath && ++targetReads === 2) { f.expire(); throw first; }
    return readDeletionInventoryDirectoryIdentity(path, assertCurrent);
  });
  const remove = vi.spyOn(f.fileSystem, 'removeSlot');
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { inventory: f.fileSystem })).rejects.toBe(first);
  expect(targetReads).toBe(2); expect(remove).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(journal);
});

it.for(['error', 'undefined', 'held'] as const)(
  'preserves the first identity rejection inside the native removal guard (%s)', async (kind, context) => {
    const f = await fixture(context), before = await f.snapshot(), journal = await readFile(f.journalPaths.currentPath);
    const first = kind === 'undefined' ? undefined : Object.assign(new Error('SYNTHETIC_NATIVE_GUARD_IDENTITY_READ'), { code: 'EIO' });
    let insideRemoval = false, reached = false, settled = false;
    let enter!: () => void, rejectRead!: (cause: unknown) => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<string>((_resolve, reject) => { rejectRead = reject; });
    void held.catch(() => undefined);
    const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
    const removing = vi.spyOn(f.fileSystem, 'removeSlot').mockImplementation(async (...args) => {
      insideRemoval = true;
      try { return await remove(...args); } finally { insideRemoval = false; }
    });
    identity.mockImplementation(async (path, assertCurrent) => {
      if (insideRemoval && path === f.paths.directoryPath) {
        reached = true; enter();
        if (kind === 'held') return held;
        throw first;
      }
      return readDeletionInventoryDirectoryIdentity(path, assertCurrent);
    });
    const outcome = retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { inventory: f.fileSystem })
      .then(() => { settled = true; return { status: 'completed' as const }; }, error => {
        settled = true; return { status: 'failed' as const, error };
      });
    try {
      await Promise.race([entered, outcome.then(() => { throw new Error('SYNTHETIC_NATIVE_GUARD_NOT_REACHED'); })]);
      if (kind === 'held') {
        f.expire(); await Promise.resolve(); expect(settled).toBe(false); rejectRead(first);
      }
      const result = await outcome;
      expect(result.status).toBe('failed');
      expect((result as { error: unknown }).error).toBe(first);
    } finally { rejectRead(first); await outcome; }
    expect(reached).toBe(true); expect(removing).toHaveBeenCalledOnce();
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(journal);
  });
