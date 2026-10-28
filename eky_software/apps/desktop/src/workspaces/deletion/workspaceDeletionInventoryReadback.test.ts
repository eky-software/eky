import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { deletionTestHeader as header, deletionTestRecords as records } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionInventoryDirectoryReads } from './workspaceDeletionInventoryFile.js';
import { deletionInventoryStoreFixture as fixture } from './workspaceDeletionInventoryStoreTestSupport.js';
import { workspaceDeletionInventoryFileName as fileName } from './workspaceDeletionInventoryStore.js';

for (const change of ['lease', 'target', 'bytes'] as const) {
  it(`rejects ${change} changing during an actual read and joins the opened handle`, async context => {
    const f = await fixture(context);
    const selected = await f.store().publish(header, records(10), f.authority);
    const original = await readFile(f.paths.currentPath);
    let changed = false;
    const store = f.store(async (...args) => {
      const file = await f.trackedOpen(...args);
      return { ...file, async read(bytes, position) {
        const count = await file.read(bytes, position);
        if (!changed) {
          changed = true;
          if (change === 'lease') f.expire();
          if (change === 'target') f.changeTarget();
          if (change === 'bytes') {
            const altered = Buffer.from(original);
            altered[altered.length - 2] = 32;
            await writeFile(f.paths.currentPath, altered);
          }
        }
        return count;
      } };
    });
    await expect(store.inspect(selected, f.authority)).rejects.toThrow();
    expect(changed).toBe(true);
    expect(f.handles.closed).toBe(f.handles.opened);
    expect(await readdir(f.paths.directoryPath)).toEqual([fileName]);
    expect(await readFile(f.paths.currentPath)).toHaveLength(original.length);
  });
}

for (const change of ['sibling', 'target'] as const) {
  it(`rejects a late ${change} after the stream closes, without repairing it`, async context => {
    const f = await fixture(context);
    const selected = await f.store().publish(header, records(), f.authority);
    const original = await readFile(f.paths.currentPath);
    const store = f.store(async (...args) => {
      const file = await f.trackedOpen(...args);
      return { ...file, async close() {
        await file.close();
        if (change === 'sibling') await writeFile(f.paths.nextPath, 'retained-late-sibling');
        else f.changeTarget();
      } };
    });
    await expect(store.inspect(selected, f.authority)).rejects.toThrow();
    expect(await readFile(f.paths.currentPath)).toEqual(original);
    if (change === 'sibling') expect(await readFile(f.paths.nextPath, 'utf8')).toBe('retained-late-sibling');
    expect(f.handles.closed).toBe(f.handles.opened);
  });
}

for (const count of [-1, Number.NaN, 4097]) {
  it(`rejects impossible read count ${count} without leaking the reader`, async context => {
    const f = await fixture(context);
    const selected = await f.store().publish(header, records(), f.authority);
    const before = await f.snapshot();
    const store = f.store(async (...args) => ({ ...await f.trackedOpen(...args), async read() { return count; } }));
    await expect(store.inspect(selected, f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(f.handles.closed).toBe(f.handles.opened);
    expect(await f.snapshot()).toEqual(before);
  });
}

it('rejects early EOF but accepts short reads through the true EOF', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const early = f.store(async (...args) => ({ ...await f.trackedOpen(...args), async read() { return 0; } }));
  await expect(early.inspect(selected, f.authority)).rejects.toThrow();
  const short = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, read: (bytes, position) => file.read(bytes.subarray(0, 17), position) };
  });
  expect(await short.inspect(selected, f.authority)).toEqual(selected.inventory);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('awaits a pending reader close and refuses overlapping use of the same store', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  let closeReached!: () => void;
  const closing = new Promise<void>(resolve => { closeReached = resolve; });
  let releaseClose!: () => void;
  const released = new Promise<void>(resolve => { releaseClose = resolve; });
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async close() { closeReached(); await released; await file.close(); } };
  });
  let settled = false;
  const result = store.inspect(selected, f.authority).finally(() => { settled = true; });
  try {
    await closing;
    expect(settled).toBe(false);
    await expect(store.inspect(selected, f.authority)).rejects.toThrow();
  } finally { releaseClose(); }
  expect(await result).toEqual(selected.inventory);
  expect(settled).toBe(true);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('preserves an empty operation directory after exclusive file-open failure', async context => {
  const f = await fixture(context);
  const first = new Error('SYNTHETIC_OPEN_FAILED');
  const store = f.store(async () => { throw first; });
  await expect(store.publish(header, records(), f.authority)).rejects.toBe(first);
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
  await expect(f.store().publish(header, records(), f.authority)).rejects.toThrow();
  expect(f.handles.opened).toBe(0);
});

it('rejects root replacement after writer close and before publication', async context => {
  const f = await fixture(context);
  const retained = join(f.root, 'retained-operation');
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async close() {
      await file.close();
      if (args[1] === 'wx') {
        await rename(f.paths.directoryPath, retained);
        await f.prepareExisting();
      }
    } };
  });
  await expect(store.publish(header, records(), f.authority)).rejects.toThrow();
  expect(await readdir(retained)).toEqual([`${fileName}.next`]);
  expect((await readFile(join(retained, `${fileName}.next`), 'utf8')).trim().split('\n')).toHaveLength(3);
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('rejects a changed parent even when the original operation directory and file survive', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const retained = join(f.root, 'retained-parent');
  await rename(f.paths.parentPath, retained);
  await mkdir(f.paths.parentPath, { mode: 0o700 });
  await rename(join(retained, header.operationId), f.paths.directoryPath);
  const before = await f.snapshot();
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('rejects a directory at the inventory filename without changing it', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  await rename(f.paths.currentPath, join(f.root, 'retained-file'));
  await mkdir(f.paths.currentPath, { mode: 0o700 });
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  expect(await readdir(f.paths.currentPath)).toHaveLength(0);
});

for (const changed of ['identity', 'bytes'] as const) {
  it(`rejects ${changed} changing after reader close`, async context => {
    const f = await fixture(context);
    const selected = await f.store().publish(header, records(), f.authority);
    const original = await readFile(f.paths.currentPath);
    const store = f.store(async (...args) => {
      const file = await f.trackedOpen(...args);
      return { ...file, async close() {
        await file.close();
        if (changed === 'identity') {
          await rename(f.paths.currentPath, join(f.root, 'retained-original'));
          await writeFile(f.paths.currentPath, original, { flag: 'wx', mode: 0o600 });
        } else {
          const altered = Buffer.from(original);
          altered[0] = 32;
          await writeFile(f.paths.currentPath, altered);
        }
      } };
    });
    await expect(store.inspect(selected, f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(f.handles.closed).toBe(f.handles.opened);
    expect(await readFile(f.paths.currentPath)).toHaveLength(original.length);
  });
}

for (const during of ['identity', 'names'] as const) {
  it(`preserves a target change during the final ${during} read`, async context => {
    const f = await fixture(context);
    const selected = await f.store().publish(header, records(), f.authority);
    let readerClosed = false;
    let changed = false;
    const store = f.store(async (...args) => {
      const file = await f.trackedOpen(...args);
      return { ...file, async close() { await file.close(); readerClosed = true; } };
    }, {
      async identity(...args) {
        const result = await workspaceDeletionInventoryDirectoryReads.identity(...args);
        if (readerClosed && during === 'identity' && !changed) { changed = true; f.changeTarget(); }
        return result;
      },
      async names(...args) {
        const result = await workspaceDeletionInventoryDirectoryReads.names(...args);
        if (readerClosed && during === 'names' && !changed) { changed = true; f.changeTarget(); }
        return result;
      },
    });
    await expect(store.inspect(selected, f.authority)).rejects.toThrow('SYNTHETIC_TARGET_CHANGED');
    expect(changed).toBe(true);
    expect(f.handles.closed).toBe(f.handles.opened);
    expect(await readdir(f.paths.directoryPath)).toEqual([fileName]);
  });
}
