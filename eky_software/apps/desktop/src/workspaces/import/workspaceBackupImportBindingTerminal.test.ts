import { readFile, rename, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { WorkspaceBackupImportBinding } from './workspaceBackupImportBinding.js';
import { createImportBindingFixture as fixture, importBindingGate as gate,
  snapshotImportBindingFiles as snapshot } from './workspaceBackupImportBindingTestSupport.js';

it('requires the initial selected journal callback before any publication', async context => {
  const f = await fixture(context);
  const before = await snapshot(f.root);
  expect(() => new WorkspaceBackupImportBinding({ ...f.options,
    assertJournalSelection: undefined! }, f.fileSystem)).toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
  expect(await snapshot(f.root)).toEqual(before);
});

it('captures the initial journal callback instead of using later caller replacements', async context => {
  const f = await fixture(context);
  Object.assign(f.options, { assertJournalSelection: async () => { throw new Error('REPLACED_CALLBACK'); } });
  await f.binding.publish();
  expect(f.checkInitialJournal).toHaveBeenCalled();
  expect(f.onUncertain).not.toHaveBeenCalled();
});

it.for(['beforeWrite', 'afterWrite', 'afterReadback'] as const)(
  'retains the initial journal failure and actual binding bytes at %s', async (when, context) => {
    const f = await fixture(context);
    const primary = new Error('SYNTHETIC_SELECTED_JOURNAL_CHANGED');
    let stale = when === 'beforeWrite';
    f.checkInitialJournal.mockImplementation(async () => { if (stale) throw primary; });
    if (when === 'afterWrite') {
      const sync = f.fileSystem.syncDirectory.bind(f.fileSystem);
      vi.spyOn(f.fileSystem, 'syncDirectory').mockImplementation(async (...args) => { await sync(...args); stale = true; });
    }
    if (when === 'afterReadback') {
      const read = f.fileSystem.readSlot.bind(f.fileSystem);
      vi.spyOn(f.fileSystem, 'readSlot').mockImplementation(async (...args) => {
        const bytes = await read(...args);
        if (args[0] === 'current' && bytes !== undefined) stale = true;
        return bytes;
      });
    }
    await expect(f.binding.publish()).rejects.toBe(primary);
    const before = await snapshot(f.root);
    await expect(f.binding.assertPublished()).rejects.toMatchObject({ cause: primary });
    expect(await snapshot(f.root)).toEqual(before);
    if (when !== 'beforeWrite') expect(await readFile(f.paths.currentPath, 'utf8')).toContain('workspaceImport');
    expect(f.onUncertain).toHaveBeenCalledOnce();
  },
);

it.for([false, true])('retires metadata before terminal journal cleanup, registryPublished=%s', async (published, context) => {
  const f = await fixture(context);
  await f.binding.publish();
  if (published) await f.binding.publishRegistry(f.entry, f.checkJournal);
  const absent = vi.fn(async () => {});
  await f.binding.clearAfterPayloadsAbsent(absent, f.checkJournal);
  f.checkJournal.mockClear(); f.checkInitialJournal.mockClear();
  await f.binding.assertRetired(absent);
  expect(f.checkJournal).not.toHaveBeenCalled();
  expect(f.checkInitialJournal).not.toHaveBeenCalled();
  expect((await f.registry.inspectSlots()).current?.value).toEqual(published ? f.expected : f.original);
  expect(f.onUncertain).not.toHaveBeenCalled();
  expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
});

it.for(['payload', 'journal', 'registry', 'lease', 'main'] as const)(
  'preserves metadata and the first %s failure during retirement', async (failure, context) => {
    const f = await fixture(context); await f.binding.publish();
    const before = await snapshot(f.root);
    const primary = new Error(`SYNTHETIC_TERMINAL_${failure}`);
    if (failure === 'journal') f.checkJournal.mockRejectedValue(primary);
    if (failure === 'lease') await f.held.release();
    if (failure === 'main') f.state.current = false;
    if (failure === 'registry') await writeFile(f.registryPaths.nextPath, await readFile(f.registryPaths.currentPath), { flag: 'wx' });
    await expect(f.binding.clearAfterPayloadsAbsent(async () => { if (failure === 'payload') throw primary; },
      f.checkJournal)).rejects.toThrow();
    expect(await readFile(f.paths.currentPath, 'utf8')).toContain('workspaceImport');
    if (failure !== 'registry') expect(await snapshot(f.root)).toEqual(before);
    await expect(f.binding.assertRetired(async () => {})).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(f.onUncertain).toHaveBeenCalledOnce();
  },
);

it('pins the original publication even when metadata changes during the absence proof', async context => {
  const f = await fixture(context); await f.binding.publish();
  const original = await readFile(f.paths.currentPath);
  let replaced = false;
  await expect(f.binding.clearAfterPayloadsAbsent(async () => {
    if (replaced) return; replaced = true;
    await rename(f.paths.currentPath, `${f.root}/retained-binding`);
    await writeFile(f.paths.currentPath, original, { flag: 'wx' });
  }, f.checkJournal)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(f.paths.currentPath)).toEqual(original);
  expect(await readFile(`${f.root}/retained-binding`)).toEqual(original);
  expect(f.onUncertain).toHaveBeenCalledOnce();
});

it('does not adopt absence after losing the clear acknowledgement', async context => {
  const f = await fixture(context); await f.binding.publish();
  const primary = new Error('SYNTHETIC_CLEAR_ACK_LOST');
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  vi.spyOn(f.fileSystem, 'removeSlot').mockImplementation(async (...args) => {
    const removed = await remove(...args); if (args[0] === 'current') throw primary; return removed;
  });
  await expect(f.binding.clearAfterPayloadsAbsent(async () => {}, f.checkJournal)).rejects.toBe(primary);
  const before = await snapshot(f.root);
  await expect(f.binding.assertRetired(async () => {})).rejects.toMatchObject({ cause: primary });
  expect(await snapshot(f.root)).toEqual(before);
  expect(f.onUncertain).toHaveBeenCalledOnce();
});

it.for(['metadata', 'registry'] as const)('rejects reappearing %s after acknowledged retirement', async (change, context) => {
  const f = await fixture(context); await f.binding.publish();
  const bytes = await readFile(f.paths.currentPath);
  await f.binding.clearAfterPayloadsAbsent(async () => {}, f.checkJournal);
  if (change === 'metadata') await writeFile(f.paths.currentPath, bytes, { flag: 'wx' });
  else await writeFile(f.registryPaths.nextPath, await readFile(f.registryPaths.currentPath), { flag: 'wx' });
  const before = await snapshot(f.root);
  await expect(f.binding.assertRetired(async () => {})).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
  expect(await snapshot(f.root)).toEqual(before);
  expect(f.onUncertain).toHaveBeenCalledOnce();
});

it('waits for already started clear I/O after a competing call invalidates the owner', async context => {
  const f = await fixture(context); await f.binding.publish();
  const entered = gate(); const finish = gate();
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  let settled = false;
  vi.spyOn(f.fileSystem, 'removeSlot').mockImplementationOnce(async (...args) => {
    entered.resolve(); await finish.promise; return remove(...args);
  });
  const pending = f.binding.clearAfterPayloadsAbsent(async () => {}, f.checkJournal)
    .then(() => undefined, error => error as unknown).finally(() => { settled = true; });
  let result: unknown;
  try {
    await Promise.race([entered.promise, pending.then(() => { throw new Error('CLEAR_NOT_ENTERED'); })]);
    await expect(f.binding.assertRetired(async () => {})).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(settled).toBe(false);
    f.lease.captureCurrentOwner(['import'], f.held)();
  } finally { finish.resolve(); result = await pending; }
  expect(result).toBeInstanceOf(Error);
  expect(settled).toBe(true);
  expect(f.onUncertain).toHaveBeenCalledOnce();
});
