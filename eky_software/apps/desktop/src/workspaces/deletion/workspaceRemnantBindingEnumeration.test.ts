import { mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { deletionTestDigest as hash, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryEntryPageSize, workspaceDeletionDirectoryReads as nativeReads } from './workspaceDeletionDirectoryEntries.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingOwners, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { observeWorkspaceRemnantBindings as observe, observeWorkspaceRemnantBindingDirectory as observeDirectory } from './workspaceRemnantBindingEnumeration.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

async function collect(source: ReturnType<typeof observe>) {
  const result = [];
  for await (const row of source) result.push(row);
  return result;
}

async function fixture(context: TestContext, owner: (typeof workspaceRemnantBindingOwners)[number] = 'workspaceImport') {
  const f = await remnantBindingFixture(context, owner);
  return { ...f, authority: { ...f.authority, assertAuthority() {
    context.signal.throwIfAborted();
    f.authority.assertAuthority();
  } } };
}

async function expectRejectedAndJoined(context: TestContext, source: ReturnType<typeof observe>, afterSettled: () => void) {
  const work = source.next();
  let asserted = false;
  context.onTestFinished(async () => {
    try { await work; }
    catch (error) {
      if (!asserted && (!context.signal.aborted || error !== context.signal.reason)) throw error;
    } finally { afterSettled(); }
  });
  await expect(work).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  asserted = true;
}

for (const owner of workspaceRemnantBindingOwners) {
  it(`observes ${owner} through the actual store, once for current and both identical side slots`, async context => {
    const f = await fixture(context, owner);
    const receipt = await f.store().publish(f.binding, f.authority);
    const bytes = serializeWorkspaceRemnantBinding(f.binding);
    for (const slot of ['next', 'backup'] as const) await writeFile(f.paths[`${slot}Path`], bytes, { mode: 0o600 });
    const before = await f.snapshot();
    const rows = await collect(observe(f.root, owner, f.authority));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toEqual(f.key);
    expect(rows[0]!.binding.value).toEqual(f.binding);
    expect(rows[0]!.binding.bindingSha256).toBe(receipt.bindingSha256);
    expect(rows[0]!.binding.slots.current!.identity).toEqual(receipt.identity);
    for (const slot of ['current', 'next', 'backup'] as const) {
      expect(Buffer.from(rows[0]!.binding.slots[slot]!.bytes).equals(bytes)).toBe(true);
    }
    expect(await f.snapshot()).toEqual(before);
  });
}

it('observes absence without creating state or binding directories', async context => {
  const f = await fixture(context);
  for (const owner of workspaceRemnantBindingOwners) expect(await collect(observe(f.root, owner, f.authority))).toEqual([]);
  expect(await readdir(f.root)).toEqual([]);
});

it.for(['missing', 'empty', 'published'] as const)('exposes the %s directory context without changing binding-only consumers', async (kind, context) => {
  const f = await fixture(context);
  if (kind === 'empty') await f.prepare();
  if (kind === 'published') await f.store().publish(f.binding, f.authority);
  const snapshot = () => kind === 'missing' ? readdir(f.root) : f.snapshot();
  const before = await snapshot();
  const rows = [];
  for await (const row of observeDirectory(f.root, 'workspaceImport', f.authority)) rows.push(row);
  expect(rows[0]).toMatchObject({ kind: 'directory', owner: 'workspaceImport', directoryPath: f.paths.directoryPath,
    selection: { present: kind !== 'missing' } });
  if (rows[0]?.kind !== 'directory') throw new Error('SYNTHETIC_MISSING_DIRECTORY');
  expect(rows[0].selection.identities).toHaveLength(3);
  expect(rows[0].selection.identities.at(-1) === null).toBe(kind === 'missing');
  expect(rows.slice(1).map(row => row.kind)).toEqual(kind === 'published' ? ['binding'] : []);
  expect(await snapshot()).toEqual(before);
});

it.for(['appeared', 'replaced', 'leaseLost'] as const)('rejects %s after yielding an empty directory context', async (kind, context) => {
  const f = await fixture(context);
  if (kind === 'replaced') await f.prepare();
  const source = observeDirectory(f.root, 'workspaceImport', f.authority);
  expect((await source.next()).value).toMatchObject({ kind: 'directory' });
  if (kind === 'appeared') await f.prepare();
  if (kind === 'replaced') {
    await rename(f.paths.directoryPath, join(f.root, 'retained-directory'));
    await mkdir(f.paths.directoryPath, { mode: 0o700 });
  }
  if (kind === 'leaseLost') f.expire();
  const snapshot = () => kind === 'leaseLost' ? readdir(f.root) : f.snapshot();
  const before = await snapshot();
  await expect(source.next()).rejects.toThrow(kind === 'leaseLost' ? 'SYNTHETIC_LEASE_LOST' : 'WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await snapshot()).toEqual(before);
});

it('reads more than one page without dropping other companies or side slots', async context => {
  const f = await fixture(context);
  await f.prepare();
  const expected = [];
  for (let index = workspaceDeletionDirectoryEntryPageSize; index >= 0; index--) {
    const binding = captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(100 + index),
      workspaceId: id(index % 2 === 0 ? 2 : 4), lineageIdentity: { formatVersion: 1, profileId: hash(`company-${index % 2}`) } });
    const key = workspaceRemnantBindingKey(binding);
    const paths = createWorkspaceRemnantBindingPaths(f.root, key);
    await writeFile(paths.currentPath, serializeWorkspaceRemnantBinding(binding), { mode: 0o600 });
    if (index % 2 === 0) for (const slot of ['next', 'backup'] as const) {
      await writeFile(paths[`${slot}Path`], serializeWorkspaceRemnantBinding(binding), { mode: 0o600 });
    }
    expected.unshift({ operationId: binding.operationId, workspaceId: binding.workspaceId, hash: workspaceRemnantBindingSha256(binding) });
  }
  const before = await f.snapshot();
  const work = collect(observe(f.root, 'workspaceImport', f.authority));
  context.onTestFinished(async () => {
    // A test deadline revokes the existing authority; join the original reader before leaving this test.
    try { await work; }
    catch (error) { if (!context.signal.aborted || error !== context.signal.reason) throw error; }
  });
  const rows = await work;
  expect(rows.map(row => ({ operationId: row.binding.value.operationId, workspaceId: row.binding.value.workspaceId,
    hash: row.binding.bindingSha256 }))).toEqual(expected);
  expect(await f.snapshot()).toEqual(before);
}, 10_000);

it.for(['next', 'backup'] as const)('rejects an uncommitted %s-only binding and retains its bytes', async (slot, context) => {
  const f = await fixture(context);
  await f.prepare();
  await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  const before = await f.snapshot();
  await expect(collect(observe(f.root, 'workspaceImport', f.authority))).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['conflictingValue', 'wrongKey', 'unknownName', 'linkedSlot'] as const)(
  'refuses %s instead of omitting uncertain metadata', async (kind, context) => {
    const f = await fixture(context);
    await f.store().publish(f.binding, f.authority);
    if (kind === 'conflictingValue') await writeFile(f.paths.nextPath,
      serializeWorkspaceRemnantBinding({ ...f.binding, lineageIdentity: { formatVersion: 1, profileId: hash('other') } }), { mode: 0o600 });
    if (kind === 'wrongKey') await writeFile(f.paths.currentPath,
      serializeWorkspaceRemnantBinding({ ...f.binding, operationId: id(500) }), { mode: 0o600 });
    if (kind === 'unknownName') await writeFile(join(f.paths.directoryPath, 'unknown-entry'), 'retained', { mode: 0o600 });
    if (kind === 'linkedSlot') {
      const saved = join(f.root, 'retained-binding');
      await rename(f.paths.currentPath, saved);
      await symlink(saved, f.paths.currentPath, 'file');
    }
    const original = await readFile(f.paths.currentPath);
    await expect(collect(observe(f.root, 'workspaceImport', f.authority))).rejects.toThrow();
    expect((await readFile(f.paths.currentPath)).equals(original)).toBe(true);
    if (kind === 'unknownName') expect(await readFile(join(f.paths.directoryPath, 'unknown-entry'), 'utf8')).toBe('retained');
  });

it.for(['sideAdded', 'rawBytes', 'identity'] as const)('rejects %s changes while the consumer holds a row', async (kind, context) => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const source = observe(f.root, 'workspaceImport', f.authority);
  expect((await source.next()).done).toBe(false);
  if (kind === 'sideAdded') await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  if (kind === 'rawBytes') await writeFile(f.paths.currentPath, ` ${serializeWorkspaceRemnantBinding(f.binding).toString('utf8')}`, { mode: 0o600 });
  if (kind === 'identity') {
    await rename(f.paths.currentPath, join(f.root, 'retained-original'));
    await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  }
  const before = await f.snapshot();
  await expect(source.next()).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('keeps private selection bytes independent of mutable rows returned to the consumer', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const source = observe(f.root, 'workspaceImport', f.authority);
  const first = await source.next();
  if (first.done) throw new Error('SYNTHETIC_MISSING_BINDING');
  first.value.binding.slots.current!.bytes.fill(0);
  expect(await source.next()).toEqual({ done: true, value: undefined });
  expect((await f.store().inspect(f.authority)).mode).toBe('published');
});

it('pins every surviving ancestor, not just a relocated final binding directory', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const source = observe(f.root, 'workspaceImport', f.authority);
  expect((await source.next()).done).toBe(false);
  const state = dirname(f.paths.directoryPath), retained = join(f.root, 'retained-state');
  await rename(state, retained);
  await mkdir(state, { mode: 0o700 });
  await rename(join(retained, 'workspace-import-bindings'), f.paths.directoryPath);
  const before = await f.snapshot();
  await expect(source.next()).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['open', 'read', 'close', 'emptyClose'] as const)(
  'rejects an ancestor replacement during %s before consuming a binding or accepting EOF', async (phase, context) => {
    const f = await fixture(context);
    if (phase === 'emptyClose') await f.prepare();
    else await f.store().publish(f.binding, f.authority);
    const before = await f.snapshot();
    const names = await readdir(f.paths.directoryPath);
    const state = dirname(f.paths.directoryPath), retained = join(f.root, 'retained-state');
    let replaced = false, closed = 0, offset = 0;
    const replaceAncestor = async () => {
      if (replaced) return;
      await rename(state, retained);
      await mkdir(state, { mode: 0o700 });
      await rename(join(retained, 'workspace-import-bindings'), f.paths.directoryPath);
      replaced = true;
    };
    const inspect = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect');
    const source = observe(f.root, 'workspaceImport', f.authority, { ...nativeReads, async openDirectory() {
      // Inject directory observations so Windows handle sharing cannot prevent the real ancestor mutation.
      if (phase === 'open') await replaceAncestor();
      return {
        async read() {
          if (phase === 'read') await replaceAncestor();
          return offset < names.length ? { name: names[offset++]! } : null;
        },
        async close() {
          closed++;
          if (phase === 'close' || phase === 'emptyClose') await replaceAncestor();
        },
      };
    } });
    await expectRejectedAndJoined(context, source, () => inspect.mockRestore());
    expect(replaced).toBe(true);
    expect(closed).toBe(1);
    expect(inspect).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });

it('rejects an ancestor changed during a read before the next read can restore it', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const before = await f.snapshot();
  const state = dirname(f.paths.directoryPath), retained = join(f.root, 'retained-state');
  const names = await readdir(f.paths.directoryPath);
  let readCalls = 0, closed = 0;
  let replaced = false, restored = false;
  const inspect = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect');
  const source = observe(f.root, 'workspaceImport', f.authority, {
    ...nativeReads,
    async openDirectory() {
      return {
        async read() {
          readCalls++;
          if (readCalls === 1) {
            await rename(state, retained);
            await mkdir(state, { mode: 0o700 });
            await rename(join(retained, 'workspace-import-bindings'), f.paths.directoryPath);
            replaced = true;
          }
          if (readCalls === 2 && replaced) {
            await rename(f.paths.directoryPath, join(retained, 'workspace-import-bindings'));
            await rename(state, join(f.root, 'replaced-state'));
            await rename(retained, state);
            restored = true;
          }
          return readCalls <= names.length ? { name: names[readCalls - 1]! } : null;
        },
        async close() { closed++; },
      };
    },
  });
  await expectRejectedAndJoined(context, source, () => inspect.mockRestore());
  expect({ replaced, restored, readCalls, closed }).toEqual({ replaced: true, restored: false, readCalls: 1, closed: 1 });
  expect(inspect).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['authority', 'selection', 'abort'] as const)('joins directory work after %s loss without deleting metadata', async (kind, context) => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const abort = new AbortController();
  const reason = new Error('SYNTHETIC_TEST_ABORT');
  const authority = { ...f.authority, assertAuthority() { abort.signal.throwIfAborted(); f.authority.assertAuthority(); } };
  let entered!: () => void, release!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let closed = false, settled = false;
  const source = observe(f.root, 'workspaceImport', authority, { ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path);
    return {
      async read() { entered(); await pending; return directory.read(); },
      async close() { await directory.close(); closed = true; },
    };
  } });
  const work = source.next().finally(() => { settled = true; });
  const outcome = expect(work).rejects.toThrow(kind === 'authority' ? 'SYNTHETIC_LEASE_LOST'
    : kind === 'selection' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_TEST_ABORT');
  try {
    await entering;
    if (kind === 'authority') f.expire();
    else if (kind === 'selection') f.changeTarget();
    else abort.abort(reason);
    expect(settled).toBe(false);
  } finally { release(); }
  await outcome;
  expect(closed).toBe(true);
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
});

it('stops with no open directory handles when the consumer returns after one binding', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  let opened = 0, closed = 0;
  const source = observe(f.root, 'workspaceImport', f.authority, { ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path); opened++;
    return { read: () => directory.read(), async close() { await directory.close(); closed++; } };
  } });
  expect((await source.next()).done).toBe(false);
  await source.return(undefined);
  expect(opened).toBe(closed);
});

it('preserves a directory read error alongside the original close error', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const first = new Error('SYNTHETIC_ENUMERATION_READ'), last = new Error('SYNTHETIC_ENUMERATION_CLOSE');
  await expect(collect(observe(f.root, 'workspaceImport', f.authority, { ...nativeReads, async openDirectory() {
    return { async read() { throw first; }, async close() { throw last; } };
  } }))).rejects.toMatchObject({ errors: [first, last] });
});
