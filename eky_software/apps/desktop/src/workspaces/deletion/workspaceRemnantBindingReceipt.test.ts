import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { remnantBindingFixture as fixture } from './workspaceRemnantBindingTestSupport.js';
import type { WorkspaceRemnantBindingCleanup } from './workspaceRemnantBindingStore.js';

it('clears only the current file acknowledged by the owner publication', async context => {
  const f = await fixture(context, 'workspaceImport');
  const receipt = await f.store().publish(f.binding, f.authority);
  await f.store().clearAfterPayloadsAbsent(f.binding, { ...f.cleanup(), expectedCurrentIdentity: receipt.identity });
  expect((await f.store().inspect(f.authority)).mode).toBe('absent');
});

it.for(['beforeObservation', 'afterObservation', 'missing'] as const)(
  'preserves remaining metadata when the acknowledged current changes: %s', async (timing, context) => {
    const f = await fixture(context, 'workspaceImport');
    const receipt = await f.store().publish(f.binding, f.authority);
    const bytes = await readFile(f.paths.currentPath);
    const preservedPath = join(f.root, 'acknowledged-binding');
    const replace = async () => {
      await rename(f.paths.currentPath, preservedPath);
      if (timing !== 'missing') await writeFile(f.paths.currentPath, bytes, { flag: 'wx', mode: 0o600 });
    };
    if (timing === 'afterObservation') {
      const read = f.fileSystem.readSlot.bind(f.fileSystem);
      let replaced = false;
      vi.spyOn(f.fileSystem, 'readSlot').mockImplementation(async (...args) => {
        const result = await read(...args);
        if (args[0] === 'current' && !replaced) { replaced = true; await replace(); }
        return result;
      });
    } else await replace();
    const remove = vi.spyOn(f.fileSystem, 'removeSlot');
    await expect(f.store().clearAfterPayloadsAbsent(f.binding, {
      ...f.cleanup(), expectedCurrentIdentity: receipt.identity,
    })).rejects.toThrow();
    if (timing !== 'afterObservation') expect(remove).not.toHaveBeenCalled();
    expect(await readFile(preservedPath)).toEqual(bytes);
    if (timing === 'missing') expect((await f.store().inspect(f.authority)).mode).toBe('absent');
    else expect(await readFile(f.paths.currentPath)).toEqual(bytes);
  },
);

it('captures the receipt identity before the first external await', async context => {
  const f = await fixture(context, 'workspaceImport');
  const receipt = await f.store().publish(f.binding, f.authority);
  const identity = { ...receipt.identity };
  const before = await f.snapshot();
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, {
    ...f.cleanup(), expectedCurrentIdentity: identity,
    async assertExternalSelection() { await f.authority.assertExternalSelection(); identity.ino = 0; },
  })).resolves.toBeUndefined();
  expect(before).not.toEqual({});
  expect((await f.store().inspect(f.authority)).mode).toBe('absent');
});

it.for(['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const)(
  'rejects a changed receipt field %s without deleting any slot', async (field, context) => {
    const f = await fixture(context, 'workspaceImport');
    const receipt = await f.store().publish(f.binding, f.authority);
    const before = await f.snapshot();
    const remove = vi.spyOn(f.fileSystem, 'removeSlot');
    const changed = receipt.identity[field] + Math.max(1, Math.abs(receipt.identity[field]));
    expect(changed).not.toBe(receipt.identity[field]);
    await expect(f.store().clearAfterPayloadsAbsent(f.binding, {
      ...f.cleanup(), expectedCurrentIdentity: { ...receipt.identity, [field]: changed },
    })).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(remove).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  },
);

it('rejects an expected identity for deletion-purged cleanup before I/O', async context => {
  const f = await fixture(context);
  const receipt = await f.store().publish(f.binding, f.authority);
  const before = await f.snapshot();
  const read = vi.spyOn(f.fileSystem, 'readSlot');
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, {
    ...f.cleanup('deletionPurged'), expectedCurrentIdentity: receipt.identity,
  })).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(read).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it.for([null, {}, { ino: 0 }, { dev: NaN, ino: 1, size: 1, mtimeMs: 1, ctimeMs: 1 }])(
  'rejects a malformed expected identity before I/O: %j', async (identity, context) => {
    const f = await fixture(context);
    await f.store().publish(f.binding, f.authority);
    const before = await f.snapshot();
    const read = vi.spyOn(f.fileSystem, 'readSlot');
    const proof = { ...f.cleanup(), expectedCurrentIdentity: identity } as WorkspaceRemnantBindingCleanup;
    await expect(f.store().clearAfterPayloadsAbsent(f.binding, proof)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(read).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  },
);
