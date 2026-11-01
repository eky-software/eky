import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id,
  deletionTestRecord as record, deletionTestRecords as records } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryRecord, deletionInventoryLine, deletionInventoryReadChunkBytes,
  type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { workspaceDeletionInventoryDirectoryReads } from './workspaceDeletionInventoryFile.js';
import { deletionInventoryStoreFixture as fixture } from './workspaceDeletionInventoryStoreTestSupport.js';
import * as stream from './workspaceDeletionInventoryStream.js';

const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function* source(rows: readonly WorkspaceDeletionInventoryRecord[]) { yield* rows; }
function evidence() {
  return captureDeletionInventoryRecord({ ...record(), role: 'inspectionEvidence', generationId: id(1001) });
}
function workspace() {
  return captureDeletionInventoryRecord({ ...record(), role: 'workspace', ownerOperationId: null, bindingSha256: null });
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function rewrite(f: Fixture, original: Buffer, changeBytes = true) {
  const before = await stat(f.paths.currentPath);
  await writeFile(f.paths.currentPath, changeBytes ? original.toString().replace(hash('root-1'), hash('changed')) : original);
  // Deterministic metadata change, including filesystems with coarse write timestamps.
  await utimes(f.paths.currentPath, before.atime, new Date(before.mtimeMs + 2_000));
}

const changes = ['replacement', 'rewrite', 'metadata', 'parent', 'root', 'sibling', 'lease', 'selection'] as const;
type Change = typeof changes[number];
async function changeInventory(f: Fixture, original: Buffer, change: Change) {
  if (change === 'lease') f.expire();
  if (change === 'selection') f.changeTarget();
  if (change === 'rewrite' || change === 'metadata') await rewrite(f, original, change === 'rewrite');
  if (change === 'sibling') await writeFile(f.paths.nextPath, 'retained-sibling', { mode: 0o600 });
  if (change === 'replacement') {
    await rename(f.paths.currentPath, join(f.root, 'retained-inventory'));
    await writeFile(f.paths.currentPath, original, { mode: 0o600, flag: 'wx' });
  }
  if (change === 'root') {
    await rename(f.paths.directoryPath, join(f.root, 'retained-operation'));
    await mkdir(f.paths.directoryPath, { mode: 0o700 });
    await writeFile(f.paths.currentPath, original, { mode: 0o600, flag: 'wx' });
  }
  if (change === 'parent') {
    const retained = join(f.root, 'retained-parent');
    await rename(f.paths.parentPath, retained);
    await mkdir(f.paths.parentPath, { mode: 0o700 });
    await rename(join(retained, header.operationId), f.paths.directoryPath);
  }
}

it.for([0, 128])('validates through EOF, then consumes %s rows with bounded linear reads on one handle', async (count, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(count), f.authority);
  const before = await f.snapshot();
  const opened = f.handles.opened;
  let starts = 0;
  let ends = 0;
  let bytesRead = 0;
  let delivered = 0;
  const store = f.store(async (...args) => {
    expect(args[1]).toBe('r');
    const file = await f.trackedOpen(...args);
    return { ...file, async read(bytes, position) {
      expect(bytes.length).toBeLessThanOrEqual(deletionInventoryReadChunkBytes);
      if (position === 0) starts++;
      const size = await file.read(bytes, position);
      bytesRead += size;
      if (size === 0) ends++;
      return size;
    } };
  });
  await expect(store.consumeSelectedRecords(selected, f.authority, async row => {
    expect(ends).toBe(1);
    expect(Object.isFrozen(row)).toBe(true);
    expect(row).toEqual(record(++delivered));
  })).resolves.toBeUndefined();
  expect(delivered).toBe(count);
  expect(starts).toBe(2);
  expect(ends).toBe(2);
  expect(bytesRead).toBe(2 * selected.inventory.byteLength);
  expect(f.handles.opened - opened).toBe(1);
  expect(f.handles.closed).toBe(f.handles.opened);
  expect(await f.snapshot()).toEqual(before);
});

it('rejects a missing consumer before opening the inventory', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const opened = f.handles.opened;
  await expect(f.store().consumeSelectedRecords(selected, f.authority,
    undefined as unknown as (row: WorkspaceDeletionInventoryRecord) => Promise<void>)).rejects.toThrow(invalidCode);
  expect(f.handles.opened).toBe(opened);
});

it.for(['tail', 'hash', 'count', 'cross-role'] as const)('delivers zero rows for invalid %s', async (fault, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  let bytes = await readFile(f.paths.currentPath);
  let recordCount = selected.inventory.recordCount;
  if (fault === 'tail') bytes = Buffer.concat([bytes, Buffer.from('{')]);
  if (fault === 'cross-role') {
    const rows = [captureDeletionInventoryRecord({ ...evidence(), role: 'inspection' }), evidence(), workspace()];
    bytes = Buffer.concat([deletionInventoryLine(header), ...rows.map(deletionInventoryLine)]);
    recordCount = rows.length;
  }
  await writeFile(f.paths.currentPath, bytes);
  const altered = { ...selected, inventory: { ...selected.inventory, byteLength: bytes.length,
    recordCount: fault === 'count' ? recordCount + 1 : recordCount,
    sha256: fault === 'hash' ? hash('wrong') : createHash('sha256').update(bytes).digest('hex') } };
  const consume = vi.fn(async () => {});
  await expect(f.store().consumeSelectedRecords(altered, f.authority, consume)).rejects.toThrow(invalidCode);
  expect(consume).not.toHaveBeenCalled();
  expect(await readFile(f.paths.currentPath)).toEqual(bytes);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('finishes cross-role inspection before delivering evidence and preserves every file', async context => {
  const f = await fixture(context);
  const rows = [evidence(), workspace()];
  const retained = join(f.root, 'retained-evidence');
  await writeFile(retained, 'synthetic-inspection-evidence', { mode: 0o600 });
  const selected = await f.store().publish(header, source(rows), f.authority);
  const before = await f.snapshot();
  let ends = 0;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async read(bytes, position) {
      const size = await file.read(bytes, position);
      if (size === 0) ends++;
      return size;
    } };
  });
  const consume = vi.fn(async () => { expect(ends).toBe(3); });
  await store.consumeSelectedRecords(selected, f.authority, consume);
  expect(consume.mock.calls).toEqual(rows.map(row => [row]));
  expect(ends).toBe(4);
  expect(await readFile(retained, 'utf8')).toBe('synthetic-inspection-evidence');
  expect(await f.snapshot()).toEqual(before);
  expect(f.handles.closed).toBe(f.handles.opened);
});

for (const boundary of ['validation EOF', 'first replay read'] as const) {
  it.for(changes)(`rejects %s at ${boundary} before any callback`, async (change, context) => {
    const f = await fixture(context);
    const selected = await f.store().publish(header, records(), f.authority);
    const original = await readFile(f.paths.currentPath);
    let starts = 0;
    let changed = false;
    const store = f.store(async (...args) => {
      const file = await f.trackedOpen(...args);
      return { ...file, async read(bytes, position) {
        if (position === 0) starts++;
        const size = await file.read(bytes, position);
        if (!changed && (boundary === 'validation EOF' ? size === 0 : starts === 2)) {
          changed = true;
          await changeInventory(f, original, change);
        }
        return size;
      } };
    });
    const consume = vi.fn(async () => {});
    await expect(store.consumeSelectedRecords(selected, f.authority, consume)).rejects.toThrow();
    expect(changed).toBe(true);
    expect(consume).not.toHaveBeenCalled();
    expect(await readFile(f.paths.currentPath)).toHaveLength(original.length);
    expect(f.handles.closed).toBe(f.handles.opened);
  });
}

it.for(changes)('rejects %s between callbacks even when both rows share a chunk', async (change, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const original = await readFile(f.paths.currentPath);
  expect(original.length).toBeLessThan(deletionInventoryReadChunkBytes);
  let starts = 0;
  let replayReads = 0;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async read(bytes, position) {
      if (position === 0) starts++;
      if (starts === 2) replayReads++;
      return file.read(bytes, position);
    } };
  });
  const consume = vi.fn(async () => { await changeInventory(f, original, change); });
  await expect(store.consumeSelectedRecords(selected, f.authority, consume)).rejects.toThrow();
  expect(consume.mock.calls).toEqual([[record()]]);
  expect(replayReads).toBe(1);
  expect(await readFile(f.paths.currentPath)).toHaveLength(original.length);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('checks a buffered row after next resolves and explicitly closes the reader on rejection', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const original = await readFile(f.paths.currentPath);
  const originalReader = stream.readDeletionInventoryRecords;
  const spy = vi.spyOn(stream, 'readDeletionInventoryRecords');
  context.onTestFinished(() => { spy.mockRestore(); });
  let obtained = 0;
  let returned = 0;
  spy.mockImplementation((...args) => {
    const reader = originalReader(...args);
    const next = reader.next.bind(reader);
    const close = reader.return.bind(reader);
    reader.next = async (...input) => {
      const row = await next(...input);
      if (!row.done && ++obtained === 2) await rewrite(f, original);
      return row;
    };
    reader.return = async value => { returned++; return close(value); };
    return reader;
  });
  const consume = vi.fn(async () => {});
  await expect(f.store().consumeSelectedRecords(selected, f.authority, consume)).rejects.toThrow(invalidCode);
  expect(consume.mock.calls).toEqual([[record()]]);
  expect(obtained).toBe(2);
  expect(returned).toBe(1);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('awaits each slow consumer before another row, EOF, or file close', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const entered = gate();
  const release = gate();
  let ends = 0;
  let delivered = 0;
  let inFlight = 0;
  let settled = false;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async read(bytes, position) {
      const size = await file.read(bytes, position);
      if (size === 0) ends++;
      return size;
    } };
  });
  const result = store.consumeSelectedRecords(selected, f.authority, async row => {
    expect(++inFlight).toBe(1);
    expect(row).toEqual(record(++delivered));
    if (delivered === 1) { entered.release(); await release.promise; }
    inFlight--;
  }).then(() => undefined, error => error).finally(() => { settled = true; });
  try {
    await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_CONSUMER_NOT_PENDING'); })]);
    expect(settled).toBe(false);
    expect(delivered).toBe(1);
    expect(ends).toBe(1);
    expect(f.handles.opened - f.handles.closed).toBe(1);
    await expect(store.inspect(selected, f.authority)).rejects.toThrow(invalidCode);
  } finally { release.release(); await result; }
  expect(await result).toBeUndefined();
  expect(delivered).toBe(2);
  expect(ends).toBe(2);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('awaits the replay EOF read and rechecks selection before closing', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const entered = gate();
  const release = gate();
  let ends = 0;
  let settled = false;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async read(bytes, position) {
      const size = await file.read(bytes, position);
      if (size === 0 && ++ends === 2) { entered.release(); await release.promise; }
      return size;
    } };
  });
  const consume = vi.fn(async () => {});
  const result = store.consumeSelectedRecords(selected, f.authority, consume)
    .then(() => undefined, error => error).finally(() => { settled = true; });
  try {
    await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_EOF_NOT_PENDING'); })]);
    expect(settled).toBe(false);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(f.handles.opened - f.handles.closed).toBe(1);
    await expect(store.inspect(selected, f.authority)).rejects.toThrow(invalidCode);
    f.changeTarget();
  } finally { release.release(); await result; }
  expect(await result).toMatchObject({ message: 'SYNTHETIC_TARGET_CHANGED' });
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['consumer', 'undefined consumer', 'validation read', 'replay read', 'none'] as const)(
  'preserves the %s cause before a file-close failure', async (fault, context) => {
    const f = await fixture(context);
    const selected = await f.store().publish(header, records(), f.authority);
    const before = await f.snapshot();
    const first = fault === 'undefined consumer' ? undefined : new Error('SYNTHETIC_FIRST');
    const last = new Error('SYNTHETIC_CLOSE');
    let starts = 0;
    const store = f.store(async (...args) => {
      const file = await f.trackedOpen(...args);
      return { ...file, async read(bytes, position) {
        if (position === 0) starts++;
        if ((fault === 'validation read' && starts === 1) || (fault === 'replay read' && starts === 2)) throw first;
        return file.read(bytes, position);
      }, async close() { await file.close(); throw last; } };
    });
    const consume = vi.fn(async () => { if (fault === 'consumer' || fault === 'undefined consumer') throw first; });
    const result = store.consumeSelectedRecords(selected, f.authority, consume);
    if (fault === 'none') await expect(result).rejects.toBe(last);
    else await expect(result).rejects.toMatchObject({ errors: [first, last] });
    expect(consume).toHaveBeenCalledTimes(fault === 'none' ? 2 : fault.includes('consumer') ? 1 : 0);
    expect(await f.snapshot()).toEqual(before);
    expect(f.handles.closed).toBe(f.handles.opened);
  });

it('retains consumer, iterator-close, and file-close errors in causal order', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const first = new Error('SYNTHETIC_CONSUMER');
  const iteratorClose = new Error('SYNTHETIC_ITERATOR_CLOSE');
  const fileClose = new Error('SYNTHETIC_FILE_CLOSE');
  const originalReader = stream.readDeletionInventoryRecords;
  const spy = vi.spyOn(stream, 'readDeletionInventoryRecords');
  context.onTestFinished(() => { spy.mockRestore(); });
  let returned = 0;
  spy.mockImplementation((...args) => {
    const reader = originalReader(...args);
    const close = reader.return.bind(reader);
    reader.return = async value => { returned++; await close(value); throw iteratorClose; };
    return reader;
  });
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async close() { expect(returned).toBe(1); await file.close(); throw fileClose; } };
  });
  await expect(store.consumeSelectedRecords(selected, f.authority, async () => { throw first; }))
    .rejects.toMatchObject({ errors: [expect.objectContaining({ errors: [first, iteratorClose] }), fileClose] });
  expect(returned).toBe(1);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['success', 'consumer failure'] as const)('joins a pending iterator close after %s', async (outcome, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const entered = gate();
  const release = gate();
  const first = new Error('SYNTHETIC_CONSUMER');
  const originalReader = stream.readDeletionInventoryRecords;
  const spy = vi.spyOn(stream, 'readDeletionInventoryRecords');
  context.onTestFinished(() => { spy.mockRestore(); });
  let returned = false;
  let settled = false;
  spy.mockImplementation((...args) => {
    const reader = originalReader(...args);
    const close = reader.return.bind(reader);
    reader.return = async value => {
      entered.release();
      await release.promise;
      const result = await close(value);
      returned = true;
      return result;
    };
    return reader;
  });
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async close() { expect(returned).toBe(true); await file.close(); } };
  });
  const result = store.consumeSelectedRecords(selected, f.authority, async () => {
    if (outcome === 'consumer failure') throw first;
  }).then(() => undefined, error => error).finally(() => { settled = true; });
  try {
    await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_ITERATOR_NOT_PENDING'); })]);
    expect(settled).toBe(false);
    expect(returned).toBe(false);
    expect(f.handles.opened - f.handles.closed).toBe(1);
    await expect(store.inspect(selected, f.authority)).rejects.toThrow(invalidCode);
  } finally { release.release(); await result; }
  expect(await result).toBe(outcome === 'consumer failure' ? first : undefined);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['success', 'consumer failure'] as const)('holds exclusivity until pending close settles after %s', async (outcome, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const entered = gate();
  const release = gate();
  const first = new Error('SYNTHETIC_CONSUMER');
  let settled = false;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async close() { entered.release(); await release.promise; await file.close(); } };
  });
  const result = store.consumeSelectedRecords(selected, f.authority, async () => {
    if (outcome === 'consumer failure') throw first;
  }).then(() => undefined, error => error).finally(() => { settled = true; });
  try {
    await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_CLOSE_NOT_PENDING'); })]);
    expect(settled).toBe(false);
    expect(f.handles.opened - f.handles.closed).toBe(1);
    await expect(store.inspect(selected, f.authority)).rejects.toThrow(invalidCode);
    await expect(store.assertRecords(selected, records(), f.authority)).rejects.toThrow(invalidCode);
    await expect(store.consumeSelectedRecords(selected, f.authority, async () => {})).rejects.toThrow(invalidCode);
  } finally { release.release(); await result; }
  expect(await result).toBe(outcome === 'consumer failure' ? first : undefined);
  expect(await store.inspect(selected, f.authority)).toEqual(selected.inventory);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['replay EOF', 'file close', 'final names'] as const)('rejects selection loss at %s after delivery', async (boundary, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const before = await f.snapshot();
  let ends = 0;
  let closed = false;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async read(bytes, position) {
      const size = await file.read(bytes, position);
      if (size === 0 && ++ends === 2 && boundary === 'replay EOF') f.changeTarget();
      return size;
    }, async close() { await file.close(); closed = true; if (boundary === 'file close') f.changeTarget(); } };
  }, { ...workspaceDeletionInventoryDirectoryReads, async names(...args) {
    const names = await workspaceDeletionInventoryDirectoryReads.names(...args);
    if (closed && boundary === 'final names') f.changeTarget();
    return names;
  } });
  const consume = vi.fn(async () => {});
  await expect(store.consumeSelectedRecords(selected, f.authority, consume)).rejects.toThrow('SYNTHETIC_TARGET_CHANGED');
  expect(consume).toHaveBeenCalledTimes(2);
  expect(await f.snapshot()).toEqual(before);
  expect(f.handles.closed).toBe(f.handles.opened);
});
