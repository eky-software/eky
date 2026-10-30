import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import type { CrashSafeByteSlotSelection, ObservedRecoveryAuthority } from '../persistence/crashSafeByteSlotStore.js';
import {
  createWorkspaceLegacyAdoptionJournalPaths, maximumWorkspaceLegacyAdoptionJournalBytes,
  serializeWorkspaceLegacyAdoptionJournal, WorkspaceLegacyAdoptionJournalStore,
} from './workspaceLegacyAdoptionJournal.js';
import { createAdoptionJournal } from './workspaceLegacyAdoptionTestSupport.js';

describe('selected adoption journal', () => {
  it('writes the existing forward states and clears only the captured operation', async context => {
    const f = await fixture(context);
    for (const state of ['prepared', 'candidatePrepared', 'rootPublished', 'registryPublished'] as const) {
      const value = createAdoptionJournal(state);
      const identity = await f.store.writeSelected(value, await f.select());
      const observed = await f.store.inspectRecoverySelection(f.assertCurrent);
      expect(observed.value).toEqual(value);
      expect(observed.identities.current).toEqual(identity);
      expect(observed.identities.next).toBeUndefined();
      expect(observed.identities.backup).toBeUndefined();
    }
    const selected = await f.select();
    await f.store.clearSelected(createAdoptionJournal('prepared').operationId, selected);
    expect(await readdir(f.paths.directoryPath)).toEqual([]);
    expect(f.external).toHaveBeenCalled();
  });

  it('retains the journal when a different operation asks to clear it', async context => {
    const f = await fixture(context);
    await f.store.write(createAdoptionJournal('prepared'));
    const before = await readFile(f.paths.currentPath);
    await expect(f.store.clearSelected('22222222-2222-4222-8222-222222222222', await f.select())).rejects.toThrow();
    expect((await readFile(f.paths.currentPath)).equals(before)).toBe(true);
  });

  it.for(['current', 'backup', 'next'] as const)('observes then recovers %s without a repairing initial read', async (slot, context) => {
    const f = await fixture(context);
    const bytes = serializeWorkspaceLegacyAdoptionJournal(createAdoptionJournal('prepared'));
    await writeFile(f.paths[`${slot}Path`], bytes, { flag: 'wx' });
    if (slot !== 'next') await writeFile(f.paths.nextPath, 'torn', { flag: 'wx' });
    if (slot === 'current') await writeFile(f.paths.backupPath, 'torn', { flag: 'wx' });
    const observed = await f.store.inspectRecoverySelection(f.assertCurrent);
    expect(observed.source).toBe(slot);
    expect((await readFile(f.paths[`${slot}Path`])).equals(Buffer.from(bytes))).toBe(true);
    if (slot !== 'next') expect(await readFile(f.paths.nextPath, 'utf8')).toBe('torn');
    const receipt = await f.store.recoverObservedSelection(observed, f.authority);
    expect(receipt.value).toEqual(createAdoptionJournal('prepared'));
    expect((await readFile(f.paths.currentPath)).equals(Buffer.from(bytes))).toBe(true);
    expect(await readdir(f.paths.directoryPath)).toEqual([f.paths.currentPath.split(/[\\/]/).at(-1)]);
  });

  it.for(['identity', 'bytes', 'next'] as const)('preserves a changed %s after selection', async (change, context) => {
    const f = await fixture(context);
    await f.store.write(createAdoptionJournal('prepared'));
    const selected = await f.select();
    const before = await readFile(f.paths.currentPath);
    if (change === 'identity') {
      await rename(f.paths.currentPath, `${f.paths.currentPath}.preserved`);
      await writeFile(f.paths.currentPath, before, { flag: 'wx' });
    } else if (change === 'bytes') {
      await writeFile(f.paths.currentPath, serializeWorkspaceLegacyAdoptionJournal(createAdoptionJournal('recoveryRequired')));
    } else await writeFile(f.paths.nextPath, before, { flag: 'wx' });
    const current = await readFile(f.paths.currentPath);
    await expect(f.store.writeSelected(createAdoptionJournal('candidatePrepared'), selected)).rejects.toThrow();
    expect((await readFile(f.paths.currentPath)).equals(current)).toBe(true);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    if (change === 'next') expect((await readFile(f.paths.nextPath)).equals(before)).toBe(true);
  });

  it('keeps the ordinary recovery reset forbidden while the named port preserves all identities', async context => {
    const f = await fixture(context);
    const original = createAdoptionJournal('recoveryRequired');
    await writeFile(f.paths.currentPath, serializeWorkspaceLegacyAdoptionJournal(original), { flag: 'wx' });
    await expect(f.store.write({ ...original, state: 'prepared' })).rejects.toThrow('WORKSPACE_ADOPTION_INVALID');
    await expect(f.store.writeSelected({ ...original, state: 'prepared' }, await f.select())).rejects.toThrow('WORKSPACE_ADOPTION_INVALID');
    const receipt = await f.store.prepareRecoveredSelection(await f.select());
    const observed = await new WorkspaceLegacyAdoptionJournalStore(f.root).inspectRecoverySelection(f.assertCurrent);
    expect(observed.value).toEqual({ ...original, state: 'prepared' });
    expect(observed.identities.current).toEqual(receipt);
  });

  it.for(['prepared', 'registryPublished', 'fresh'] as const)('rejects a reset of %s', async (mode, context) => {
    const f = await fixture(context);
    const value = mode === 'fresh' ? { ...createAdoptionJournal('recoveryRequired'), sourceKind: 'fresh' }
      : createAdoptionJournal(mode);
    const bytes = serializeWorkspaceLegacyAdoptionJournal(value);
    await writeFile(f.paths.currentPath, bytes, { flag: 'wx' });
    await expect(f.store.prepareRecoveredSelection(await f.select())).rejects.toThrow('WORKSPACE_ADOPTION_INVALID');
    expect((await readFile(f.paths.currentPath)).equals(Buffer.from(bytes))).toBe(true);
  });

  it.for(['write', 'clear', 'reset'] as const)('checks the external selection before %s and retains the original cause', async (mode, context) => {
    const f = await fixture(context);
    await writeFile(f.paths.currentPath, serializeWorkspaceLegacyAdoptionJournal(createAdoptionJournal('recoveryRequired')), { flag: 'wx' });
    const selected = await f.select();
    const original = new Error('synthetic external selection drift');
    f.external.mockRejectedValueOnce(original);
    f.onUncertain.mockImplementation(() => { throw new Error('synthetic observer failure'); });
    const task = mode === 'write' ? f.store.writeSelected(createAdoptionJournal('recoveryRequired'), selected)
      : mode === 'clear' ? f.store.clearSelected(createAdoptionJournal('prepared').operationId, selected)
      : f.store.prepareRecoveredSelection(selected);
    await expect(task).rejects.toThrow('WORKSPACE_ADOPTION_STORAGE_FAILED');
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(original);
    expect((await f.store.inspectRecoverySelection(f.assertCurrent)).value?.state).toBe('recoveryRequired');
  });

  it('retains both publications on a lost reset acknowledgement without rollback', async context => {
    const f = await fixture(context);
    const original = createAdoptionJournal('recoveryRequired');
    await writeFile(f.paths.currentPath, serializeWorkspaceLegacyAdoptionJournal(original), { flag: 'wx' });
    const move = f.fs.moveSlot.bind(f.fs);
    const failure = new Error('synthetic reset acknowledgement lost');
    vi.spyOn(f.fs, 'moveSlot').mockImplementation(async (...args) => {
      await move(...args);
      if (args[1] === 'current') throw failure;
    });
    await expect(f.store.prepareRecoveredSelection(await f.select())).rejects.toThrow('WORKSPACE_ADOPTION_STORAGE_FAILED');
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(failure);
    expect((await readFile(f.paths.currentPath)).equals(Buffer.from(serializeWorkspaceLegacyAdoptionJournal({ ...original, state: 'prepared' })))).toBe(true);
    expect((await readFile(f.paths.backupPath)).equals(Buffer.from(serializeWorkspaceLegacyAdoptionJournal(original)))).toBe(true);
  });

  it('preserves changed cold selection rather than repairing it', async context => {
    const f = await fixture(context);
    const original = createAdoptionJournal('prepared');
    await writeFile(f.paths.backupPath, serializeWorkspaceLegacyAdoptionJournal(original), { flag: 'wx' });
    const selected = await f.store.inspectRecoverySelection(f.assertCurrent);
    await writeFile(f.paths.currentPath, serializeWorkspaceLegacyAdoptionJournal(original), { flag: 'wx' });
    await expect(f.store.recoverObservedSelection(selected, f.authority)).rejects.toThrow('WORKSPACE_ADOPTION_INVALID');
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(await readdir(f.paths.directoryPath)).toHaveLength(2);
  });

  it('does not convert a completed clear with lost acknowledgement into success or recreate it', async context => {
    const f = await fixture(context);
    await writeFile(f.paths.currentPath,
      serializeWorkspaceLegacyAdoptionJournal(createAdoptionJournal('registryPublished')), { flag: 'wx' });
    const selected = await f.select();
    const sync = f.fs.syncDirectory.bind(f.fs);
    const failure = new Error('synthetic clear acknowledgement lost');
    vi.spyOn(f.fs, 'syncDirectory').mockImplementationOnce(async guard => { await sync(guard); throw failure; });
    await expect(f.store.clearSelected(createAdoptionJournal('prepared').operationId, selected)).rejects.toThrow('WORKSPACE_ADOPTION_STORAGE_FAILED');
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(failure);
    expect(await readdir(f.paths.directoryPath)).toEqual([]);
  });

  it('retains the journal when observation loses authority after a real identity read', async context => {
    const f = await fixture(context);
    await f.store.write(createAdoptionJournal('prepared'));
    const inspect = f.fs.inspectSlotIdentity!.bind(f.fs);
    vi.spyOn(f.fs, 'inspectSlotIdentity').mockImplementationOnce(async slot => {
      const identity = await inspect(slot);
      f.state.current = false;
      return identity;
    });
    await expect(f.store.inspectRecoverySelection(f.assertCurrent)).rejects.toThrow('WORKSPACE_ADOPTION_STORAGE_FAILED');
    expect(await readdir(f.paths.directoryPath)).toHaveLength(1);
  });

  it('rejects expired authority after observation and before an external continuation mutates', async context => {
    const f = await fixture(context);
    await f.store.write(createAdoptionJournal('prepared'));
    const selected = await f.select();
    f.external.mockImplementationOnce(async () => { f.state.current = false; });
    await expect(f.store.writeSelected(createAdoptionJournal('candidatePrepared'), selected)).rejects.toThrow();
    const expected = Buffer.from(serializeWorkspaceLegacyAdoptionJournal(createAdoptionJournal('prepared')));
    expect((await readFile(f.paths.currentPath)).equals(expected)).toBe(true);
  });
});

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-adoption-selected-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = createWorkspaceLegacyAdoptionJournalPaths(root);
  await mkdir(paths.directoryPath);
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceLegacyAdoptionJournalBytes);
  const store = new WorkspaceLegacyAdoptionJournalStore(root, fs);
  const state = { current: true };
  const assertCurrent = () => { if (!state.current) throw new Error('synthetic owner expired'); };
  const external = vi.fn(async () => {});
  const onUncertain = vi.fn((_error: unknown) => {});
  const authority = { assertAuthority: assertCurrent, assertExternalSelection: external, onUncertain };
  async function select(): Promise<CrashSafeByteSlotSelection & ObservedRecoveryAuthority> {
    const observed = await store.inspectRecoverySelection(assertCurrent);
    const slots = { current: undefined as Uint8Array | undefined, next: undefined, backup: undefined };
    if (observed.source !== undefined && observed.source !== 'current') throw new Error('Expected a clean live selection');
    if (observed.identities.next !== undefined || observed.identities.backup !== undefined) throw new Error('Expected no siblings');
    slots.current = observed.bytes;
    return { expectedSlots: slots, expectedIdentities: observed.identities, ...authority };
  }
  return { root, paths, fs, store, state, assertCurrent, external, onUncertain, authority, select };
}
