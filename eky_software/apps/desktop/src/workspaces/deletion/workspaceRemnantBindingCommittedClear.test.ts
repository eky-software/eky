import { readFile, rename, writeFile, type FileHandle } from 'node:fs/promises';
import * as committedFs from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { CrashSafeByteSlotStore, type CrashSafeByteSlotReadSelection } from '../persistence/crashSafeByteSlotStore.js';
import { deletionTestId as id, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { remnantBindingFixture as fixture } from './workspaceRemnantBindingTestSupport.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore as CommittedStore } from './workspaceRemnantBindingStore.js';
const committedHooks = vi.hoisted(() => ({
  opened: undefined as ((file: FileHandle, path: unknown) => FileHandle) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, async open(...args: Parameters<typeof actual.open>) {
      const file = await actual.open(...args);
      return committedHooks.opened?.(file, args[0]) ?? file;
    } };
});
afterEach(() => { committedHooks.opened = undefined; vi.restoreAllMocks(); });
function committedGate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
type CommittedFixture = Awaited<ReturnType<typeof fixture>>;
function committedTarget(f: CommittedFixture) {
  return { ...deletionTestJournal().target, workspaceId: String(f.binding.workspaceId),
    lineageIdentity: { ...f.binding.lineageIdentity } };
}
function committedClear(store: CommittedStore, target: unknown, proof: Parameters<CommittedStore['clearCommittedAfterPayloadsAbsent']>[1], option: CrashSafeByteSlotReadSelection) {
  return store.clearCommittedAfterPayloadsAbsent(target, proof, option);
}
function committedLeaves(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(committedLeaves) : [error];
}
for (const shape of ['missing', 'empty', 'current', 'next', 'backup', 'all'] as const) {
  it(`committed binding preserves foreign bytes and guarded ${shape} semantics`, async (context) => {
    const f = await fixture(context), store = f.store();
    const selected = shape === 'all' ? ['current', 'next', 'backup'] as const
      : shape === 'missing' || shape === 'empty' ? [] : [shape];
    const foreign = `${id(9)}.json`;
    if (shape !== 'missing') {
      await f.prepare();
      for (const slot of selected)
        await writeFile(f.paths[`${slot}Path`], slot === 'next'
          ? JSON.stringify(f.binding, null, 2) + '\n' : serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
      await writeFile(`${f.paths.directoryPath}/${foreign}`, 'foreign immutable bytes', { flag: 'wx', mode: 0o600 });
    }
    let prefix = 0, full = 0, reads = 0, sync = 0;
    const read = f.fileSystem.readSlot.bind(f.fileSystem), synchronize = f.fileSystem.syncDirectory.bind(f.fileSystem);
    f.fileSystem.readSlot = async (...args) => { reads++; return read(...args); };
    f.fileSystem.syncDirectory = async (...args) => { sync++; return synchronize(...args); };
    const proof = { ...f.cleanup('deletionPurged'), async assertPayloadsAbsent() { full++; } };
    await committedClear(store, committedTarget(f), proof, { async assertBeforeSlotRead() { prefix++; } });
    if (shape === 'missing') {
      expect(prefix).toBe(1);
      expect(sync).toBe(0);
      expect(reads).toBe(6);
      expect(full).toBe(4);
      expect(await committedFs.readdir(f.root)).toEqual([]);
    }
    else {
      const rounds = selected.length + 3;
      expect(prefix).toBe(1 + rounds);
      expect(full).toBe(1 + rounds);
      expect(reads).toBe(3 + rounds * 3);
      expect(sync).toBe(1);
      expect(await f.snapshot()).toEqual({ [foreign]: Buffer.from('foreign immutable bytes').toString('hex') });
    }
  });
}
for (const fault of ['workspace', 'lineage', 'digest', 'identity', 'rawBytes', 'sideOnlyForeign'] as const) {
  it(`committed binding rejects ${fault} after one leading prefix and before any clear`, async (context) => {
    const f = await fixture(context), store = f.store();
    await store.publish(f.binding, f.authority);
    const slots = (await store.inspect(f.authority)).slots;
    const target = committedTarget(f), proof = { ...f.cleanup('deletionPurged'), expectedDeletionSlots: slots };
    if (fault === 'workspace')
      target.workspaceId = id(8);
    if (fault === 'lineage')
      target.lineageIdentity.profileId = 'f'.repeat(64);
    if (fault === 'digest')
      proof.bindingSha256 = 'f'.repeat(64);
    if (fault === 'identity') {
      await rename(f.paths.currentPath, `${f.paths.currentPath}.retained`);
      await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
    }
    if (fault === 'rawBytes')
      await writeFile(f.paths.currentPath, JSON.stringify(f.binding, null, 2) + '\n');
    if (fault === 'sideOnlyForeign') {
      await committedFs.rm(f.paths.currentPath);
      await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(8) })), { flag: 'wx', mode: 0o600 });
    }
    const before = await f.snapshot();
    let prefix = 0, removes = 0, sync = 0;
    f.fileSystem.removeSlot = async () => { removes++; throw new Error('UNEXPECTED_REMOVE'); };
    f.fileSystem.syncDirectory = async () => { sync++; throw new Error('UNEXPECTED_SYNC'); };
    await expect(committedClear(store, target, proof, { async assertBeforeSlotRead() { prefix++; } })).rejects.toThrow();
    expect(prefix).toBe(1);
    expect(removes).toBe(0);
    expect(sync).toBe(0);
    expect(await f.snapshot()).toEqual(before);
  });
}
for (const stage of ['leading observation callback', 'full external guard'] as const) {
it(`committed binding captures commitments before the ${stage}`, async (context) => {
  const f = await fixture(context), store = f.store();
  await store.publish(f.binding, f.authority);
  const slots = (await store.inspect(f.authority)).slots;
  const mutable = { current: { ...slots.current!, bytes: Uint8Array.from(slots.current!.bytes), identity: { ...slots.current!.identity! } }, next: undefined, backup: undefined };
  const target = committedTarget(f);
  let injected = 0, reads = 0;
  const read = f.fileSystem.readSlot.bind(f.fileSystem);
  f.fileSystem.readSlot = async (...args) => { reads++; return read(...args); };
  const mutate = () => {
    if (injected) return;
    expect(reads).toBe(stage === 'leading observation callback' ? 0 : 3);
    injected++;
    target.workspaceId = id(8);
    target.lineageIdentity.profileId = 'f'.repeat(64);
    proof.bindingSha256 = 'e'.repeat(64);
    mutable.current.bytes.fill(0);
    mutable.current.identity.size++;
  };
  const proof = { ...f.cleanup('deletionPurged'), expectedDeletionSlots: mutable,
    async assertExternalSelection() {
      if (stage === 'full external guard') mutate();
      await f.authority.assertExternalSelection();
    } };
  await committedClear(store, target, proof, {
    async assertBeforeSlotRead() {
      if (stage === 'leading observation callback') mutate();
      await f.authority.assertExternalSelection();
    },
  });
  expect(injected).toBe(1);
  expect(await f.snapshot()).toEqual({});
});
}
for (const persistent of [false, true]) {
  it(`committed binding documents ${persistent ? 'persistent' : 'fully restored'} prefix payload window`, async (context) => {
    const f = await fixture(context), store = f.store();
    await store.publish(f.binding, f.authority);
    const before = await f.snapshot();
    let clearing = false, injected = false, dirty = false, blocked = 0;
    const clear = CrashSafeByteSlotStore.prototype.clearSelected;
    vi.spyOn(CrashSafeByteSlotStore.prototype, 'clearSelected').mockImplementation(async function (this: CrashSafeByteSlotStore, selected, option) {
      clearing = true;
      return clear.call(this, selected, option);
    });
    const read = f.fileSystem.readSlot.bind(f.fileSystem);
    f.fileSystem.readSlot = async (...args) => {
      const result = await read(...args);
      if (dirty && !persistent)
        dirty = false;
      return result;
    };
    const proof = { ...f.cleanup('deletionPurged'), async assertPayloadsAbsent() { if (dirty) {
        blocked++;
        throw new Error('SYNTHETIC_RETURNED_PAYLOAD');
      } } };
    const result = await committedClear(store, committedTarget(f), proof, {
      async assertBeforeSlotRead() {
        await proof.assertExternalSelection();
        if (clearing && !injected) { injected = true; dirty = true; }
      },
    }).then(() => ({ ok: true }), (error: unknown) => ({ error }));
    expect(injected).toBe(true);
    if (!persistent) {
      expect(result).toEqual({ ok: true });
      expect(blocked).toBe(0);
      expect(await f.snapshot()).toEqual({});
    }
    else {
      expect(result).toMatchObject({ error: { message: 'SYNTHETIC_RETURNED_PAYLOAD' } });
      expect(blocked).toBe(1);
      expect(await f.snapshot()).toEqual(before);
    }
  });
}
it('committed binding preserves bytes while explicitly distinguishing dual-invalid cause order', async (context) => {
  const f = await fixture(context), store = f.store();
  await store.publish(f.binding, f.authority);
  let external = 0, dirty = false;
  const proof = { ...f.cleanup('deletionPurged'), async assertExternalSelection() {
      await f.authority.assertExternalSelection();
      if (++external === 4) {
        dirty = true;
        await writeFile(f.paths.nextPath, 'new unselected bytes', { flag: 'wx', mode: 0o600 });
      }
    }, async assertPayloadsAbsent() { if (dirty)
      throw new Error('SYNTHETIC_DUAL_PAYLOAD'); } };
  await expect(committedClear(store, committedTarget(f), proof, {
    assertBeforeSlotRead: () => proof.assertExternalSelection(),
  })).rejects.toThrow('CRASH_SAFE_BYTE_SLOT_UNAVAILABLE');
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
  expect(await readFile(f.paths.nextPath, 'utf8')).toBe('new unselected bytes');
});
for (const invalid of [null, false, 0, {}, { assertBeforeSlotRead: null }, { assertBeforeSlotRead: true }]) {
  it(`committed binding rejects malformed read option ${JSON.stringify(invalid)} before I/O`, async (context) => {
    const f = await fixture(context);
    let io = 0, external = 0;
    f.fileSystem.readSlot = async () => { io++; throw new Error('UNEXPECTED_READ'); };
    const proof = { ...f.cleanup('deletionPurged'), async assertExternalSelection() { external++; } };
    expect(() => f.store().clearCommittedAfterPayloadsAbsent(committedTarget(f), proof, invalid as unknown as CrashSafeByteSlotReadSelection))
      .toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(io).toBe(0);
    expect(external).toBe(0);
    expect(await committedFs.readdir(f.root)).toEqual([]);
  });
}
it('committed binding captures the callback and receiver once before external work', async (context) => {
  const f = await fixture(context), store = f.store();
  await store.publish(f.binding, f.authority);
  let gets = 0, old = 0, late = 0, first = true;
  const option = { token: 'original', get assertBeforeSlotRead() {
      gets++;
      return async function (this: {
        token: string;
      }) { expect(this).toBe(option); expect(this.token).toBe('original'); old++; };
    } };
  const proof = { ...f.cleanup('deletionPurged'), async assertExternalSelection() {
      if (first) {
        first = false;
        Object.defineProperty(option, 'assertBeforeSlotRead', { value: async () => { late++; throw new Error('LATE_CALLBACK'); } });
      }
      await f.authority.assertExternalSelection();
    } };
  await store.clearCommittedAfterPayloadsAbsent(committedTarget(f), proof, option);
  expect(gets).toBe(1);
  expect(old).toBe(5);
  expect(late).toBe(0);
  expect(await f.snapshot()).toEqual({});
});
for (const failed of [false, true]) {
  it(`committed binding expires scoped callbacks after ${failed ? 'failure' : 'success'} without poisoning next work`, async (context) => {
    const f = await fixture(context), store = f.store();
    await store.publish(f.binding, f.authority);
    const before = await f.snapshot();
    const scopes: CrashSafeByteSlotReadSelection[] = [];
    const clear = CrashSafeByteSlotStore.prototype.clearSelected;
    vi.spyOn(CrashSafeByteSlotStore.prototype, 'clearSelected').mockImplementation(async function (this: CrashSafeByteSlotStore, selected, option) {
      if (option !== undefined)
        scopes.push(option);
      return clear.call(this, selected, option);
    });
    const first = undefined;
    let callbacks = 0;
    const result = await store.clearCommittedAfterPayloadsAbsent(committedTarget(f), f.cleanup('deletionPurged'), {
      async assertBeforeSlotRead() { callbacks++; if (failed && scopes.length > 0)
        throw first; },
    }).then(() => ({ ok: true }), (error: unknown) => ({ error }));
    if (failed) {
      expect('error' in result).toBe(true);
      expect(committedLeaves((result as {
        error: unknown;
      }).error)[0]).toBe(first);
      expect(await f.snapshot()).toEqual(before);
    }
    else {
      expect(result).toEqual({ ok: true });
      expect(await f.snapshot()).toEqual({});
    }
    expect(scopes).toHaveLength(1);
    const previous = callbacks;
    let firstExternal = true, nextCalls = 0;
    const entered = committedGate(), held = committedGate();
    const work = store.clearCommittedAfterPayloadsAbsent(committedTarget(f), {
      ...f.cleanup('deletionPurged'), async assertExternalSelection() {
        nextCalls++;
        if (firstExternal) {
          firstExternal = false;
          entered.release();
          await held.promise;
        }
        await f.authority.assertExternalSelection();
      },
    }, { async assertBeforeSlotRead() { } }).then(() => ({ ok: true }), (error: unknown) => ({ error }));
    context.onTestFinished(async () => { held.release(); await work; });
    await Promise.race([entered.promise, work.then(() => { throw new Error('NEXT_NOT_HELD'); })]);
    try {
      const nextBefore = nextCalls;
      const stale = await scopes[0]!.assertBeforeSlotRead().then(() => ({ ok: true }), (error: unknown) => ({ error }));
      expect('error' in stale).toBe(true);
      if (failed)
        expect((stale as {
          error: unknown;
        }).error).toBe(first);
      else
        expect(stale).toMatchObject({ error: { message: 'WORKSPACE_REMNANT_BINDING_INVALID' } });
      expect(callbacks).toBe(previous);
      expect(nextCalls).toBe(nextBefore);
    }
    finally {
      held.release();
    }
    expect(await work).toEqual({ ok: true });
    expect(scopes).toHaveLength(2);
    expect(scopes[1]).not.toBe(scopes[0]);
    expect(await f.snapshot()).toEqual({});
  });
}
for (const stage of ['observation', 'clear'] as const) {
it(`committed binding joins the held ${stage} prefix across revocation without early I/O or release`, async (context) => {
  const f = await fixture(context), store = f.store();
  await store.publish(f.binding, f.authority);
  const before = await f.snapshot(), entered = committedGate(), held = committedGate();
  const read = f.fileSystem.readSlot.bind(f.fileSystem);
  let reads = 0, settled = false, clearing = false;
  const clear = CrashSafeByteSlotStore.prototype.clearSelected;
  vi.spyOn(CrashSafeByteSlotStore.prototype, 'clearSelected').mockImplementation(async function (this: CrashSafeByteSlotStore, selected, option) {
    clearing = true;
    return clear.call(this, selected, option);
  });
  const initialReads = stage === 'observation' ? 0 : 3;
  f.fileSystem.readSlot = async (...args) => { reads++; return read(...args); };
  const work = store.clearCommittedAfterPayloadsAbsent(committedTarget(f), f.cleanup('deletionPurged'), {
    async assertBeforeSlotRead() {
      if (stage === 'clear' && !clearing) return;
      entered.release(); await held.promise;
    },
  }).then(() => ({ ok: true }), (error: unknown) => ({ error })).finally(() => { settled = true; });
  context.onTestFinished(async () => { held.release(); await work; });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('PREFIX_NOT_HELD'); })]);
    expect(reads).toBe(initialReads);
    f.expire();
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(store.inspect(f.authority)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(reads).toBe(initialReads);
    expect(settled).toBe(false);
    expect(await f.snapshot()).toEqual(before);
  }
  finally {
    held.release();
  }
  expect(await work).toMatchObject({ error: { message: 'SYNTHETIC_LEASE_LOST' } });
  expect(reads).toBe(initialReads);
  expect(await f.snapshot()).toEqual(before);
});
}
for (const stage of ['observation', 'clear'] as const) {
for (const mode of ['read', 'close'] as const) {
  it(`committed binding joins a real held ${stage} ${mode} before releasing exclusivity`, async (context) => {
    const f = await fixture(context), store = f.store();
    await store.publish(f.binding, f.authority);
    const before = await f.snapshot(), held = committedGate(), entered = committedGate();
    let armed = false, injected = false, closed = 0, settled = false, clearing = false;
    const clear = CrashSafeByteSlotStore.prototype.clearSelected;
    vi.spyOn(CrashSafeByteSlotStore.prototype, 'clearSelected').mockImplementation(async function (this: CrashSafeByteSlotStore, selected, option) {
      clearing = true;
      return clear.call(this, selected, option);
    });
    let handle: FileHandle | undefined;
    committedHooks.opened = (file, path) => {
      if (!armed || injected || String(path) !== f.paths.currentPath)
        return file;
      injected = true;
      handle = file;
      return new Proxy(file, { get(target, prop) {
          if (prop === 'read')
            return async (...args: Parameters<FileHandle['read']>) => {
              if (mode === 'read') {
                entered.release();
                await held.promise;
              }
              return (target.read as (...values: unknown[]) => Promise<unknown>)(...args);
            };
          if (prop === 'close')
            return async () => {
              if (mode === 'close') {
                entered.release();
                await held.promise;
              }
              await target.close();
              closed++;
            };
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
    };
    const work = store.clearCommittedAfterPayloadsAbsent(committedTarget(f), f.cleanup('deletionPurged'), {
      async assertBeforeSlotRead() { if (stage === 'observation' || clearing) armed = true; },
    }).then(() => ({ ok: true }), (error: unknown) => ({ error })).finally(() => { settled = true; });
    context.onTestFinished(async () => { held.release(); await work; });
    try {
      await Promise.race([entered.promise, work.then(() => { throw new Error('NATIVE_NOT_HELD'); })]);
      f.expire();
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(closed).toBe(0);
      expect(handle!.fd).toBeGreaterThanOrEqual(0);
      await expect(store.inspect(f.authority)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
      expect(settled).toBe(false);
    }
    finally {
      held.release();
    }
    expect(await work).toHaveProperty('error');
    expect(closed).toBe(1);
    expect(handle!.fd).toBe(-1);
    committedHooks.opened = undefined;
    expect(await f.snapshot()).toEqual(before);
  });
}
}
for (const mode of ['remove', 'sync'] as const) {
  it(`committed binding joins a held native ${mode} and rechecks authority before mutation`, async (context) => {
    const f = await fixture(context), store = f.store();
    await store.publish(f.binding, f.authority);
    const before = await f.snapshot(), held = committedGate(), entered = committedGate();
    let settled = false;
    const remove = f.fileSystem.removeSlot.bind(f.fileSystem), sync = f.fileSystem.syncDirectory.bind(f.fileSystem);
    if (mode === 'remove')
      f.fileSystem.removeSlot = async (...args) => { entered.release(); await held.promise; return remove(...args); };
    else
      f.fileSystem.syncDirectory = async (...args) => { entered.release(); await held.promise; return sync(...args); };
    const work = store.clearCommittedAfterPayloadsAbsent(committedTarget(f), f.cleanup('deletionPurged'), {
      async assertBeforeSlotRead() { f.authority.assertAuthority(); },
    }).then(() => ({ ok: true }), (error: unknown) => ({ error })).finally(() => { settled = true; });
    context.onTestFinished(async () => { held.release(); await work; });
    try {
      await Promise.race([entered.promise, work.then(() => { throw new Error('MUTATION_NOT_HELD'); })]);
      f.expire();
      await Promise.resolve();
      expect(settled).toBe(false);
      await expect(store.inspect(f.authority)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    }
    finally {
      held.release();
    }
    expect(await work).toHaveProperty('error');
    expect(await f.snapshot()).toEqual(mode === 'remove' ? before : {});
  });
}
it('committed binding keeps per-key scopes and other actual binding bytes independent', async (context) => {
  const f = await fixture(context), first = f.store();
  await first.publish(f.binding, f.authority);
  const other = captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(9) });
  const key = workspaceRemnantBindingKey(other), paths = createWorkspaceRemnantBindingPaths(f.root, key);
  const second = new CommittedStore(f.root, key);
  await second.publish(other, f.authority);
  const otherBytes = await readFile(paths.currentPath);
  let firstReads = 0, secondReads = 0;
  await first.clearCommittedAfterPayloadsAbsent(committedTarget(f), f.cleanup('deletionPurged'), { async assertBeforeSlotRead() { firstReads++; } });
  expect(await readFile(paths.currentPath)).toEqual(otherBytes);
  expect(firstReads).toBe(5);
  expect(secondReads).toBe(0);
  await second.clearCommittedAfterPayloadsAbsent(committedTarget(f), { ...f.cleanup('deletionPurged'), bindingSha256: workspaceRemnantBindingSha256(other) }, {
    async assertBeforeSlotRead() { secondReads++; },
  });
  expect(firstReads).toBe(5);
  expect(secondReads).toBe(5);
  expect(await f.snapshot()).toEqual({});
});
