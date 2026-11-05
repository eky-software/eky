import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import { captureWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import * as inventoryFiles from './workspaceDeletionInventoryFile.js';
import * as inventoryRetirement from './workspaceDeletionInventoryRetirement.js';
import type { WorkspaceDeletionInventoryRetirementReadSelection } from './workspaceDeletionInventoryRetirement.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';

type TerminalMutation = 'inventoryRemove' | 'inventorySync' | 'operationRmdir' | 'parentSync';
interface TerminalReadHooks {
  onFull?(): void | Promise<void>;
  onRead?(): void | Promise<void>;
  beforeInspect?(): void | Promise<void>;
  afterInspect?(): void | Promise<void>;
  beforeMutation?(name: Exclude<TerminalMutation, 'operationRmdir'>): void | Promise<void>;
}

async function terminalReadFixture(test: TestContext) {
  const stats = { full: 0, read: 0, fullInside: 0, mutations: [] as TerminalMutation[] };

  const f = await fixture(test, true);
  const terminal = captureWorkspaceDeletionJournal({ ...f.journal, phase: 'registryPublished' });
  const first = new Error('SYNTHETIC_TERMINAL_CONTENT_CHANGED'), writer = new Error('SYNTHETIC_TERMINAL_WRITER_RETURNED');
  const local = new Error('SYNTHETIC_TERMINAL_REGISTRY_CHANGED');
  let stable = true, writersAbsent = true, inside = false, lastMutationFull = 0;
  let capturedRead: (() => Promise<void>) | undefined;
  const hooks: TerminalReadHooks = {};
  const checkLocal = async () => {
    f.authority.assertCurrent();
    if (!writersAbsent) throw writer;
    if (!Buffer.from(await readFile(f.registryPath)).equals(Buffer.from(serializeWorkspaceRegistry(f.after)))) throw local;
    f.authority.assertCurrent();
  };
  const authority = { assertAuthority: f.authority.assertCurrent, async assertExternalSelection() {
    stats.full++; if (inside) stats.fullInside++;
    await hooks.onFull?.(); await checkLocal(); if (!stable) throw first;
  } };
  const port: WorkspaceDeletionInventoryRetirementReadSelection = { async assertExternalSelection() {
    expect(this).toBe(port); stats.read++; await hooks.onRead?.(); await checkLocal();
  } };
  const originalInspect = WorkspaceDeletionInventoryStore.prototype.inspect;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'inspect').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
    capturedRead = args[1].assertExternalSelection;
    inside = true;
    try { await hooks.beforeInspect?.(); const result = await originalInspect.apply(this, args); await hooks.afterInspect?.(); return result; }
    finally { inside = false; }
  });
  const inventory = createNodeCrashSafeFileSlotFileSystem(f.inventoryPaths, Number.MAX_SAFE_INTEGER);
  const parent = createNodeCrashSafeFileSlotFileSystem({ ...f.inventoryPaths, directoryPath: f.inventoryPaths.parentPath }, 1);
  const remove = inventory.removeSlot.bind(inventory), sync = inventory.syncDirectory.bind(inventory), parentSync = parent.syncDirectory.bind(parent);
  const mutate = async <T>(name: Exclude<TerminalMutation, 'operationRmdir'>, work: () => Promise<T>): Promise<T> => {
    const before = stats.full; await hooks.beforeMutation?.(name); const result = await work();
    expect(stats.full).toBeGreaterThan(before); lastMutationFull = stats.full; stats.mutations.push(name); return result;
  };
  inventory.removeSlot = (...args) => mutate('inventoryRemove', () => remove(...args));
  inventory.syncDirectory = (...args) => mutate('inventorySync', () => sync(...args));
  parent.syncDirectory = (...args) => mutate('parentSync', () => parentSync(...args));
  const directories = { ...inventoryFiles.workspaceDeletionInventoryDirectoryReads };
  const fileSystems = { directories, inventory, parent, async removeDirectory(path: string) {
    expect(stats.full).toBeGreaterThan(lastMutationFull); lastMutationFull = stats.full; await rmdir(path); stats.mutations.push('operationRmdir');
  } };
  return { f, terminal, stats, hooks, authority, port, first, writer, local, directories,
    setStable(value: boolean) { stable = value; }, returnWriter() { writersAbsent = false; },
    capturedRead() { return capturedRead; },
    run(...selection: [] | [unknown]) {
      const selected = selection.length === 0 ? port : selection[0];
      const work = inventoryRetirement.retireWorkspaceDeletionInventory(f.root, terminal, authority, fileSystems, selected as WorkspaceDeletionInventoryRetirementReadSelection | undefined);
      return f.track(work);
    },
    async preserved() {
      expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
      expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
      expect(stats.mutations).toEqual([]); await f.preserved();
    },
  };
}

it.for([false, true])('preserves complete native retirement (scoped: %s)', async (scoped, test) => {
  const t = await terminalReadFixture(test);
  await t.run(scoped ? t.port : undefined);
  expect(t.stats.mutations).toEqual(['inventoryRemove', 'inventorySync', 'operationRmdir', 'parentSync']);
  expect(t.stats.read > 0).toBe(scoped);
  expect(t.stats.fullInside > 0).toBe(!scoped);
  await expect(readdir(t.f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes); await t.f.preserved();
  if (scoped) { const read = t.capturedRead(); if (read === undefined) throw new Error('SYNTHETIC_TERMINAL_READ_REQUIRED'); await expect(read()).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID'); }
});

it.for([false, true])('distinguishes the modeled restored metadata window (scoped: %s)', async (scoped, test) => {
  const t = await terminalReadFixture(test);
  t.hooks.beforeInspect = () => t.setStable(false); t.hooks.afterInspect = () => t.setStable(true);
  if (scoped) { await t.run(); expect(t.stats.fullInside).toBe(0); await t.f.preserved(); }
  else { await expect(t.run(undefined)).rejects.toBe(t.first); await t.preserved(); }
});

it('rejects sustained metadata before the first removal', async test => {
  const t = await terminalReadFixture(test); t.hooks.afterInspect = () => t.setStable(false);
  await expect(t.run()).rejects.toBe(t.first); await t.preserved();
});

it.for(['writer', 'registry', 'journalIdentity', 'inventoryBytes', 'inventoryIdentity'] as const)(
  'retains native evidence after %s changes during the read', async (kind, test) => {
    const t = await terminalReadFixture(test); let attacked = false;
    t.hooks.beforeInspect = async () => {
      attacked = true;
      if (kind === 'writer') t.returnWriter();
      if (kind === 'registry') await writeFile(t.f.registryPath, serializeWorkspaceRegistry({ ...t.f.after,
        workspaces: t.f.after.workspaces.map(row => ({ ...row, workspaceLabel: 'Changed synthetic selection' })) }));
      if (kind === 'journalIdentity') { await rename(t.f.journalPaths.currentPath, join(t.f.root, 'retained-original-journal')); await writeFile(t.f.journalPaths.currentPath, t.f.journalBytes, { flag: 'wx' }); }
      if (kind === 'inventoryBytes') { const bytes = Buffer.from(t.f.inventoryBytes); bytes[0] = 33; await writeFile(t.f.inventoryPaths.currentPath, bytes); }
      if (kind === 'inventoryIdentity') { await rename(t.f.inventoryPaths.currentPath, join(t.f.root, 'retained-original-inventory')); await writeFile(t.f.inventoryPaths.currentPath, t.f.inventoryBytes, { flag: 'wx' }); }
    };
    await expect(t.run()).rejects.toThrow(); expect(attacked).toBe(true); expect(t.stats.mutations).toEqual([]);
    expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes);
    if (kind !== 'inventoryBytes') expect(await readFile(t.f.inventoryPaths.currentPath)).toEqual(t.f.inventoryBytes);
    if (kind !== 'registry') await t.f.preserved();
    else {
      expect(await readFile(join(deriveWorkspaceRoot(t.f.root, t.f.before.workspaces[0]!.workspaceId, 1).workspaceRoot, 'kept'), 'utf8')).toBe('other company');
      expect(await readFile(join(t.f.root, 'user-export.ekybackup'), 'utf8')).toBe('external backup');
    }
  });

it.for([null, {}, { assertExternalSelection: false }, { assertExternalSelection() {}, extra: true }] as const)(
  'rejects malformed explicit context %# before guard work', async (invalid, test) => {
    const t = await terminalReadFixture(test);
    await expect(t.run(invalid)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(t.stats.full).toBe(0); expect(t.stats.read).toBe(0); await t.preserved();
  });

it('captures the narrow method before the first await', async test => {
  const t = await terminalReadFixture(test); let changed = false;
  t.hooks.onFull = () => { if (!changed) { changed = true; t.port.assertExternalSelection = async () => { throw new Error('SYNTHETIC_LATE_METHOD'); }; } };
  await t.run(); expect(changed).toBe(true); expect(t.stats.read).toBeGreaterThan(0); await t.f.preserved();
});

it('rejects nonvoid narrow work without removing evidence', async test => {
  const t = await terminalReadFixture(test);
  await expect(t.run({ async assertExternalSelection() { return false; } })).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  await t.preserved();
});

it('joins pending narrow work before returning owner loss', async test => {
  const t = await terminalReadFixture(test);
  let enter!: () => void, release!: () => void;
  let held = true, settled = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  t.f.releases.push(release);
  t.hooks.onRead = async () => { if (held) { held = false; enter(); await gate; } };
  const outcome = t.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try { await entered; t.f.revoke(); await setImmediate(); expect(settled).toBe(false); }
  finally { release(); await outcome; }
  expect(await outcome).toBe(t.f.first); await t.preserved();
});

it.for(['inventoryRemove', 'inventorySync', 'parentSync'] as const)(
  'keeps full guards at actual %s after scoped reading', async (boundary, test) => {
    const t = await terminalReadFixture(test); let observed: unknown; let injected = false;
    const full = t.authority.assertExternalSelection;
    t.authority.assertExternalSelection = async () => { try { await full(); } catch (cause) { observed = cause; throw cause; } };
    t.hooks.beforeMutation = name => { if (name === boundary) { injected = true; t.setStable(false); } };
    await expect(t.run()).rejects.toThrow(); expect(injected).toBe(true); expect(observed).toBe(t.first);
    expect(t.stats.mutations).not.toContain(boundary);
    expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes);
    if (boundary === 'inventoryRemove') expect(await readFile(t.f.inventoryPaths.currentPath)).toEqual(t.f.inventoryBytes);
    else await expect(readFile(t.f.inventoryPaths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await t.f.preserved();
  });

it.for(['read', 'close'] as const)('joins the real open inventory handle during pending %s', async (boundary, test) => {
  const t = await terminalReadFixture(test), files = await import('./workspaceDeletionInventoryFile.js');
  const original = files.openWorkspaceDeletionInventoryFile;
  let enter!: () => void, release!: () => void;
  let held = true, settled = false, opened = 0, closed = 0;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  t.f.releases.push(release);
  vi.spyOn(files, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await original(...args);
    if (args[0] !== t.f.inventoryPaths.currentPath || args[1] !== 'r') return file;
    opened++;
    const wait = async (phase: 'read' | 'close') => { if (boundary === phase && held) { held = false; enter(); await gate; } };
    return { ...file,
      async read(...values) { await wait('read'); return file.read(...values); },
      async close() { await wait('close'); await file.close(); closed++; },
    };
  });
  const outcome = t.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, outcome.then(() => { throw new Error('SYNTHETIC_REAL_IO_NOT_ENTERED'); })]);
    expect(opened).toBe(1); expect(closed).toBe(0); t.f.revoke(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await outcome; }
  expect(await outcome).toBe(t.f.first); expect(closed).toBe(opened); await t.preserved();
});

it('rejects full-proof loss at the operation rmdir guard without removing the empty root', async test => {
  const t = await terminalReadFixture(test), identity = t.directories.identity;
  let reached = false, rootsAfterSync = 0;
  vi.spyOn(t.directories, 'identity').mockImplementation(async (...args) => {
    const result = await identity(...args);
    // After inventory sync: names-read root, then the rmdir guard's root.
    if (args[0] === t.f.inventoryPaths.directoryPath && t.stats.mutations.at(-1) === 'inventorySync' && ++rootsAfterSync === 2) {
      reached = true; t.setStable(false);
    }
    return result;
  });
  await expect(t.run()).rejects.toBe(t.first);
  expect(reached).toBe(true);
  expect(t.stats.mutations).toEqual(['inventoryRemove', 'inventorySync']);
  expect(await readdir(t.f.inventoryPaths.directoryPath)).toEqual([]);
  expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes);
  await t.f.preserved();
});

it.for([false, true])('characterizes modeled metadata restored within names reading (scoped: %s)', async (scoped, test) => {
  const t = await terminalReadFixture(test), identity = t.directories.identity, names = t.directories.names;
  let roots = 0, changed = false;
  vi.spyOn(t.directories, 'identity').mockImplementation(async (...args) => {
    const result = await identity(...args);
    if (args[0] === t.f.inventoryPaths.directoryPath && ++roots === 2) { changed = true; t.setStable(false); }
    return result;
  });
  vi.spyOn(t.directories, 'names').mockImplementation(async (...args) => {
    const result = await names(...args); t.setStable(true); return result;
  });
  await t.run(scoped ? t.port : undefined); expect(changed).toBe(true);
  expect(t.stats.mutations).toEqual(['inventoryRemove', 'inventorySync', 'operationRmdir', 'parentSync']);
  // Visibility only: actual file identities were never restored or reconstructed.
  await t.f.preserved();
});

it('rejects sustained names-read changes before subsequent inventory inspection', async test => {
  const t = await terminalReadFixture(test), names = t.directories.names, inspect = inventoryFiles.inspectDeletionInventoryFile;
  let changed = false, inspectedAfterNames = false;
  vi.spyOn(inventoryFiles, 'inspectDeletionInventoryFile').mockImplementation((...args) => {
    if (changed) inspectedAfterNames = true; return inspect(...args);
  });
  vi.spyOn(t.directories, 'names').mockImplementation(async (...args) => {
    const result = await names(...args); changed = true; t.setStable(false); return result;
  });
  await expect(t.run()).rejects.toBe(t.first);
  expect(changed).toBe(true); expect(inspectedAfterNames).toBe(false); await t.preserved();
});

it('isolates directory identity protection after reading empty inventory names', async test => {
  const t = await terminalReadFixture(test), names = t.directories.names;
  await unlink(t.f.inventoryPaths.currentPath);
  const retained = join(t.f.root, 'retained-inventory-directory'); let changed = false;
  vi.spyOn(t.directories, 'names').mockImplementation(async (...args) => {
    const result = await names(...args);
    if (!changed) {
      changed = true; await rename(t.f.inventoryPaths.directoryPath, retained);
      await mkdir(t.f.inventoryPaths.directoryPath, { mode: 0o700 });
    }
    return result;
  });
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID'); expect(changed).toBe(true);
  expect(await readdir(retained)).toEqual([]); expect(await readdir(t.f.inventoryPaths.directoryPath)).toEqual([]);
  expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes);
  expect(t.stats.mutations).toEqual([]); await t.f.preserved();
});

it('names reading never reactivates an expired inventory callback', async test => {
  const t = await terminalReadFixture(test), names = t.directories.names;
  let replayed = 0;
  vi.spyOn(t.directories, 'names').mockImplementation(async (...args) => {
    const stale = t.capturedRead();
    if (stale !== undefined) {
      const before = t.stats.read;
      await expect(stale()).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
      expect(t.stats.read).toBe(before); replayed++;
    }
    return names(...args);
  });
  await t.run(); expect(replayed).toBe(2); await t.f.preserved();
});

it('names reading joins pending real names work before owner revocation settles', async test => {
  const t = await terminalReadFixture(test), names = t.directories.names;
  let enter!: () => void, release!: () => void, held = true, settled = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  t.f.releases.push(release);
  vi.spyOn(t.directories, 'names').mockImplementation(async (...args) => {
    const result = await names(...args);
    if (held) { held = false; enter(); await gate; }
    return result;
  });
  const outcome = t.run().then(() => { settled = true; return { ok: true }; }, error => { settled = true; return { ok: false, error }; });
  try {
    await Promise.race([entered, outcome.then(() => { throw new Error('SYNTHETIC_NAMES_NOT_HELD'); })]);
    t.f.revoke(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await outcome; }
  const result = await outcome; expect(result.ok).toBe(false);
  if (!('error' in result)) throw new Error('SYNTHETIC_NAMES_REJECTION_REQUIRED'); expect(result.error).toBe(t.f.first);
  await t.preserved();
});

it.for(['error', 'undefined'] as const)('names reading preserves first %s before later authority failure', async (kind, test) => {
  const t = await terminalReadFixture(test), names = t.directories.names;
  const first = kind === 'error' ? new Error('SYNTHETIC_NAMES_READ_FIRST') : undefined; let reached = false;
  vi.spyOn(t.directories, 'names').mockImplementationOnce(async (...args) => {
    await names(...args); reached = true; t.f.revoke(); throw first;
  });
  const result = await t.run().then(() => ({ ok: true }), error => ({ ok: false, error }));
  expect(result.ok).toBe(false); expect(reached).toBe(true);
  if (!('error' in result)) throw new Error('SYNTHETIC_NAMES_REJECTION_REQUIRED'); expect(result.error).toBe(first);
  await t.preserved();
});

it.for([1, 2, 3])('names reading retains full suffix after names group %s', async (group, test) => {
  const t = await terminalReadFixture(test), names = t.directories.names; let count = 0;
  vi.spyOn(t.directories, 'names').mockImplementation(async (...args) => {
    const result = await names(...args); if (++count === group) t.setStable(false); return result;
  });
  await expect(t.run()).rejects.toBe(t.first); expect(count).toBe(group);
  expect(t.stats.mutations).toEqual(group === 3 ? ['inventoryRemove', 'inventorySync'] : []);
  expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes);
  if (group < 3) expect(await readFile(t.f.inventoryPaths.currentPath)).toEqual(t.f.inventoryBytes);
  else expect(await readdir(t.f.inventoryPaths.directoryPath)).toEqual([]);
  await t.f.preserved();
});

it.for([1, 2, 3])('names reading full suffix precedes the next boundary (group: %s)', async (group, test) => {
  const t = await terminalReadFixture(test), names = t.directories.names;
  const identity = t.directories.identity, inspect = inventoryFiles.inspectDeletionInventoryFile;
  let count = 0, pending = false, observed = false, full = 0;
  t.hooks.onFull = () => { if (pending) full++; };
  const probe = () => {
    expect(full).toBe(group === 3 ? 4 : 2); observed = true; pending = false;
  };
  vi.spyOn(t.directories, 'names').mockImplementation(async (...args) => {
    const result = await names(...args); if (++count === group) pending = true; return result;
  });
  vi.spyOn(inventoryFiles, 'inspectDeletionInventoryFile').mockImplementation((...args) => {
    if (pending && group < 3 && args[0] === t.f.inventoryPaths.currentPath) probe();
    return inspect(...args);
  });
  vi.spyOn(t.directories, 'identity').mockImplementation((...args) => {
    if (pending && group === 3 && args[0] === t.f.inventoryPaths.parentPath) probe();
    return identity(...args);
  });
  await t.run(); expect(observed).toBe(true);
  expect(t.stats.mutations).toEqual(['inventoryRemove', 'inventorySync', 'operationRmdir', 'parentSync']);
  expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes); await t.f.preserved();
});

for (const scoped of [false, true]) it.for([1, 2])(`names prefix observation window is explicit (scoped: ${scoped}, group: %s)`, async (group, test) => {
  const t = await terminalReadFixture(test), names = t.directories.names;
  let insideRemoval = false, mutationFull = 0, changed = false, restored = false;
  t.hooks.beforeMutation = name => { if (name === 'inventoryRemove') insideRemoval = true; };
  t.hooks.onFull = () => {
    if (insideRemoval) mutationFull++;
    // Four external rounds belong to the retained leading terminal/root guard.
    if (!changed && (group === 1 ? t.stats.full === 5 : insideRemoval && mutationFull === 5)) {
      changed = true; t.setStable(false);
    }
  };
  t.hooks.onRead = () => {
    if (!changed && (group === 1 || insideRemoval)) { changed = true; t.setStable(false); }
  };
  vi.spyOn(t.directories, 'names').mockImplementation(async (...args) => {
    const result = await names(...args);
    if (changed) { t.setStable(true); restored = true; }
    return result;
  });
  if (scoped) {
    await t.run(); expect(restored).toBe(true);
    expect(t.stats.mutations).toEqual(['inventoryRemove', 'inventorySync', 'operationRmdir', 'parentSync']);
  } else { await expect(t.run(undefined)).rejects.toBe(t.first); expect(restored).toBe(false); await t.preserved(); }
  expect(changed).toBe(true); expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes); await t.f.preserved();
});
