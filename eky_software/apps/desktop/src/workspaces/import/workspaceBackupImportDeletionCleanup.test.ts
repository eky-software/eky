import { CrashSafeByteSlotStore, type CrashSafeByteSlotReadSelection } from '../persistence/crashSafeByteSlotStore.js';
import type { FileHandle } from 'node:fs/promises';
import { open as openRetirementHandle } from 'node:fs/promises';
import type { CrashSafeFileSlotMutationGuard as RetirementMutationGuard } from '../persistence/crashSafeFileSlot.js';
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

type ImportDeletionReadFixture = Awaited<ReturnType<typeof fixture>>;

function useDeletionReadSelection(f: ImportDeletionReadFixture, port: CrashSafeByteSlotReadSelection) {
  const method = f.store.clearAfterDeletionPurged;
  return vi.spyOn(f.store, 'clearAfterDeletionPurged').mockImplementation(function (
    this: WorkspaceBackupImportJournalStore, value, selection,
  ) { return method.call(this, value, selection, port); });
}

it('original journal read selection preserves default E and substitutes only before-read R in every real native round', async test => {
  for (const explicit of [false, true]) {
    const f = await retirementFixture(test);
    await f.put('backup', journal('prepared')); await f.put('current', journal('candidateRootCreated'));
    const selected = await f.select(), trace: string[] = [], completed: string[] = [];
    const read = f.fs.readSlot.bind(f.fs), remove = f.fs.removeSlot.bind(f.fs), sync = f.fs.syncDirectory.bind(f.fs);
    f.external.mockImplementation(async () => { trace.push('E'); });
    f.purged.mockImplementation(async () => { trace.push('P'); });
    if (explicit) useDeletionReadSelection(f, { async assertBeforeSlotRead() { trace.push('R'); } });
    f.fs.readSlot = async (...args) => { trace.push(`S:${args[0]}`); return read(...args); };
    const round = [explicit ? 'R' : 'E', 'S:current', 'S:next', 'S:backup', 'E', 'P', 'E'];
    const tagged = (guard: RetirementMutationGuard | undefined, name: string): RetirementMutationGuard => {
      expect(guard).toBeDefined();
      return { assertAuthority: guard!.assertAuthority.bind(guard), async beforeMutation() {
        const start = trace.length; await guard!.beforeMutation();
        expect(trace.slice(start)).toEqual(round); completed.push(name);
      } };
    };
    f.fs.removeSlot = async (slot, guard) => remove(slot, tagged(guard, `remove:${slot}`));
    f.fs.syncDirectory = async guard => sync(tagged(guard, 'sync'));
    await f.clear(selected);
    expect(trace).toEqual(Array.from({ length: 5 }, () => round).flat());
    expect(completed).toEqual(['remove:backup', 'remove:current', 'sync']);
    expect(f.onUncertain).not.toHaveBeenCalled(); await f.assertEmpty();
  }
});

it.for(['remove', 'sync'] as const)('original journal read selection never replaces last E-P-E at native %s', async (boundary, test) => {
  for (const failure of ['E', 'P', 'lastE'] as const) {
    const f = await retirementFixture(test);
    if (boundary === 'remove') await f.put('current', journal('prepared'));
    const selected = await f.select(), before = await f.snapshot();
    useDeletionReadSelection(f, { async assertBeforeSlotRead() {} });
    let reached = false, completed = false, directoryOpens = 0;
    retirementNativeHandles.hook = (file, path) => { if (String(path) === f.root) directoryOpens++; return file; };
    const inject = () => {
      reached = true;
      if (failure === 'E') f.state.external = false;
      else if (failure === 'P') f.state.purged = false;
      else f.purged.mockImplementationOnce(async () => { f.state.external = false; });
    };
    if (boundary === 'remove') {
      const remove = f.fs.removeSlot.bind(f.fs);
      f.fs.removeSlot = async (...args) => { inject(); const result = await remove(...args); completed = true; return result; };
    } else {
      const sync = f.fs.syncDirectory.bind(f.fs);
      f.fs.syncDirectory = async (...args) => { inject(); await sync(...args); completed = true; };
    }
    await expect(f.clear(selected)).rejects.toThrow(unavailable);
    expect(reached).toBe(true); expect(completed).toBe(false); expect(directoryOpens).toBe(0);
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(failure === 'P' ? f.purgedError : f.externalError);
    expect(await f.snapshot()).toEqual(before);
    expect((await f.select()).expectedIdentities).toEqual(selected.expectedIdentities);
    retirementNativeHandles.hook = undefined;
  }
});

it.for(['error', 'undefined'] as const)('original journal read selection keeps %s before owner, actual owned close and notification faults', async (kind, test) => {
  const f = await retirementFixture(test); await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot();
  const first = kind === 'error' ? new Error('SYNTHETIC_W75_READ_FIRST') : undefined;
  const read = vi.fn(async (): Promise<void> => undefined), remove = f.fs.removeSlot.bind(f.fs);
  useDeletionReadSelection(f, { assertBeforeSlotRead: read });
  let reached = false, closed = 0;
  f.fs.removeSlot = async (...args) => {
    const owned = await openRetirementHandle(f.paths.currentPath, 'r');
    read.mockImplementationOnce(async () => { reached = true; f.state.current = false; throw first; });
    try { return await remove(...args); }
    finally { await owned.close(); closed++; throw new Error('SYNTHETIC_W75_LATER_CLOSE'); }
  };
  f.onUncertain.mockImplementationOnce(() => { throw new Error('SYNTHETIC_W75_LATER_NOTIFICATION'); });
  await expect(f.clear(selected)).rejects.toThrow(unavailable);
  expect(reached).toBe(true); expect(closed).toBe(1);
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
  expect(await f.snapshot()).toEqual(before);
  f.state.current = true;
  expect((await f.select()).expectedIdentities).toEqual(selected.expectedIdentities);
});

it('original journal read selection rejects invalid ports and sync/async nonvoid results before slot I/O', async test => {
  const inputs: unknown[] = [null, 1, {}, { assertBeforeSlotRead: 1 },
    { assertBeforeSlotRead() { return false; } }, { async assertBeforeSlotRead() { return null; } }];
  for (const input of inputs) {
    const f = await retirementFixture(test); await f.put('current', journal('prepared'));
    const selected = await f.select(), before = await f.snapshot();
    const read = vi.spyOn(f.fs, 'readSlot'), remove = vi.spyOn(f.fs, 'removeSlot'), sync = vi.spyOn(f.fs, 'syncDirectory');
    useDeletionReadSelection(f, input as CrashSafeByteSlotReadSelection);
    await expect(f.clear(selected)).rejects.toThrow(invalid);
    expect(read).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled();
    expect(f.onUncertain).toHaveBeenCalledOnce(); expect(await f.snapshot()).toEqual(before);
    expect((await f.select()).expectedIdentities).toEqual(selected.expectedIdentities);
  }
});

it('original journal read selection captures its getter once before authority/await and binds the original receiver', async test => {
  const f = await retirementFixture(test); await f.put('current', journal('prepared'));
  const selected = await f.select(), entered = deferredRetirement(), held = deferredRetirement();
  f.releases.push(held.release);
  let gets = 0;
  const replacement = vi.fn(async () => { throw new Error('SYNTHETIC_W75_REPLACED_READ'); });
  const captured = vi.fn(async function (this: CrashSafeByteSlotReadSelection) {
    expect(this).toBe(port); entered.release(); await held.promise;
  });
  const port = Object.defineProperty({}, 'assertBeforeSlotRead', { configurable: true,
    get() { gets++; return gets === 1 ? captured : replacement; } }) as CrashSafeByteSlotReadSelection;
  const authority = selected.assertAuthority;
  selected.assertAuthority = () => {
    expect(gets).toBe(1); authority();
    Object.defineProperty(port, 'assertBeforeSlotRead', { configurable: true, value: replacement });
  };
  useDeletionReadSelection(f, port);
  const result = f.clear(selected);
  try {
    await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_W75_READ_NOT_ENTERED'); })]);
  } finally { held.release(); await result; }
  expect(gets).toBe(1); expect(captured.mock.calls.length).toBeGreaterThan(1);
  expect(replacement).not.toHaveBeenCalled(); await f.assertEmpty();
});

it('original journal read selection joins a held callback after revocation and excludes concurrent clear/inspection', async test => {
  const f = await retirementFixture(test); await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot(), entered = deferredRetirement(), held = deferredRetirement();
  f.releases.push(held.release);
  const read = vi.spyOn(f.fs, 'readSlot');
  const supplied = vi.fn(async () => { entered.release(); await held.promise; });
  useDeletionReadSelection(f, { assertBeforeSlotRead: supplied });
  let settled = false;
  const result = f.clear(selected).then(() => { settled = true; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_W75_READ_NOT_HELD'); })]);
    f.state.current = false; await setImmediate(); expect(settled).toBe(false);
    await expect(f.clear(selected)).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY');
    await expect(f.store.inspectSlots()).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY');
  } finally { held.release(); await result; }
  expect(await result).toMatchObject({ message: unavailable });
  expect(supplied).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.ownerError);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['success', 'failure'] as const)('original journal read selection expires the byte-store callback after %s and throughout a new operation', async (outcome, test) => {
  const f = await retirementFixture(test); await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot();
  const supplied = vi.fn(async (): Promise<void> => undefined), oldCallbacks: CrashSafeByteSlotReadSelection[] = [];
  useDeletionReadSelection(f, { assertBeforeSlotRead: supplied });
  const method = CrashSafeByteSlotStore.prototype.clearSelected;
  vi.spyOn(CrashSafeByteSlotStore.prototype, 'clearSelected').mockImplementation(function (
    this: CrashSafeByteSlotStore, selection, readSelection,
  ) { expect(readSelection).toBeDefined(); oldCallbacks.push(readSelection!); return method.call(this, selection, readSelection); });
  if (outcome === 'failure') {
    supplied.mockRejectedValueOnce(f.externalError);
    await expect(f.clear(selected)).rejects.toThrow(unavailable);
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.externalError);
    expect(await f.snapshot()).toEqual(before);
  } else { await f.clear(selected); await f.assertEmpty(); }
  const old = oldCallbacks[0]!, after = await f.snapshot(), reads = vi.spyOn(f.fs, 'readSlot');
  const expiresWithoutIO = async () => {
    const io = reads.mock.calls.length, callbacks = supplied.mock.calls.length;
    const external = f.external.mock.calls.length, purged = f.purged.mock.calls.length;
    await expect(old.assertBeforeSlotRead()).rejects.toThrow();
    expect(reads).toHaveBeenCalledTimes(io); expect(supplied).toHaveBeenCalledTimes(callbacks);
    expect(f.external).toHaveBeenCalledTimes(external); expect(f.purged).toHaveBeenCalledTimes(purged);
    expect(await f.snapshot()).toEqual(after);
  };
  await expiresWithoutIO(); f.onUncertain.mockClear();
  const next = await f.select(), entered = deferredRetirement(), held = deferredRetirement();
  f.releases.push(held.release);
  supplied.mockImplementationOnce(async () => { entered.release(); await held.promise; });
  const result = f.clear(next);
  try {
    await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_W75_NEW_READ_NOT_HELD'); })]);
    await expiresWithoutIO();
  } finally { held.release(); await result; }
  expect(f.onUncertain).not.toHaveBeenCalled(); await f.assertEmpty();
});

it('original journal read selection joins an actual reader and held handle close before revocation settles', async test => {
  const f = await retirementFixture(test); await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot(), entered = deferredRetirement(), held = deferredRetirement();
  f.releases.push(held.release); useDeletionReadSelection(f, { async assertBeforeSlotRead() {} });
  let captured = false, reads = 0, closed = 0;
  retirementNativeHandles.hook = (file, path) => {
    if (captured || String(path) !== f.paths.currentPath) return file;
    captured = true;
    return new Proxy(file, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === 'read') return async (...args: Parameters<FileHandle['read']>) => {
        const result = await Reflect.apply(value, target, args); reads++; return result;
      };
      if (key === 'close') return async () => {
        entered.release(); await held.promise; await target.close(); closed++;
      };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  let settled = false;
  const result = f.clear(selected).then(() => { settled = true; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_W75_CLOSE_NOT_HELD'); })]);
    expect(reads).toBeGreaterThan(0); f.state.current = false;
    await setImmediate(); expect(settled).toBe(false); expect(closed).toBe(0);
    await expect(f.store.inspectSlots()).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY');
  } finally { held.release(); await result; }
  expect(closed).toBe(1); expect(await result).toMatchObject({ message: unavailable });
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.ownerError);
  expect(await f.snapshot()).toEqual(before);
});

it('original journal read selection explicitly misses external content visible only at the omitted leading E', async test => {
  for (const explicit of [false, true]) {
    const f = await retirementFixture(test); await f.put('current', journal('prepared'));
    const selected = await f.select(), kept = join(f.root, 'other-company-evidence');
    const bytes = await readFile(kept), read = f.fs.readSlot.bind(f.fs);
    f.external.mockImplementation(async () => { if (!(await readFile(kept)).equals(bytes)) throw f.externalError; });
    await writeFile(kept, 'synthetic-transient-external-content');
    const during = await f.snapshot(); let reverted = false;
    f.fs.readSlot = async (...args) => {
      if (!reverted) { await writeFile(kept, bytes); reverted = true; }
      return read(...args);
    };
    if (explicit) {
      useDeletionReadSelection(f, { async assertBeforeSlotRead() {} });
      await f.clear(selected); expect(reverted).toBe(true);
      expect(f.external).toHaveBeenCalled(); expect(f.purged).toHaveBeenCalled();
      expect(f.onUncertain).not.toHaveBeenCalled(); await f.assertEmpty();
    } else {
      await expect(f.clear(selected)).rejects.toThrow(unavailable);
      expect(reverted).toBe(false); expect(await f.snapshot()).toEqual(during);
      expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.externalError);
      await writeFile(kept, bytes);
      expect((await f.select()).expectedIdentities).toEqual(selected.expectedIdentities);
    }
  }
});

it('original journal read selection characterizes first-error shift from omitted E to slot read without mutation', async test => {
  for (const explicit of [false, true]) {
    const f = await retirementFixture(test); await f.put('current', journal('prepared'));
    const selected = await f.select(), before = await f.snapshot(), first = new Error('SYNTHETIC_W75_SLOT_READ_FIRST');
    const remove = vi.spyOn(f.fs, 'removeSlot'), sync = vi.spyOn(f.fs, 'syncDirectory');
    f.state.external = false; f.fs.readSlot = async () => { throw first; };
    if (explicit) useDeletionReadSelection(f, { async assertBeforeSlotRead() {} });
    await expect(f.clear(selected)).rejects.toThrow(unavailable);
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(explicit ? first : f.externalError);
    expect(remove).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  }
});

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

const retirementNativeHandles = vi.hoisted(() => ({ hook: undefined as ((file: import('node:fs/promises').FileHandle, path: unknown) => import('node:fs/promises').FileHandle) | undefined }));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, async open(...args: Parameters<typeof actual.open>) {
      const file = await actual.open(...args);
      return retirementNativeHandles.hook?.(file, args[0]) ?? file;
    } };
});

function deferredRetirement() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function retirementFixture(test: TestContext) {
  const f = await fixture(test);
  test.onTestFinished(() => { retirementNativeHandles.hook = undefined; vi.restoreAllMocks(); });
  return f;
}

it.for(['empty', 'current', 'next', 'backup', 'currentNext', 'backupCurrent', 'backupNext'] as const)('deletion read guard ordered real slots %s', async (layout, test) => {
  const f = await retirementFixture(test);
  if (layout === 'currentNext') {
    await f.put('current', journal('prepared'));
    await f.put('next', journal('candidateRootCreated'));
  }
  else if (layout === 'backupCurrent') {
    await f.put('backup', journal('prepared'));
    await f.put('current', journal('candidateRootCreated'));
  }
  else if (layout === 'backupNext') {
    await f.put('backup', journal('prepared'));
    await f.put('next', journal('candidateRootCreated'));
  }
  else if (layout !== 'empty')
    await f.put(layout, journal('prepared'));
  const selected = await f.select(), trace: string[] = [], reading = f.fs.readSlot.bind(f.fs);
  f.external.mockImplementation(async () => { trace.push('E'); });
  f.purged.mockImplementation(async () => { trace.push('P'); });
  f.fs.readSlot = async (...args) => { trace.push(`S:${args[0]}`); return reading(...args); };
  const removes = vi.spyOn(f.fs, 'removeSlot'), sync = vi.spyOn(f.fs, 'syncDirectory');
  await f.clear(selected);
  const round = ['E',
    'S:current', 'S:next', 'S:backup', 'E', 'P', 'E'];
  expect(trace.length % round.length).toBe(0);
  expect(trace).toEqual(Array.from({ length: removes.mock.calls.length + 3 }, () => round).flat());
  expect(sync).toHaveBeenCalledOnce();
  await f.assertEmpty();
});

it.for(['external', 'purged', 'authority'] as const)('deletion read guard persistent %s blocks native removal', async (change, test) => {
  const f = await retirementFixture(test);
  await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot(), remove = f.fs.removeSlot.bind(f.fs);
  f.fs.removeSlot = async (...args) => { f.state[change === 'authority' ? 'current' : change] = false; return remove(...args); };
  await expect(f.clear(selected)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect(f.onUncertain).toHaveBeenCalledOnce();
});

it('deletion read guard characterizes transient omitted proof and competing read precedence', async (test) => {
  const f = await retirementFixture(test);
  await f.put('current', journal('prepared'));
  const selected = await f.select();
  let absent = false;
  f.external.mockImplementationOnce(async () => { absent = true; });
  f.purged.mockImplementation(async () => { if (absent)
    throw f.purgedError; });
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => { absent = false; return read(...args); };
  await f.clear(selected);
  await f.assertEmpty();
});

it('deletion read guard read error can precede omitted purged error', async (test) => {
  const f = await retirementFixture(test);
  await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot(), readError = new Error('SYNTHETIC_SLOT_READ_FIRST');
  f.state.purged = false;
  f.fs.readSlot = async () => { throw readError; };
  await expect(f.clear(selected)).rejects.toThrow(unavailable);
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(readError);
  expect(await f.snapshot()).toEqual(before);
});

it('deletion read guard final external proof catches payload returned after purged', async (test) => {
  const f = await retirementFixture(test);
  await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot();
  f.purged.mockImplementationOnce(async () => { f.state.external = false; });
  await expect(f.clear(selected)).rejects.toThrow(unavailable);
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.externalError);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['initial', 'remove', 'sync'] as const)('deletion read guard retains undefined and Error prefix causes at %s', async (boundary, test) => {
  for (const first of [undefined, new Error('SYNTHETIC_PREFIX_FIRST')]) {
    const f = await retirementFixture(test);
    if (boundary !== 'sync')
      await f.put('current', journal('prepared'));
    const selected = await f.select(), before = await f.snapshot();
    const fail = () => { f.external.mockImplementationOnce(async () => { throw first; }); };
    if (boundary === 'initial')
      fail();
    else if (boundary === 'remove') {
      const remove = f.fs.removeSlot.bind(f.fs);
      f.fs.removeSlot = async (...args) => { fail(); return remove(...args); };
    }
    else {
      const sync = f.fs.syncDirectory.bind(f.fs);
      f.fs.syncDirectory = async (...args) => { fail(); return sync(...args); };
    }
    f.onUncertain.mockImplementationOnce(() => { throw new Error('SYNTHETIC_LATER_NOTIFICATION'); });
    await expect(f.clear(selected)).rejects.toThrow(unavailable);
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    expect(await f.snapshot()).toEqual(before);
  }
});

it('deletion read guard joins held prefix before revocation returns and keeps busy', async (test) => {
  const f = await retirementFixture(test);
  await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot(), entered = deferredRetirement(), held = deferredRetirement();
  f.releases.push(held.release);
  f.external.mockImplementationOnce(async () => { entered.release(); await held.promise; });
  let settled = false;
  const result = f.clear(selected).then(() => { settled = true; }, error => { settled = true; return error; });
  await entered.promise;
  try {
    f.state.current = false;
    await setImmediate();
    expect(settled).toBe(false);
    await expect(f.store.inspectSlots()).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY');
  }
  finally {
    held.release();
    await result;
  }
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.ownerError);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['read', 'close'] as const)('deletion read guard joins a real held handle %s before settling', async (method, test) => {
  const f = await retirementFixture(test);
  await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot(), entered = deferredRetirement(), held = deferredRetirement();
  f.releases.push(held.release);
  let captured = false, closed = 0;
  retirementNativeHandles.hook = (file, path) => {
    if (String(path) !== f.paths.currentPath || captured)
      return file;
    captured = true;
    return new Proxy(file, { get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key === 'close')
          return async () => {
            if (method === 'close') {
              entered.release();
              await held.promise;
            }
            await target.close();
            closed++;
          };
        if (key === 'read' && method === 'read')
          return async (...args: Parameters<FileHandle['read']>) => {
            entered.release();
            await held.promise;
            return Reflect.apply(value, target, args);
          };
        return typeof value === 'function' ? value.bind(target) : value;
      } });
  };
  let settled = false;
  const result = f.clear(selected).then(() => { settled = true; }, error => { settled = true; return error; });
  await entered.promise;
  try {
    f.state.current = false;
    await setImmediate();
    expect(settled).toBe(false);
    expect(closed).toBe(0);
    await expect(f.store.inspectSlots()).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY');
  }
  finally {
    held.release();
    await result;
  }
  expect(closed).toBe(1);
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(f.ownerError);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['success', 'failure'] as const)('deletion read guard expired prefix does no I/O after %s or in fresh operation', async (outcome, test) => {
  const f = await retirementFixture(test);
  await f.put('current', journal('prepared'));
  const oldCallbacks: CrashSafeByteSlotReadSelection[] = [];
  const original = CrashSafeByteSlotStore.prototype.clearSelected;
  vi.spyOn(CrashSafeByteSlotStore.prototype, 'clearSelected').mockImplementation(async function (this: CrashSafeByteSlotStore, selection, readSelection) {
    expect(readSelection).toBeDefined();
    oldCallbacks.push(readSelection!);
    return original.call(this, selection, readSelection);
  });
  if (outcome === 'failure') {
    f.external.mockImplementationOnce(async () => { throw f.externalError; });
    await expect(f.clear()).rejects.toThrow(unavailable);
  }
  else
    await f.clear();
  const old = oldCallbacks[0]!;
  const count = f.external.mock.calls.length;
  await expect(old.assertBeforeSlotRead()).rejects.toThrow();
  expect(f.external).toHaveBeenCalledTimes(count);
  f.onUncertain.mockClear();
  const entered = deferredRetirement(), held = deferredRetirement();
  f.releases.push(held.release);
  f.external.mockImplementationOnce(async () => { entered.release(); await held.promise; });
  const result = f.clear();
  await entered.promise;
  try {
    const currentCount = f.external.mock.calls.length;
    await expect(old.assertBeforeSlotRead()).rejects.toThrow();
    expect(f.external).toHaveBeenCalledTimes(currentCount);
  }
  finally {
    held.release();
    await result;
  }
  expect(f.onUncertain).not.toHaveBeenCalled();
  await f.assertEmpty();
});

it('deletion read guard labels each native remove and sync with its own complete round', async (test) => {
  const f = await retirementFixture(test);
  await f.put('backup', journal('prepared'));
  await f.put('current', journal('candidateRootCreated'));
  const selected = await f.select(), trace: string[] = [], completed: string[] = [];
  const reading = f.fs.readSlot.bind(f.fs), remove = f.fs.removeSlot.bind(f.fs), sync = f.fs.syncDirectory.bind(f.fs);
  f.external.mockImplementation(async () => { trace.push('E'); });
  f.purged.mockImplementation(async () => { trace.push('P'); });
  f.fs.readSlot = async (...args) => { trace.push(`S:${args[0]}`); return reading(...args); };
  const round = ['E', 'S:current', 'S:next', 'S:backup', 'E', 'P', 'E'];
  const tagged = (guard: RetirementMutationGuard | undefined, name: string): RetirementMutationGuard => {
    expect(guard).toBeDefined();
    return { assertAuthority: guard!.assertAuthority.bind(guard), async beforeMutation() {
        const start = trace.length;
        await guard!.beforeMutation();
        expect(trace.slice(start)).toEqual(round);
        completed.push(name);
      } };
  };
  f.fs.removeSlot = async (slot, guard) => {
    const result = await remove(slot, tagged(guard, `remove:${slot}`));
    expect(completed.at(-1)).toBe(`remove:${slot}`);
    return result;
  };
  f.fs.syncDirectory = async (guard) => {
    await sync(tagged(guard, 'sync'));
    expect(completed.at(-1)).toBe('sync');
  };
  await f.clear(selected);
  expect(completed).toEqual(['remove:backup', 'remove:current', 'sync']);
  await f.assertEmpty();
});

it.for(['initial', 'remove', 'sync'] as const)('deletion read guard transient omitted proof at native %s', async (boundary, test) => {
  const f = await retirementFixture(test);
  if (boundary !== 'sync')
    await f.put('current', journal('prepared'));
  const selected = await f.select();
  let zone = 'initial', armed = false, violates = false;
  const read = f.fs.readSlot.bind(f.fs), remove = f.fs.removeSlot.bind(f.fs), sync = f.fs.syncDirectory.bind(f.fs);
  f.fs.removeSlot = async (...args) => { zone = 'remove'; return remove(...args); };
  f.fs.syncDirectory = async (...args) => { zone = 'sync'; return sync(...args); };
  f.external.mockImplementation(async () => { if (zone === boundary && !armed) {
    armed = true;
    violates = true;
  } });
  f.purged.mockImplementation(async () => { if (violates)
    throw f.purgedError; });
  f.fs.readSlot = async (...args) => { violates = false; return read(...args); };
  await f.clear(selected);
  await f.assertEmpty();
  expect(armed).toBe(true);
});

const persistentRetirementCases = (['remove', 'sync'] as const).flatMap(boundary => (['external', 'purged', 'authority'] as const).map(change => ({ boundary, change })));

it.for(persistentRetirementCases)('deletion read guard persistent $change in native $boundary preserves bytes', async ({ boundary, change }, test) => {
  const f = await retirementFixture(test);
  if (boundary === 'remove')
    await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot();
  let reached = false, completed = false;
  const inject = () => { reached = true; f.state[change === 'authority' ? 'current' : change] = false; };
  if (boundary === 'remove') {
    const remove = f.fs.removeSlot.bind(f.fs);
    f.fs.removeSlot = async (...args) => { inject(); const value = await remove(...args); completed = true; return value; };
  }
  else {
    const sync = f.fs.syncDirectory.bind(f.fs);
    f.fs.syncDirectory = async (...args) => { inject(); await sync(...args); completed = true; };
  }
  await expect(f.clear(selected)).rejects.toThrow();
  expect(reached).toBe(true);
  expect(completed).toBe(false);
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(change === 'external' ? f.externalError
    : change === 'purged' ? f.purgedError : f.ownerError);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['error', 'undefined'] as const)('deletion read guard prefix %s survives later owner and owned close fault', async (kind, test) => {
  const f = await retirementFixture(test);
  await f.put('current', journal('prepared'));
  const selected = await f.select(), before = await f.snapshot();
  const first = kind === 'error' ? new Error('SYNTHETIC_PREFIX_BEFORE_CLOSE') : undefined;
  const later = new Error('SYNTHETIC_OWNED_CLOSE_AFTER_PREFIX');
  const remove = f.fs.removeSlot.bind(f.fs);
  let closed = 0, reached = false;
  f.fs.removeSlot = async (...args) => {
    const real = await openRetirementHandle(f.paths.currentPath, 'r');
    const handle = { async close() { await real.close(); closed++; throw later; } };
    f.external.mockImplementationOnce(async () => { reached = true; f.state.current = false; throw first; });
    try {
      return await remove(...args);
    }
    finally {
      await handle.close();
    }
  };
  f.onUncertain.mockImplementationOnce(() => { throw new Error('SYNTHETIC_NOTIFICATION_AFTER_CLOSE'); });
  await expect(f.clear(selected)).rejects.toThrow(unavailable);
  expect(reached).toBe(true);
  expect(closed).toBe(1);
  expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
  expect(await f.snapshot()).toEqual(before);
});
