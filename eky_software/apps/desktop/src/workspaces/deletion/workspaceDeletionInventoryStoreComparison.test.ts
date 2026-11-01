import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { captureDeletionInventoryRecord, deletionInventoryLine } from './workspaceDeletionInventoryCodec.js';
import { deletionTestDigest as hash, deletionTestHeader as header,
  deletionTestId as id, deletionTestRecord as record, deletionTestRecords as records } from './workspaceDeletionDataTestSupport.js';
import { deletionInventoryStoreFixture as fixture } from './workspaceDeletionInventoryStoreTestSupport.js';

it('compares a published inventory using one pinned file and preserves its bytes', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(70), f.authority);
  const before = await f.snapshot();
  const opened = f.handles.opened;
  let eof = false;
  async function* expected() { yield* records(70); eof = true; }
  await expect(f.store().assertRecords(selected, expected(), f.authority)).resolves.toBeUndefined();
  expect(eof).toBe(true);
  expect(f.handles.opened - opened).toBe(1);
  expect(f.handles.closed).toBe(f.handles.opened);
  expect(await f.snapshot()).toEqual(before);
});

it('retains cross-role inspection checks alongside exact comparison', async context => {
  const f = await fixture(context);
  async function* expected() {
    yield captureDeletionInventoryRecord({ ...record(), role: 'inspectionEvidence', generationId: id(1001) });
    yield captureDeletionInventoryRecord({ ...record(), role: 'workspace', ownerOperationId: null, bindingSha256: null });
  }
  const selected = await f.store().publish(header, expected(), f.authority);
  await expect(f.store().assertRecords(selected, expected(), f.authority)).resolves.toBeUndefined();
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('rejects conflicting inspection roles with a valid hash before opening the expected source', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const evidence = captureDeletionInventoryRecord({ ...record(), role: 'inspectionEvidence', generationId: id(1001) });
  const payload = captureDeletionInventoryRecord({ ...evidence, role: 'inspection' });
  const workspace = captureDeletionInventoryRecord({ ...record(), role: 'workspace', ownerOperationId: null, bindingSha256: null });
  const rows = [payload, evidence, workspace];
  const bytes = Buffer.concat([deletionInventoryLine(header), ...rows.map(deletionInventoryLine)]);
  await writeFile(f.paths.currentPath, bytes);
  const altered = { ...selected, inventory: { ...selected.inventory, byteLength: bytes.length, recordCount: rows.length,
    sha256: createHash('sha256').update(bytes).digest('hex') } };
  let sourceOpened = false;
  async function* expected() { yield* rows; }
  const source = { [Symbol.asyncIterator]() { sourceOpened = true; return expected(); } };
  await expect(f.store().assertRecords(altered, source, f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(sourceOpened).toBe(false);
  expect(await readFile(f.paths.currentPath)).toEqual(bytes);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['missing', 'extra', 'identity'] as const)('rejects %s source rows without changing retained files', async (change, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const before = await f.snapshot();
  async function* expected() {
    if (change === 'identity') { yield { ...record(), rootIdentity: hash('changed') }; yield record(2); }
    else yield* records(change === 'missing' ? 1 : 3);
  }
  await expect(f.store().assertRecords(selected, expected(), f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(await f.snapshot()).toEqual(before);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['lease', 'target', 'bytes', 'sibling'] as const)('rejects %s changes at the expected EOF', async (change, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const original = await readFile(f.paths.currentPath);
  async function* expected() {
    yield* records();
    if (change === 'lease') f.expire();
    if (change === 'target') f.changeTarget();
    if (change === 'bytes') await writeFile(f.paths.currentPath, original.toString().replace(hash('root-1'), hash('changed')));
    if (change === 'sibling') await writeFile(f.paths.nextPath, 'retained-late-sibling');
  }
  await expect(f.store().assertRecords(selected, expected(), f.authority)).rejects.toThrow();
  if (change === 'sibling') expect(await readFile(f.paths.nextPath, 'utf8')).toBe('retained-late-sibling');
  if (change !== 'bytes') expect(await readFile(f.paths.currentPath)).toEqual(original);
  else expect(await readFile(f.paths.currentPath, 'utf8')).toContain(hash('changed'));
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('rejects new bytes in the comparison pass even if the source agrees with the changed rows', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const original = await readFile(f.paths.currentPath, 'utf8');
  let starts = 0;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async read(bytes, position) {
      if (position === 0 && ++starts === 2) {
        await writeFile(f.paths.currentPath, original.replace(hash('root-1'), hash('changed')));
      }
      return file.read(bytes, position);
    } };
  });
  async function* expected() { yield { ...record(), rootIdentity: hash('changed') }; yield record(2); }
  await expect(store.assertRecords(selected, expected(), f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(starts).toBe(2);
  expect(await readFile(f.paths.currentPath, 'utf8')).toContain(hash('changed'));
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('preserves a source failure and both the source-close and file-close failures', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const first = new Error('SYNTHETIC_SOURCE_READ');
  const sourceClose = new Error('SYNTHETIC_SOURCE_CLOSE');
  const fileClose = new Error('SYNTHETIC_FILE_CLOSE');
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async close() { await file.close(); throw fileClose; } };
  });
  const expected = { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<ReturnType<typeof record>>> { throw first; },
    async return(): Promise<IteratorResult<ReturnType<typeof record>>> { throw sourceClose; },
  }; } };
  await expect(store.assertRecords(selected, expected, f.authority))
    .rejects.toMatchObject({ errors: [expect.objectContaining({ errors: [first, sourceClose] }), fileClose] });
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['read', 'close'] as const)('joins a pending source %s before releasing the store or file', async (pending, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, records(), f.authority);
  const before = await f.snapshot();
  let reach!: () => void;
  const reached = new Promise<void>(resolve => { reach = resolve; });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const store = f.store();
  let settled = false;
  async function* expected() {
    try {
      if (pending === 'read') { reach(); await released; yield* records(); }
      else yield record(3);
    } finally {
      if (pending === 'close') { reach(); await released; }
    }
  }
  const result = store.assertRecords(selected, expected(), f.authority)
    .then(() => undefined, error => error).finally(() => { settled = true; });
  try {
    await Promise.race([reached, result.then(() => { throw new Error('SYNTHETIC_EXPECTED_PENDING_SOURCE'); })]);
    expect(settled).toBe(false);
    expect(f.handles.opened - f.handles.closed).toBe(1);
    await expect(store.inspect(selected, f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    f.expire();
  } finally { release(); await result; }
  expect(await result).toBeInstanceOf(Error);
  expect(f.handles.closed).toBe(f.handles.opened);
  expect(await f.snapshot()).toEqual(before);
});
