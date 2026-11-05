import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { deletionInventoryStoreFixture as fixture } from './workspaceDeletionInventoryStoreTestSupport.js';
import { deletionTestHeader as header, deletionTestRecords as records, deletionTestRecord as record,
  deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryRecord, deletionInventoryLine, deletionInventoryFormatVersion } from './workspaceDeletionInventoryCodec.js';
import { assertDeletionInventoryRecords, encodeDeletionInventory, inspectDeletionInventory,
  readDeletionInventoryRecords } from './workspaceDeletionInventoryStream.js';
import { withDeletionInventoryFile } from './workspaceDeletionInventoryFile.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { deletionRoleSourceFixture } from './workspaceDeletionRolesTestSupport.js';
import { remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import { workspaceDeletionRemnantReads as nativeSourceReads } from './workspaceDeletionRemnantCensus.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

function lifecycle() {
  let active = true;
  const failures: unknown[] = [];
  return { failures,
    fail(error: unknown) { active = false; failures.push(error); },
    assertActive() { if (!active) throw new Error('SYNTHETIC_READ_SCOPE_EXPIRED'); },
  };
}

it.for(['parser', 'read', 'commitment'] as const)('expires on %s failure before waiting for byte-source close', async (mode, context) => {
  const scope = lifecycle(), entered = gate(), close = gate();
  const first = new Error('SYNTHETIC_BYTE_READ');
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records(0)), header);
  const encoded = encodeDeletionInventory(header, records(0));
  let settled = false, closed = 0;
  const chunks = { [Symbol.asyncIterator]() { return {
    async next() {
      if (mode === 'read') throw first;
      if (mode === 'parser') return { done: false as const, value: Buffer.from('invalid-json\n') };
      return encoded.next();
    },
    async return() { entered.release(); await close.promise; closed++; return { done: true as const, value: undefined }; },
  }; } };
  const work = (async () => {
    for await (const _ of readDeletionInventoryRecords(chunks, header,
      mode === 'commitment' ? { ...commitment, recordCount: 1 } : undefined, scope.fail)) {}
  })().then(() => undefined, error => error).finally(() => { settled = true; });
  context.onTestFinished(async () => { close.release(); await work; });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('CLOSE_NOT_ENTERED'); })]);
    expect(settled).toBe(false);
    expect(scope.failures).not.toHaveLength(0);
    expect(() => scope.assertActive()).toThrow('SYNTHETIC_READ_SCOPE_EXPIRED');
    if (mode === 'read') expect(scope.failures[0]).toBe(first);
  } finally { close.release(); }
  expect(await work).toBeInstanceOf(Error);
  expect(closed).toBe(1);
});

it('expires on row mismatch before joining the expected iterator', async context => {
  const scope = lifecycle(), entered = gate(), close = gate();
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records()), header);
  let closed = 0, settled = false;
  const source = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: record(3) }; },
    async return() { entered.release(); await close.promise; closed++; return { done: true as const, value: undefined }; },
  }; } };
  const work = assertDeletionInventoryRecords(encodeDeletionInventory(header, records()), header,
    commitment, source, () => {}, scope.fail).then(() => undefined, error => error).finally(() => { settled = true; });
  context.onTestFinished(async () => { close.release(); await work; });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('CLOSE_NOT_ENTERED'); })]);
    expect(settled).toBe(false);
    expect(scope.failures[0]).toMatchObject({ message: 'WORKSPACE_DELETE_INVENTORY_INVALID' });
    expect(() => scope.assertActive()).toThrow('SYNTHETIC_READ_SCOPE_EXPIRED');
  } finally { close.release(); }
  expect(await work).toBe(scope.failures[0]); expect(closed).toBe(1);
});

it.for(['read', 'source', 'stat'] as const)('expires on actual store %s failure before file close without changing full guards', async (mode, context) => {
  const f = await fixture(context), selected = await f.store().publish(header, records(), f.authority);
  const before = await f.snapshot(), scope = lifecycle(), close = gate(), entered = gate();
  const first = new Error(`SYNTHETIC_${mode.toUpperCase()}_FAILURE`), late = new Error('SYNTHETIC_FILE_CLOSE_FAILURE');
  let stats = 0, closed = 0, settled = false;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file,
      async read(...values) { if (mode === 'read') throw first; return file.read(...values); },
      async stat() { if (mode === 'stat' && ++stats === 2) throw first; return file.stat(); },
      async close() { entered.release(); await close.promise; await file.close(); closed++; throw late; },
    };
  });
  const source = mode === 'source' ? { [Symbol.asyncIterator]() { return {
    async next() { throw first; }, async return() { return { done: true as const, value: undefined }; },
  }; } } : records();
  const work = store.assertRecords(selected, source, f.authority, scope.fail)
    .then(() => undefined, error => error).finally(() => { settled = true; });
  context.onTestFinished(async () => { close.release(); await work; });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('FILE_CLOSE_NOT_ENTERED'); })]);
    expect(scope.failures[0]).toBe(first);
    expect(() => scope.assertActive()).toThrow('SYNTHETIC_READ_SCOPE_EXPIRED');
    expect(settled).toBe(false); expect(closed).toBe(0);
    await expect(store.inspect(selected, f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  } finally { close.release(); }
  expect(await work).toMatchObject({ errors: [first, late] });
  expect(closed).toBe(1); expect(f.handles.closed).toBe(f.handles.opened);
  expect(await f.snapshot()).toEqual(before);
});

it('notifies cross-role conflict before waiting for the reread iterator close', async context => {
  const scope = lifecycle(), entered = gate(), close = gate();
  const evidence = captureDeletionInventoryRecord({ ...record(), role: 'inspectionEvidence', generationId: id(1001) });
  const rows = [captureDeletionInventoryRecord({ ...evidence, role: 'inspection' }), evidence,
    captureDeletionInventoryRecord({ ...record(), role: 'workspace', ownerOperationId: null, bindingSha256: null })];
  const bytes = Buffer.concat([deletionInventoryLine(header), ...rows.map(deletionInventoryLine)]);
  const commitment = { formatVersion: deletionInventoryFormatVersion, byteLength: bytes.length, recordCount: rows.length,
    sha256: createHash('sha256').update(bytes).digest('hex') } as const;
  async function* initial() { yield bytes; }
  let opens = 0, closed = 0;
  const reread = () => ({ [Symbol.asyncIterator]() {
    const iterator = initial(); opens++;
    return { next: () => iterator.next(), async return() {
      entered.release(); await close.promise; closed++; return iterator.return(undefined);
    } };
  } });
  const work = inspectDeletionInventory(initial(), header, commitment, reread, scope.fail).then(() => undefined, error => error);
  context.onTestFinished(async () => { close.release(); await work; });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('REREAD_CLOSE_NOT_ENTERED'); })]);
    expect(scope.failures[0]).toMatchObject({ message: 'WORKSPACE_DELETE_INVENTORY_INVALID' });
    expect(() => scope.assertActive()).toThrow('SYNTHETIC_READ_SCOPE_EXPIRED');
  } finally { close.release(); }
  expect(await work).toBe(scope.failures[0]); expect(opens).toBe(2); expect(closed).toBe(2);
});

it('expires on the first close failure before joining a second close', async context => {
  const scope = lifecycle(), entered = gate(), close = gate();
  const first = new Error('SYNTHETIC_EXPECTED_CLOSE'), second = new Error('SYNTHETIC_ACTUAL_CLOSE');
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records(0)), header);
  const encoded = encodeDeletionInventory(header, records(0));
  let actualClose = 0, expectedClose = 0;
  const actual = { [Symbol.asyncIterator]() { return {
    next: () => encoded.next(), async return() { actualClose++; throw first; },
  }; } };
  const expected = { [Symbol.asyncIterator]() { return {
    async next() { return { done: true as const, value: undefined }; },
    async return() { entered.release(); await close.promise; expectedClose++; throw second; },
  }; } };
  const work = assertDeletionInventoryRecords(actual, header, commitment, expected, () => {}, scope.fail)
    .then(() => undefined, error => error);
  context.onTestFinished(async () => { close.release(); await work; });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('SECOND_CLOSE_NOT_ENTERED'); })]);
    expect(scope.failures[0]).toBe(first);
    expect(() => scope.assertActive()).toThrow('SYNTHETIC_READ_SCOPE_EXPIRED');
    expect(expectedClose).toBe(0);
  } finally { close.release(); }
  const result = await work;
  expect(result).toMatchObject({ errors: [first, second] });
  expect(actualClose).toBe(1); expect(expectedClose).toBe(1);
});

it('does not replace the original cause if the notification itself throws', async () => {
  const first = new Error('SYNTHETIC_WORK'), close = new Error('SYNTHETIC_CLOSE'), notification = new Error('SYNTHETIC_NOTIFICATION');
  const file = { async close() { throw close; } };
  await expect(withDeletionInventoryFile(file as never, async () => { throw first; }, () => { throw notification; }))
    .rejects.toMatchObject({ errors: [first, close] });
});

it('routes actual store conflict notification without opening the expected source', async context => {
  const f = await fixture(context), selected = await f.store().publish(header, records(), f.authority), scope = lifecycle();
  const evidence = captureDeletionInventoryRecord({ ...record(), role: 'inspectionEvidence', generationId: id(1001) });
  const rows = [captureDeletionInventoryRecord({ ...evidence, role: 'inspection' }), evidence,
    captureDeletionInventoryRecord({ ...record(), role: 'workspace', ownerOperationId: null, bindingSha256: null })];
  const bytes = Buffer.concat([deletionInventoryLine(header), ...rows.map(deletionInventoryLine)]);
  await writeFile(f.paths.currentPath, bytes);
  const altered = { ...selected, inventory: { ...selected.inventory, byteLength: bytes.length, recordCount: rows.length,
    sha256: createHash('sha256').update(bytes).digest('hex') } };
  let opened = false;
  let readStarts = 0;
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async read(bytes, position) {
      if (position === 0) readStarts++;
      return file.read(bytes, position);
    } };
  });
  const source = { [Symbol.asyncIterator]() { opened = true; return records(); } };
  await expect(store.assertRecords(altered, source, f.authority, scope.fail)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(readStarts).toBe(3);
  expect(opened).toBe(false); expect(() => scope.assertActive()).toThrow('SYNTHETIC_READ_SCOPE_EXPIRED');
  expect(await readFile(f.paths.currentPath)).toEqual(bytes); expect(f.handles.closed).toBe(f.handles.opened);
});

it('reports a close-only handle failure without replacing its identity', async context => {
  const f = await fixture(context), selected = await f.store().publish(header, records(), f.authority), scope = lifecycle();
  const before = await f.snapshot(), first = new Error('SYNTHETIC_CLOSE_ONLY');
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file, async close() { await file.close(); throw first; } };
  });
  await expect(store.assertRecords(selected, records(), f.authority, scope.fail)).rejects.toBe(first);
  expect(scope.failures[0]).toBe(first);
  expect(() => scope.assertActive()).toThrow('SYNTHETIC_READ_SCOPE_EXPIRED');
  expect(f.handles.closed).toBe(f.handles.opened); expect(await f.snapshot()).toEqual(before);
});

it('keeps the failure notification silent on a successful full-guard read', async context => {
  const f = await fixture(context), selected = await f.store().publish(header, records(), f.authority), scope = lifecycle();
  const before = await f.snapshot();
  await f.store().assertRecords(selected, records(), f.authority, scope.fail);
  expect(scope.failures).toEqual([]); expect(() => scope.assertActive()).not.toThrow();
  expect(f.handles.closed).toBe(f.handles.opened); expect(await f.snapshot()).toEqual(before);
});

it('characterizes the unobserved source-owned cleanup before its next promise rejects', async context => {
  const f = await fixture(context), selected = await f.store().publish(header, records(), f.authority), scope = lifecycle();
  const before = await f.snapshot(), entered = gate(), close = gate(), first = new Error('SYNTHETIC_OPAQUE_SOURCE_FAILURE');
  let sourceClosed = 0, settled = false;
  const source = { [Symbol.asyncIterator]() { return {
    async next() { try { throw first; } finally { entered.release(); await close.promise; } },
    async return() { sourceClosed++; return { done: true as const, value: undefined }; },
  }; } };
  const work = f.store().assertRecords(selected, source, f.authority, scope.fail)
    .then(() => undefined, error => error).finally(() => { settled = true; });
  context.onTestFinished(async () => { close.release(); await work; });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('SOURCE_CLEANUP_NOT_ENTERED'); })]);
    expect(settled).toBe(false);
    // This is a documented observation limit, NOT proof of early expiry for source-owned cleanup.
    expect(scope.failures).toEqual([]); expect(() => scope.assertActive()).not.toThrow();
    expect(f.handles.opened - f.handles.closed).toBe(1);
  } finally { close.release(); }
  expect(await work).toBe(first); expect(scope.failures[0]).toBe(first); expect(sourceClosed).toBe(1);
  expect(f.handles.closed).toBe(f.handles.opened); expect(await f.snapshot()).toEqual(before);
});

it('reproduces the opaque-close boundary through actual selectedSource.records without replacing its authority', async context => {
  const f = await deletionRoleSourceFixture(context), scope = lifecycle();
  await f.publish({ ...remnantTestBinding('workspaceImport'), workspaceId: id(99) });
  const before = await f.preserved(), entered = gate(), close = gate(), first = new Error('SYNTHETIC_SOURCE_DIRECTORY_READ');
  let armed = false, opened = 0, closed = 0;
  const reads = { ...nativeSourceReads, async openDirectory(path: string) {
    const directory = await nativeSourceReads.openDirectory(path);
    if (!armed) return directory;
    opened++;
    return { async read() { throw first; }, async close() {
      entered.release(); await close.promise; await directory.close(); closed++;
    } };
  } };
  let selectedSource!: Awaited<ReturnType<typeof f.capture>>;
  async function* initial() { selectedSource = await f.capture(reads); yield* selectedSource.records(); }
  const store = new WorkspaceDeletionInventoryStore(f.root, header.operationId);
  const selected = await store.publish(header, initial(), f.authority);
  armed = true;
  let settled = false;
  const work = store.assertRecords(selected, selectedSource.records(), f.authority, scope.fail)
    .then(() => undefined, error => error).finally(() => { settled = true; });
  context.onTestFinished(async () => { close.release(); await work; });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('REAL_SOURCE_CLOSE_NOT_ENTERED'); })]);
    expect(settled).toBe(false); expect(opened).toBe(1); expect(closed).toBe(0);
    expect(scope.failures).toEqual([]); expect(() => scope.assertActive()).not.toThrow();
  } finally { close.release(); }
  expect(await work).toBe(first); expect(scope.failures[0]).toBe(first);
  expect(opened).toBe(closed); expect(await f.preserved()).toEqual(before);
  await expect(selectedSource.records().next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});
