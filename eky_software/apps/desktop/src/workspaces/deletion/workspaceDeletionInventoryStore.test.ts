import { createHash } from 'node:crypto';
import { chmod, link, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { deferred } from '../../profileBackup/portableDeletionBackupTestSupport.js';
import { deletionTestDigest, deletionTestHeader as header, deletionTestRecords as records } from './workspaceDeletionDataTestSupport.js';
import { deletionInventoryReadChunkBytes } from './workspaceDeletionInventoryCodec.js';
import { deletionInventoryStoreFixture as fixture } from './workspaceDeletionInventoryStoreTestSupport.js';
import { createWorkspaceDeletionInventoryPaths, workspaceDeletionInventoryFileName as fileName } from './workspaceDeletionInventoryStore.js';

it('publishes a real large inventory with progressive writes and bounded readback, and reads it after restart', async context => {
  const f = await fixture(context);
  const positions: number[] = [];
  let largestRead = 0;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file,
      async write(bytes, position) { positions.push(position); return file.write(bytes, position); },
      async read(bytes, position) { largestRead = Math.max(largestRead, bytes.length); return file.read(bytes, position); },
    };
  });
  const selected = await store.publish(header, records(300), f.authority);
  const bytes = await readFile(f.paths.currentPath);
  expect(bytes.byteLength).toBeGreaterThan(16 * 1024);
  expect(selected.inventory).toEqual({ formatVersion: 2, byteLength: bytes.byteLength, recordCount: 300,
    sha256: createHash('sha256').update(bytes).digest('hex') });
  expect(positions).toHaveLength(301);
  expect(positions[0]).toBe(0);
  expect(positions.every((value, index) => index === 0 || value > positions[index - 1]!)).toBe(true);
  expect(largestRead).toBe(deletionInventoryReadChunkBytes);
  expect(await f.store().inspect(selected, f.authority)).toEqual(selected.inventory);
  expect(await readdir(f.paths.directoryPath)).toEqual([fileName]);
  expect(await readdir(join(f.root, 'workspace-state'))).toEqual(['workspace-deletion-inventories']);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('finishes short writes at increasing offsets without losing bytes', async context => {
  const f = await fixture(context);
  let shortWrites = 0;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async write(bytes, position) {
      shortWrites++;
      return file.write(bytes.subarray(0, Math.min(bytes.length, 111)), position);
    } };
  });
  const selected = await store.publish(header, records(2), f.authority);
  expect(shortWrites).toBeGreaterThan(3);
  expect(await f.store().inspect(selected, f.authority)).toEqual(selected.inventory);
});

for (const fault of ['beforeWrite', 'afterWrite', 'sync', 'close', 'beforePublish', 'afterPublish', 'directorySync', 'readback'] as const) {
  it(`retains the original publication failure and owned bytes for ${fault}`, async context => {
    const f = await fixture(context);
    const first = new Error(`SYNTHETIC_${fault}`);
    const store = f.store(async (...args) => {
      if (fault === 'readback' && args[0] === f.paths.currentPath && args[1] === 'r') throw first;
      const file = await f.trackedOpen(...args);
      return { ...file,
        async write(bytes, position) {
          if (fault === 'beforeWrite') throw first;
          const count = await file.write(bytes, position);
          if (fault === 'afterWrite') throw first;
          return count;
        },
        async sync() { await file.sync(); if (fault === 'sync') throw first; },
        async close() { await file.close(); if (fault === 'close' && args[1] === 'wx') throw first; },
      };
    });
    const move = f.fileSystem.moveSlot.bind(f.fileSystem);
    f.fileSystem.moveSlot = async (...args) => {
      if (fault === 'beforePublish') throw first;
      await move(...args);
      if (fault === 'afterPublish') throw first;
    };
    const sync = f.fileSystem.syncDirectory.bind(f.fileSystem);
    f.fileSystem.syncDirectory = async (...args) => { await sync(...args); if (fault === 'directorySync') throw first; };
    await expect(store.publish(header, records(), f.authority)).rejects.toBe(first);
    expect(f.handles.closed).toBe(f.handles.opened);
    const published = ['afterPublish', 'directorySync', 'readback'].includes(fault);
    expect(await readdir(f.paths.directoryPath)).toEqual([published ? fileName : `${fileName}.next`]);
    const before = await f.snapshot();
    await expect(f.store().publish(header, records(), f.authority)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });
}

for (const stage of ['write', 'read'] as const) {
  it(`preserves the first ${stage} failure and joins a later close failure`, async context => {
    const f = await fixture(context);
    const first = new Error('SYNTHETIC_FIRST');
    const later = new Error('SYNTHETIC_CLOSE');
    const store = f.store(async (...args) => {
      const file = await f.trackedOpen(...args);
      const selected = args[1] === (stage === 'write' ? 'wx' : 'r');
      return { ...file,
        async write(bytes, position) { if (selected && stage === 'write') throw first; return file.write(bytes, position); },
        async read(bytes, position) { if (selected && stage === 'read') throw first; return file.read(bytes, position); },
        async close() { await file.close(); if (selected) throw later; },
      };
    });
    await expect(store.publish(header, records(), f.authority)).rejects.toMatchObject({ errors: [first, later] });
    expect(f.handles.closed).toBe(f.handles.opened);
    expect(await readdir(f.paths.directoryPath)).toEqual([`${fileName}.next`]);
  });
}

it('retains partial-next and closes the writer when the inventory source itself fails', async context => {
  const f = await fixture(context);
  const first = new Error('SYNTHETIC_SOURCE_FAILED');
  async function* source() { yield* records(1); throw first; }
  await expect(f.store().publish(header, source(), f.authority)).rejects.toBe(first);
  expect(await readdir(f.paths.directoryPath)).toEqual([`${fileName}.next`]);
  expect((await readFile(f.paths.nextPath, 'utf8')).trim().split('\n')).toHaveLength(2);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['lease', 'target'] as const)('waits for a held source and rejects %s loss before inventory publication', async (change, context) => {
  const f = await fixture(context);
  const entered = deferred(), release = deferred();
  let sourceClosed = false, settled = false;
  async function* source() {
    try {
      yield* records(1);
      entered.resolve();
      await release.promise;
    } finally { sourceClosed = true; }
  }
  const work = f.store().publish(header, source(), f.authority).finally(() => { settled = true; });
  try {
    await entered.promise;
    if (change === 'lease') f.expire(); else f.changeTarget();
    expect(settled).toBe(false);
  } finally { release.resolve(); }
  await expect(work).rejects.toThrow(change === 'lease' ? 'SYNTHETIC_LEASE_LOST' : 'SYNTHETIC_TARGET_CHANGED');
  expect(sourceClosed).toBe(true);
  expect(f.handles.closed).toBe(f.handles.opened);
  expect(await readdir(f.paths.directoryPath)).toEqual([`${fileName}.next`]);
  expect((await readFile(f.paths.nextPath, 'utf8')).trim().split('\n')).toHaveLength(2);
});

for (const change of ['lease', 'target'] as const) {
  it(`stops publication on ${change} loss after opening and still closes the file`, async context => {
    const f = await fixture(context);
    const store = f.store(async (...args) => {
      const file = await f.trackedOpen(...args);
      if (change === 'lease') f.expire(); else f.changeTarget();
      return file;
    });
    await expect(store.publish(header, records(), f.authority)).rejects.toThrow(
      change === 'lease' ? 'SYNTHETIC_LEASE_LOST' : 'SYNTHETIC_TARGET_CHANGED');
    expect(f.handles.closed).toBe(f.handles.opened);
    expect(await readdir(f.paths.directoryPath)).toEqual([`${fileName}.next`]);
    expect(await readFile(f.paths.nextPath)).toHaveLength(0);
  });
}

for (const contents of ['empty', 'next', 'current', 'foreign'] as const) {
  it(`never adopts an existing ${contents} operation directory`, async context => {
    const f = await fixture(context);
    await f.prepareExisting();
    if (contents !== 'empty') await writeFile(join(f.paths.directoryPath,
      contents === 'next' ? `${fileName}.next` : contents === 'current' ? fileName : 'foreign'), 'preserve', { mode: 0o600 });
    const before = await f.snapshot();
    await expect(f.store().publish(header, records(), f.authority)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.handles.opened).toBe(0);
  });
}

for (const changed of ['hash', 'length', 'count', 'fileIdentity', 'rootIdentity', 'parentIdentity', 'header'] as const) {
  it(`refuses a changed ${changed} selection without altering the inventory`, async context => {
    const f = await fixture(context);
    const selected = await f.store().publish(header, records(), f.authority);
    const before = await f.snapshot();
    const altered = { ...selected, inventory: { ...selected.inventory } };
    if (changed === 'hash') altered.inventory.sha256 = deletionTestDigest('different');
    if (changed === 'length') altered.inventory.byteLength++;
    if (changed === 'count') altered.inventory.recordCount++;
    if (changed === 'fileIdentity') altered.inventoryFileIdentity = deletionTestDigest('different');
    if (changed === 'rootIdentity') altered.operationRootIdentity = deletionTestDigest('different');
    if (changed === 'parentIdentity') altered.operationParentIdentity = deletionTestDigest('different');
    if (changed === 'header') altered.target = { ...header, registryEntrySha256: deletionTestDigest('different') };
    await expect(f.store().inspect(altered, f.authority)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.handles.closed).toBe(f.handles.opened);
  });
}

it('rejects changed actual bytes and then an identical replacement inode, without repairing either', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const original = await readFile(f.paths.currentPath);
  const changed = Buffer.from(original);
  changed[0] = 32;
  await writeFile(f.paths.currentPath, changed);
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(changed);
  await rename(f.paths.currentPath, join(f.root, 'retained-original'));
  await writeFile(f.paths.currentPath, original, { flag: 'wx', mode: 0o600 });
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(original);
});

it('rejects a replaced operation directory even when its original inventory inode is moved along', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const moved = join(f.root, 'retained-root');
  await rename(f.paths.directoryPath, moved);
  await f.prepareExisting();
  await rename(join(moved, fileName), f.paths.currentPath);
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  expect(await readdir(f.paths.directoryPath)).toEqual([fileName]);
});

it('rejects current with any extra sibling and does not discard the sibling', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  await writeFile(f.paths.nextPath, 'preserve');
  const before = await f.snapshot();
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('rejects a hardlinked inventory without modifying either name', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const second = join(f.root, 'second-link');
  await link(f.paths.currentPath, second);
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(await readFile(second));
});

it.skipIf(process.platform === 'win32')('rejects linked inventory paths and non-private files', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  await chmod(f.paths.currentPath, 0o644);
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  await chmod(f.paths.currentPath, 0o600);
  const retained = join(f.root, 'retained-file');
  await rename(f.paths.currentPath, retained);
  await symlink(retained, f.paths.currentPath);
  await expect(f.store().inspect(selected, f.authority)).rejects.toThrow();
  expect(await readFile(retained)).toHaveLength(selected.inventory.byteLength);
});

for (const count of [0, -1, Number.NaN, 5000]) {
  it(`rejects an impossible writer result ${count} and closes the writer`, async context => {
    const f = await fixture(context);
    const store = f.store(async (...args) => ({ ...await f.trackedOpen(...args), async write() { return count; } }));
    await expect(store.publish(header, records(), f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(f.handles.closed).toBe(f.handles.opened);
    expect(await readdir(f.paths.directoryPath)).toEqual([`${fileName}.next`]);
  });
}

it('rejects noncanonical roots and operation identifiers before any IO', async context => {
  const f = await fixture(context);
  for (const root of ['relative', `${f.root}\0invalid`, `${f.root}/../other`]) {
    expect(() => createWorkspaceDeletionInventoryPaths(root, header.operationId)).toThrow();
  }
  for (const id of ['../other', '', header.operationId.toUpperCase().replace('4', 'x')]) {
    expect(() => createWorkspaceDeletionInventoryPaths(f.root, id)).toThrow();
  }
  await expect(f.store().publish({ ...header, operationId: '00000000-0000-4000-8000-000000000003' }, records(), f.authority)).rejects.toThrow();
  expect(await readdir(f.root)).toHaveLength(0);
});

it('does not allow a promise to masquerade as a synchronous lease assertion', async context => {
  const f = await fixture(context);
  await expect(f.store().publish(header, records(), { ...f.authority, assertAuthority: async () => {} })).rejects.toThrow();
  expect(await readdir(f.root)).toHaveLength(0);
});
