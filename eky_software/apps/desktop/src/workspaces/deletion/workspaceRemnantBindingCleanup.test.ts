import { lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding } from './workspaceRemnantBindingCodec.js';
import { remnantBindingFixture as fixture } from './workspaceRemnantBindingTestSupport.js';

for (const slot of ['next', 'backup', 'current'] as const) {
  for (const timing of ['before', 'after'] as const) {
    it(`preserves partial cleanup at ${timing} ${slot} and resumes from exact surviving metadata`, async context => {
      const f = await fixture(context);
      await f.store().publish(f.binding, f.authority);
      const bytes = serializeWorkspaceRemnantBinding(f.binding);
      await writeFile(f.paths.nextPath, bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(f.paths.backupPath, bytes, { flag: 'wx', mode: 0o600 });
      const other = join(f.paths.directoryPath, `${id(9)}.json`);
      await writeFile(other, 'unrelated-metadata', { flag: 'wx', mode: 0o600 });
      const first = new Error(`SYNTHETIC_${timing}_${slot}`);
      const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
      const removed: string[] = [];
      f.fileSystem.removeSlot = async (...args) => {
        if (args[0] === slot && timing === 'before') throw first;
        const result = await remove(...args);
        removed.push(args[0]);
        if (args[0] === slot && timing === 'after') throw first;
        return result;
      };
      await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'))).rejects.toBe(first);
      const order = ['next', 'backup', 'current'];
      expect(removed).toEqual(order.slice(0, order.indexOf(slot) + (timing === 'after' ? 1 : 0)));
      const remaining = await f.snapshot();
      expect(remaining[`${id(9)}.json`]).toBe(Buffer.from('unrelated-metadata').toString('hex'));
      for (const name of order.slice(removed.length)) {
        expect(remaining[`${id(1)}.json${name === 'current' ? '' : `.${name}`}`]).toBe(bytes.toString('hex'));
      }
      f.fileSystem.removeSlot = remove;
      await f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'));
      expect(await readdir(f.paths.directoryPath)).toEqual([`${id(9)}.json`]);
      expect(await readFile(other, 'utf8')).toBe('unrelated-metadata');
    });
  }
}

it('does not acknowledge a failed final directory sync and synchronizes again on admitted resume', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const first = new Error('SYNTHETIC_DIRECTORY_SYNC');
  const sync = f.fileSystem.syncDirectory.bind(f.fileSystem);
  let calls = 0;
  f.fileSystem.syncDirectory = async (...args) => { await sync(...args); calls++; throw first; };
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup())).rejects.toBe(first);
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
  expect(calls).toBe(1);
  f.fileSystem.syncDirectory = async (...args) => { await sync(...args); calls++; };
  await f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup());
  expect(calls).toBe(2);
});

it('joins a pending metadata removal and refuses overlapping access by the same owner', async context => {
  const f = await fixture(context);
  const store = f.store();
  await store.publish(f.binding, f.authority);
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  let removalReached!: () => void;
  const reached = new Promise<void>(resolve => { removalReached = resolve; });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  f.fileSystem.removeSlot = async (...args) => {
    removalReached();
    await released;
    return remove(...args);
  };
  let settled = false;
  const result = store.clearAfterPayloadsAbsent(f.binding, f.cleanup()).finally(() => { settled = true; });
  try {
    await reached;
    expect(settled).toBe(false);
    await expect(store.inspect(f.authority)).rejects.toThrow();
    expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
  } finally { release(); }
  await result;
  expect(settled).toBe(true);
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
});

for (const changed of ['lease', 'target', 'payload'] as const) {
  it(`preserves metadata when ${changed} changes after the first payload-absence check`, async context => {
    const f = await fixture(context);
    await f.store().publish(f.binding, f.authority);
    const before = await f.snapshot();
    const proof = f.cleanup('deletionPurged');
    const absent = proof.assertPayloadsAbsent;
    let checked = 0;
    await expect(f.store().clearAfterPayloadsAbsent(f.binding, { ...proof, async assertPayloadsAbsent() {
      await absent();
      checked++;
      if (changed === 'lease') f.expire();
      if (changed === 'target') f.changeTarget();
      if (changed === 'payload') f.payloadRemains();
    } })).rejects.toThrow(changed === 'lease' ? 'SYNTHETIC_LEASE_LOST'
      : changed === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_PAYLOAD_REMAINS');
    expect(checked).toBeGreaterThan(0);
    expect(await f.snapshot()).toEqual(before);
  });
}

it('does not adopt new unbound metadata arriving after the first slot observation', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const original = await readFile(f.paths.currentPath);
  const foreign = serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(7) }));
  const read = f.fileSystem.readSlot.bind(f.fileSystem);
  let appeared = false;
  f.fileSystem.readSlot = async (...args) => {
    const result = await read(...args);
    if (args[0] === 'backup' && !appeared) {
      appeared = true;
      await writeFile(f.paths.nextPath, foreign, { flag: 'wx', mode: 0o600 });
    }
    return result;
  };
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'))).rejects.toThrow();
  expect(appeared).toBe(true);
  expect(await readFile(f.paths.currentPath)).toEqual(original);
  expect(await readFile(f.paths.nextPath)).toEqual(foreign);
});

it('does not let a delayed callback turn owner cleanup into deletion-purged admission', async context => {
  const f = await fixture(context);
  await f.prepare();
  await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
  const proof = { ...f.cleanup(), mode: 'owner' as 'owner' | 'deletionPurged' };
  proof.assertExternalSelection = async () => { proof.mode = 'deletionPurged'; };
  const before = await f.snapshot();
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, proof)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.snapshot()).toEqual(before);
});

it('clears inspection metadata after its original copy is absent, without requiring that copy to reopen', async context => {
  const f = await fixture(context, 'profileInspection');
  const copy = join(f.root, 'inspection-copy');
  await mkdir(copy, { mode: 0o700 });
  await writeFile(join(copy, 'synthetic'), 'copy-bytes');
  await f.store().publish(f.binding, f.authority);
  const proof = { ...f.cleanup(), async assertPayloadsAbsent() {
    try { await lstat(copy); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    throw new Error('SYNTHETIC_COPY_REMAINS');
  } };
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, proof)).rejects.toThrow('SYNTHETIC_COPY_REMAINS');
  await rm(copy, { recursive: true });
  await f.store().clearAfterPayloadsAbsent(f.binding, proof);
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
  await expect(lstat(copy)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('acknowledges proven metadata absence without creating or synchronizing a missing directory', async context => {
  const f = await fixture(context);
  let syncs = 0;
  f.fileSystem.syncDirectory = async () => { syncs++; throw new Error('SYNTHETIC_LINUX_DIRECTORY_MISSING'); };
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'))).resolves.toBeUndefined();
  expect(syncs).toBe(0);
  expect(await readdir(f.root)).toHaveLength(0);
});

it('rejects a replaced nearest ancestor when the metadata directory is absent', async context => {
  const f = await fixture(context);
  const state = join(f.root, 'workspace-state');
  const retained = join(f.root, 'retained-original-state');
  await mkdir(state, { mode: 0o700 });
  let replaced = false;
  const store = f.store(async (path, assertCurrent) => {
    try { return await readDeletionInventoryDirectoryIdentity(path, assertCurrent); }
    catch (error) {
      if (path === f.paths.directoryPath && !replaced && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        await rename(state, retained);
        await mkdir(state, { mode: 0o700 });
        replaced = true;
      }
      throw error;
    }
  });
  await expect(store.clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'))).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(replaced).toBe(true);
  expect(await readdir(state)).toHaveLength(0);
  expect(await readdir(retained)).toHaveLength(0);
});

it.skipIf(process.platform === 'win32')('does not accept metadata absence through a linked state parent', async context => {
  const f = await fixture(context);
  const foreign = join(f.root, 'foreign-state');
  await mkdir(foreign, { mode: 0o700 });
  await symlink(foreign, join(f.root, 'workspace-state'), 'dir');
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'))).rejects.toThrow();
  expect(await readdir(foreign)).toHaveLength(0);
});
