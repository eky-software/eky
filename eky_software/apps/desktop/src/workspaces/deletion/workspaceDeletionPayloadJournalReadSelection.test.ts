import { readdir, readFile, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it, vi, type TestContext } from 'vitest';
import { captureDeletionTarget } from "../management/workspaceDeletionTarget.js";
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlot, type CrashSafeFileSlotMutationGuard } from "../persistence/crashSafeFileSlot.js";
import { WORKSPACE_REGISTRY_FILE_NAME } from "../registry/workspaceRegistryPaths.js";
import { WorkspaceRegistryStore } from "../registry/workspaceRegistryStore.js";
import { createSwitchRegistry } from "../switch/workspaceSwitchTestSupport.js";
import { deletionTestHeader as header, deletionTestId as id, deletionTestJournal as journal } from "./workspaceDeletionDataTestSupport.js";
import * as actualInventoryStore from './workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionInventoryPaths } from './workspaceDeletionInventoryStore.js';
import { serializeWorkspaceDeletionJournal } from "./workspaceDeletionJournalCodec.js";
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from "./workspaceDeletionJournalStore.js";
import { createWorkspaceDeletionPayloadExecutor } from "./workspaceDeletionPayloadExecutor.js";
import { createWorkspaceDeletionPublisher } from "./workspaceDeletionPublication.js";
import { deletionRoleSourceFixture } from "./workspaceDeletionRolesTestSupport.js";
const io = vi.hoisted(() => ({
  root: '', path: '', beforeRead: undefined as (() => Promise<void>) | undefined,
  beforeClose: undefined as (() => Promise<void>) | undefined, handles: [] as FileHandle[], live: new Set<FileHandle>()
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual, async open(...args: Parameters<typeof actual.open>) {
      const file = await actual.open(...args);
      if (!io.root || typeof args[0] !== 'string' || !args[0].startsWith(io.root))
        return file;
      io.handles.push(file);
      io.live.add(file);
      return new Proxy(file, {
        get(target, key) {
          if (key === 'read')
            return async (...values: Parameters<FileHandle['read']>) => {
              if (args[0] === io.path) {
                const hook = io.beforeRead;
                io.beforeRead = undefined;
                await hook?.();
              }
              return Reflect.apply(target.read, target, values);
            };
          if (key === 'close')
            return async () => {
              if (args[0] === io.path) {
                const hook = io.beforeClose;
                io.beforeClose = undefined;
                await hook?.();
              }
              await target.close();
              io.live.delete(target);
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  };
});
afterEach(() => {
  expect(io.live.size).toBe(0);
  for (const file of io.handles)
    expect(file.fd).toBe(-1);
  io.root = '';
  io.path = '';
  io.beforeRead = undefined;
  io.beforeClose = undefined;
  io.handles = [];
  io.live.clear();
  vi.restoreAllMocks();
});
async function createPayloadJournalFixture(test: TestContext) {
  const f = await deletionRoleSourceFixture(test);
  const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: join(f.root, WORKSPACE_REGISTRY_FILE_NAME) });
  const base = createSwitchRegistry();
  await registry.write({
    ...base, formatVersion: 2, workspaces: [base.workspaces[0]!,
    { ...base.workspaces[1]!, workspaceId: header.workspaceId, lineageIdentity: header.lineageIdentity }]
  });
  let live = true;
  const lost = new Error('SYNTHETIC_ACTUAL_INTERMEDIATE_LEASE_LOST');
  const assertCurrent = () => {
    if (!live)
      throw lost; f.authority.assertAuthority();
  };
  const state = {
    inE: false, stableCalls: 0, externalCalls: 0, mutations: 0, nativeDepth: 0,
    writerFaults: undefined as {
      first: unknown;
      close: Error;
    } | undefined,
    advanceError: undefined as {
      cause: unknown;
    } | undefined, plannedBytes: undefined as Buffer | undefined,
    writerOpen: false, writerClosed: false, observedFull: undefined as {
      cause: unknown;
    } | undefined,
    stableHook: undefined as (() => Promise<void>) | undefined,
    externalHook: undefined as (() => Promise<void>) | undefined,
    afterE: undefined as (() => Promise<void>) | undefined,
    afterRead: undefined as ((slot: CrashSafeFileSlot) => Promise<void>) | undefined,
    savedE: undefined as {
      assertAfterSlotRead(): Promise<void>;
    } | undefined,
  };
  const input = {
    userDataRoot: f.root,
    registry: {
      async inspectSlots(...args: Parameters<WorkspaceRegistryStore['inspectSlots']>) {
        if (state.inE) {
          state.externalCalls++;
          await state.externalHook?.();
        }
        return registry.inspectSlots(...args);
      }
    },
    async assertWritersAbsent() { assertCurrent(); },
    async assertStableSelection() {
      if (state.inE) {
        state.stableCalls++;
        await state.stableHook?.();
      }
      assertCurrent();
    },
  };
  const target = await captureDeletionTarget({
    installationRoot: f.root, workspaceId: header.workspaceId,
    typedLabel: base.workspaces[1]!.workspaceLabel, registry, assertAuthority: assertCurrent
  });
  const operationId = id(200);
  const published = await createWorkspaceDeletionPublisher(input)(assertCurrent, f.authority.assertExternalSelection, target.target, { operationId, target: target.target, backupDisposition: 'explicitDataLoss' }, target.assertCurrent);
  const paths = createWorkspaceDeletionJournalPaths(f.root);
  const inventory = createWorkspaceDeletionInventoryPaths(f.root, operationId);
  const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
  const cut = new Error('SYNTHETIC_ACTUAL_INTERMEDIATE_RECEIPT');
  const advance = WorkspaceDeletionJournalStore.prototype.advance;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(async function(this: WorkspaceDeletionJournalStore, ...args) {
    state.plannedBytes = serializeWorkspaceDeletionJournal(args[0] as ReturnType<typeof journal>);
    const fs = Reflect.get(this, 'fileSystem') as ReturnType<typeof createNodeCrashSafeFileSlotFileSystem>;
    const read = fs.readSlot.bind(fs);
    fs.readSlot = async (...values) => {
      const bytes = await read(...values);
      await state.afterRead?.(values[0]);
      return bytes;
    };
    for (const method of ['prepareDirectory', 'createNextWriter', 'moveSlot', 'removeSlot', 'syncDirectory'] as const) {
      const original = fs[method].bind(fs);
      Object.defineProperty(fs, method, {
        configurable: true, value: async (...values: unknown[]) => {
          const index = method === 'moveSlot' ? 2 : method === 'removeSlot' ? 1 : 0;
          const guard = values[index] as CrashSafeFileSlotMutationGuard;
          values[index] = {
            assertAuthority: guard.assertAuthority, async beforeMutation() {
              await guard.beforeMutation();
              state.mutations++;
            }
          };
          state.nativeDepth++;
          try {
            const result = await Reflect.apply(original, fs, values);
            if (method !== 'createNextWriter')
              return result;
            const writer = result as Awaited<ReturnType<typeof fs.createNextWriter>>;
            state.writerOpen = true;
            return {
              ...writer, async write(bytes: Uint8Array) {
                const count = await writer.write(bytes);
                if (state.writerFaults !== undefined)
                  throw state.writerFaults.first;
                return count;
              }, sync: writer.sync.bind(writer),
              readIdentity: writer.readIdentity?.bind(writer),
              async close() {
                await writer.close(); state.writerOpen = false; state.writerClosed = true; if (state.writerFaults !== undefined)
                  throw state.writerFaults.close;
              }
            };
          }
          finally {
            state.nativeDepth--;
          }
        }
      });
    }
    const forwarded: unknown[] = [...args];
    const selection = args[1];
    forwarded[1] = {
      ...selection, async assertExternalSelection() {
        try {
          await selection.assertExternalSelection();
        }
        catch (cause) {
          state.observedFull ??= { cause };
          throw cause;
        }
      }
    };
    const intermediate = forwarded[3] as {
      assertAfterSlotRead(): Promise<void>;
    } | undefined;
    expect(typeof intermediate?.assertAfterSlotRead).toBe('function');
    state.savedE = intermediate;
    if (intermediate !== undefined)
      forwarded[3] = {
        async assertAfterSlotRead() {
          state.inE = true;
          try {
            await intermediate.assertAfterSlotRead();
            await state.afterE?.();
          }
          finally {
            state.inE = false;
          }
        }
      };
    try {
      await Reflect.apply(advance, this, forwarded);
    }
    catch (cause) {
      state.advanceError = { cause };
      throw cause;
    }
    throw cut;
  });
  io.root = f.root;
  io.path = '';
  const pending: Promise<unknown>[] = [], releases: (() => void)[] = [];
  const execute = createWorkspaceDeletionPayloadExecutor(input);
  const run = () => {
    const work = execute(operationId, { assertCurrent, assertOwned: f.authority.assertExternalSelection }, published.journal);
    pending.push(work.catch(error => error));
    return work;
  };
  test.onTestFinished(async () => {
    for (const release of releases)
      release(); await Promise.allSettled(pending);
  });
  return {
    ...f, state, paths, inventory, registryBefore, lost, cut, run, releases,
    revoke() { live = false; },
    async snapshot() {
      const slots: Record<string, string> = {};
      for (const [name, path] of Object.entries({ current: paths.currentPath, next: paths.nextPath, backup: paths.backupPath })) {
        try {
          slots[name] = await readFile(path, 'hex');
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
        }
      }
      return {
        slots, inventory: await readFile(inventory.currentPath, 'hex'),
        registry: await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME), 'hex')
      };
    },
  };
}
for (const point of ['initial', 'prepared'] as const)
  for (const transient of [false, true]) {
    it(`payload journal: ${point} real inventory ${transient ? 'transient' : 'persistent'}`, { timeout: 30000 }, async (test) => {
      const f = await createPayloadJournalFixture(test), original = await readFile(f.inventory.currentPath);
      const changed = Buffer.from(original);
      changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
      let attacked = false, restored = false, mutations = -1;
      let attackedBytes: Awaited<ReturnType<typeof f.snapshot>> | undefined;
      f.state.afterRead = async (slot) => {
        if (slot !== 'backup' || attacked || f.state.nativeDepth !== 0)
          return;
        const names = await readdir(f.paths.directoryPath);
        const prepared = names.includes('workspace-deletion-journal-v1.json.next');
        if ((point === 'prepared') !== prepared)
          return;
        expect(f.state.writerOpen).toBe(false);
        expect(io.live.size).toBe(0);
        expect(f.state.writerClosed).toBe(point === 'prepared');
        attacked = true;
        mutations = f.state.mutations;
        await writeFile(f.inventory.currentPath, changed);
        attackedBytes = await f.snapshot();
      };
      f.state.afterE = async () => {
        if (attacked && transient && !restored) {
          restored = true;
          await writeFile(f.inventory.currentPath, original);
        }
      };
      const error = await f.run().catch(error => error);
      expect(attacked).toBe(true);
      if (transient) {
        expect(error).toBe(f.cut);
        expect(await readFile(f.inventory.currentPath)).toEqual(original);
        expect((JSON.parse((await readFile(f.paths.currentPath)).toString()) as {
          phase: string;
        }).phase).toBe('quarantined');
        expect(f.state.mutations).toBe(7);
      }
      else {
        expect(error).toBe(f.state.observedFull!.cause);
        expect(error).toMatchObject({ message: 'WORKSPACE_DELETE_INVENTORY_INVALID' });
        expect(f.state.mutations).toBe(mutations);
        expect(await f.snapshot()).toEqual(attackedBytes);
        expect((JSON.parse((await readFile(f.paths.currentPath)).toString()) as {
          phase: string;
        }).phase).toBe('authorized');
      }
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(f.registryBefore);
    });
  }
{
  for (const boundary of ['secondStable', 'phaseExternal'] as const)
    for (const first of [new Error('SYNTHETIC_ACTUAL_E_BOUNDARY'), undefined]) {
      it(`payload journal: ${boundary} preserves ${first === undefined ? 'undefined' : 'Error'}`, { timeout: 30000 }, async (test) => {
        const f = await createPayloadJournalFixture(test);
        f.state.stableHook = async () => {
          if (boundary === 'secondStable' && f.state.stableCalls === 2)
            throw first;
        };
        f.state.externalHook = async () => {
          if (boundary === 'phaseExternal')
            throw first;
        };
        let rejected = false, observed: unknown;
        await f.run().then(() => undefined, error => { rejected = true; observed = error; });
        expect(rejected).toBe(true);
        expect(observed).toBe(first);
        expect(f.state.mutations).toBe(0);
        expect(f.state.stableCalls).toBe(boundary === 'secondStable' ? 2 : 1);
        expect((JSON.parse((await readFile(f.paths.currentPath)).toString()) as {
          phase: string;
        }).phase).toBe('authorized');
        expect(await readdir(f.paths.directoryPath)).not.toContain('workspace-deletion-journal-v1.json.next');
        await expect(f.state.savedE!.assertAfterSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      });
    }
  for (const boundary of ['stable', 'phase'] as const) {
    it(`payload journal: joins awaited ${boundary} on revocation`, { timeout: 30000 }, async (test) => {
      const f = await createPayloadJournalFixture(test);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
      f.releases.push(release);
      const hook = async () => { enter(); await held; };
      if (boundary === 'stable')
        f.state.stableHook = hook;
      else
        f.state.externalHook = hook;
      let settled = false;
      const work = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
      try {
        await Promise.race([entered, work.then(() => { throw new Error('SYNTHETIC_E_WAIT_NOT_REACHED'); })]);
        f.revoke();
        await setImmediate();
        expect(settled).toBe(false);
      }
      finally {
        release();
        await work;
      }
      expect(await work).toBe(f.lost);
      expect(f.state.mutations).toBe(0);
      expect(await readdir(f.paths.directoryPath)).not.toContain('workspace-deletion-journal-v1.json.next');
    });
  }
  for (const revoked of [false, true]) {
    it(`payload journal: owned writer close joins before ${revoked ? 'revocation' : 'receipt'}`, { timeout: 30000 }, async (test) => {
      const f = await createPayloadJournalFixture(test);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
      let heldSnapshot: Awaited<ReturnType<typeof f.snapshot>> | undefined;
      let admittedAtHold = -1;
      f.releases.push(release);
      io.path = f.paths.nextPath;
      io.beforeClose = async () => { enter(); await held; };
      let settled = false;
      const work = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
      try {
        await Promise.race([entered, work.then(() => { throw new Error('SYNTHETIC_CLOSE_NOT_REACHED'); })]);
        expect(f.state.writerOpen).toBe(true);
        expect(io.live.size).toBeGreaterThan(0);
        await f.state.savedE!.assertAfterSlotRead();
        heldSnapshot = await f.snapshot();
        admittedAtHold = f.state.mutations;
        expect(heldSnapshot.slots.next).toBeDefined();
        expect((JSON.parse(Buffer.from(heldSnapshot.slots.next!, 'hex').toString()) as {
          phase: string;
        }).phase).toBe('quarantined');
        if (revoked)
          f.revoke();
        await setImmediate();
        expect(settled).toBe(false);
      }
      finally {
        release();
        await work;
      }
      expect(await work).toBe(revoked ? f.lost : f.cut);
      if (revoked) {
        expect(await f.snapshot()).toEqual(heldSnapshot);
        expect(f.state.mutations).toBe(admittedAtHold);
      }
      expect(f.state.writerClosed).toBe(true);
      expect(f.state.writerOpen).toBe(false);
      expect(io.live.size).toBe(0);
      const opens = io.handles.length;
      await expect(f.state.savedE!.assertAfterSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(io.handles.length).toBe(opens);
      expect((JSON.parse((await readFile(f.paths.currentPath)).toString()) as {
        phase: string;
      }).phase).toBe(revoked ? 'authorized' : 'quarantined');
    });
  }
}
for (const first of [new Error('SYNTHETIC_NATIVE_FULL_FIRST'), undefined,
new AggregateError([new Error('SYNTHETIC_FULL_READ'), new Error('SYNTHETIC_FULL_CLOSE')], 'SYNTHETIC_OBSERVED_FULL_AGGREGATE')]) {
  it('payload journal: preserves ' + (first === undefined ? 'undefined' : first instanceof AggregateError ? 'aggregate' : 'Error') + ' from native full proof', { timeout: 30000 }, async (test) => {
    const f = await createPayloadJournalFixture(test), before = await f.snapshot();
    const consume = actualInventoryStore.WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
    let injected = false;
    vi.spyOn(actualInventoryStore.WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: actualInventoryStore.WorkspaceDeletionInventoryStore, ...args) {
      if (!injected && f.state.nativeDepth > 0) {
        injected = true;
        return Promise.reject(first);
      }
      return consume.apply(this, args);
    });
    let rejected = false, observed: unknown;
    await f.run().then(() => undefined, error => { rejected = true; observed = error; });
    expect(rejected).toBe(true);
    expect(injected).toBe(true);
    expect(f.state.observedFull!.cause).toBe(first);
    expect(observed).toBe(first);
    expect(f.state.mutations).toBe(0);
    expect(await f.snapshot()).toEqual(before);
  });
}
for (const first of [new Error('SYNTHETIC_ACTUAL_WRITER_FIRST'), undefined]) {
  it("payload journal: joins close and retains writer/close aggregate for " + (first === undefined ? 'undefined' : 'Error'), { timeout: 30000 }, async (test) => {
    const f = await createPayloadJournalFixture(test), before = await f.snapshot();
    const later = new Error('SYNTHETIC_ACTUAL_WRITER_CLOSE');
    f.state.writerFaults = { first, close: later };
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    f.releases.push(release);
    io.path = f.paths.nextPath;
    io.beforeClose = async () => { enter(); await held; };
    let settled = false;
    const work = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    try {
      await Promise.race([entered, work.then(() => { throw new Error('SYNTHETIC_AGGREGATE_CLOSE_NOT_REACHED'); })]);
      expect(f.state.writerOpen).toBe(true);
      expect(io.live.size).toBeGreaterThan(0);
      await setImmediate();
      expect(settled).toBe(false);
    }
    finally {
      release();
      await work;
    }
    const observed = await work;
    expect(observed).toBeInstanceOf(AggregateError);
    expect(observed).toBe(f.state.advanceError!.cause);
    expect(observed.errors[0]).toBe(first);
    expect(observed.errors[1]).toBe(later);
    expect(observed.errors).toHaveLength(2);
    expect(f.state.observedFull).toBeUndefined();
    expect(f.state.writerClosed).toBe(true);
    expect(io.live.size).toBe(0);
    expect(f.state.mutations).toBe(2);
    const after = await f.snapshot();
    expect(after.slots.current).toBe(before.slots.current);
    expect(after.slots.backup).toBeUndefined();
    expect(after.slots.next).toBe(f.state.plannedBytes!.toString('hex'));
    expect(after.inventory).toBe(before.inventory);
    expect(after.registry).toBe(before.registry);
  });
}
