import { readdir, readFile, rename, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it, vi, type TestContext } from 'vitest';
import { captureDeletionTarget } from "../management/workspaceDeletionTarget.js";
import { type CrashSafeByteSlotReadSelection } from "../persistence/crashSafeByteSlotStore.js";
import { type CrashSafeFileSlotIdentity, type CrashSafeFileSlotMutationGuard } from "../persistence/crashSafeFileSlot.js";
import { WORKSPACE_REGISTRY_FILE_NAME } from "../registry/workspaceRegistryPaths.js";
import { WorkspaceRegistryStore } from "../registry/workspaceRegistryStore.js";
import { createSwitchRegistry } from "../switch/workspaceSwitchTestSupport.js";
import { deletionTestHeader as header, deletionTestId as id, deletionTestJournal as journal } from "./workspaceDeletionDataTestSupport.js";
import { serializeWorkspaceDeletionJournal } from "./workspaceDeletionJournalCodec.js";
import { createWorkspaceDeletionJournalReadFixture, publishedDeletionJournalPlan as publishedPlan } from './workspaceDeletionJournalReadTestSupport.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from "./workspaceDeletionJournalStore.js";
import { createWorkspaceDeletionPayloadExecutor } from "./workspaceDeletionPayloadExecutor.js";
import { createWorkspaceDeletionPublisher } from "./workspaceDeletionPublication.js";
import { deletionRoleSourceFixture } from "./workspaceDeletionRolesTestSupport.js";
function fixture(test: TestContext, mode: Parameters<typeof createWorkspaceDeletionJournalReadFixture>[2] = 'published') {
  return createWorkspaceDeletionJournalReadFixture(test, io, mode);
}
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
type ReadSelection = CrashSafeByteSlotReadSelection;
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
it('keeps a complete final proof after slot reads at every native advance boundary', async (test) => {
  const f = await fixture(test);
  await f.run();
  expect(f.calls.full).toBe(10);
  expect(f.calls.read).toBe(10);
  expect(f.calls.slots).toBe(33);
  for (let index = 0; index < f.events.length; index++)
    if (f.events[index]!.startsWith('authorized:')) {
      expect(f.events[index - 1]).toBe('full');
      expect(f.events.slice(index - 4, index - 1)).toEqual(['slot:current', 'slot:next', 'slot:backup']);
    }
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
  expect(publishedPlan((await f.store.inspect(f.assertAuthority)).plan).selected.phase).toBe('quarantined');
});
it.for(['published', 'recovery'] as const)('retains bytes when a late %s proof rejects', async (mode, test) => {
  const f = await fixture(test, mode);
  let attacked: Record<string, string> | undefined;
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => {
    const value = await read(...args);
    if (args[0] === 'backup' && attacked === undefined) {
      await writeFile(f.payloadPath, 'changed-payload');
      attacked = await f.snapshot();
    }
    return value;
  };
  await expect(f.run()).rejects.toBe(f.contentFailure);
  expect(await f.snapshot()).toEqual(attacked);
  expect(f.calls.mutations).toBe(0);
});
it.for(['publish', 'removeBackup', 'recover', 'restoreBackup', 'recoverBackup'].flatMap(stage => ['payload', 'competitor'].map(kind => [stage, kind] as const)))('rejects %s late %s during the last native slot read', async ([stage, kind], test) => {
  const f = await fixture(test, stage === 'recover' ? 'recovery' : stage === 'restoreBackup' ? 'backupNext'
    : stage === 'recoverBackup' ? 'currentBackup' : 'published');
  let insideNativeGuard = false, attacked: Record<string, string> | undefined, mutationsAtAttack = -1;
  const scope = (guard: CrashSafeFileSlotMutationGuard | undefined) => {
    if (guard === undefined)
      throw new Error('SYNTHETIC_NATIVE_MUTATION_GUARD_MISSING');
    return {
      assertAuthority: guard.assertAuthority, async beforeMutation() {
        expect(insideNativeGuard).toBe(false);
        insideNativeGuard = true;
        try {
          await guard.beforeMutation();
        }
        finally {
          insideNativeGuard = false;
        }
      }
    };
  };
  if (stage === 'publish' || stage === 'restoreBackup') {
    const move = f.fs.moveSlot.bind(f.fs);
    f.fs.moveSlot = async (source, destination, guard) => move(source, destination, source === (stage === 'publish' ? 'next' : 'backup') ? scope(guard) : guard);
  }
  else {
    const remove = f.fs.removeSlot.bind(f.fs);
    f.fs.removeSlot = async (slot, guard) => remove(slot, slot === (stage === 'recover' ? 'next' : 'backup') ? scope(guard) : guard);
  }
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => {
    const value = await read(...args);
    if (insideNativeGuard && args[0] === 'backup' && !attacked) {
      const present = (await readdir(f.paths.directoryPath)).sort();
      const current = 'workspace-deletion-journal-v1.json';
      expect(present).toEqual((stage === 'publish' ? [current + '.backup', current + '.next']
        : stage === 'restoreBackup' ? [current + '.backup']
          : stage === 'recover' ? [current, current + '.next'] : [current, current + '.backup']).sort());
      await writeFile(kind === 'payload' ? f.payloadPath : f.competitorPath, 'changed');
      attacked = await f.snapshot();
      mutationsAtAttack = f.calls.mutations;
    }
    return value;
  };
  await expect(f.run()).rejects.toThrow();
  expect(attacked).toBeDefined();
  expect(await f.snapshot()).toEqual(attacked);
  expect(f.calls.mutations).toBe(mutationsAtAttack);
  let replay: unknown;
  try {
    f.assertAuthority();
  }
  catch (error) {
    replay = error;
  }
  expect(replay).toBe(f.contentFailure);
});
it.for(['registry', 'writers', 'lease', 'slotIdentity'] as const)('rejects %s during the selected slot read', async (kind, test) => {
  const f = await fixture(test);
  let attacked: Record<string, string> | undefined;
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => {
    if (args[0] === 'current' && !attacked) {
      if (kind === 'registry')
        await writeFile(f.registryPath, 'changed-registry');
      else if (kind === 'writers')
        f.returnWriter();
      else if (kind === 'lease')
        f.expire();
      else {
        const bytes = await readFile(f.paths.currentPath);
        await rename(f.paths.currentPath, `${f.paths.currentPath}.retained`);
        await writeFile(f.paths.currentPath, bytes, { flag: 'wx' });
      }
      attacked = await f.snapshot();
    }
    return read(...args);
  };
  await expect(f.run()).rejects.toThrow();
  expect(await f.snapshot()).toEqual(attacked);
  expect(f.calls.mutations).toBe(0);
});
it.for(['read', 'close'] as const)('joins an actual pending %s before settling after revocation', async (stage, test) => {
  const f = await fixture(test), before = await f.snapshot();
  let release!: () => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  const hold = async () => { enter(); await held; };
  if (stage === 'read')
    io.beforeRead = hold;
  else
    io.beforeClose = hold;
  let settled = false;
  const work = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, work.then(() => { throw new Error('SYNTHETIC_JOURNAL_NOT_HELD'); })]);
    expect(io.live.size).toBeGreaterThan(0);
    f.expire();
    await setImmediate();
    expect(settled).toBe(false);
  }
  finally {
    release();
    await work;
  }
  expect(await work).toBe(f.leaseFailure);
  expect(await f.snapshot()).toEqual(before);
  expect(f.calls.mutations).toBe(0);
  await expect(f.readSelection.assertBeforeSlotRead()).rejects.toBe(f.leaseFailure);
});
it('captures the read callback before the first await', async (test) => {
  const f = await fixture(test);
  let replacementCalls = 0, entered!: () => void, release!: () => void, first = true;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  const read = {
    async assertBeforeSlotRead() {
      await f.assertRead();
      if (first) {
        first = false;
        entered();
        await held;
      }
    }
  };
  const work = f.run(read);
  await enteredPromise;
  read.assertBeforeSlotRead = async () => { replacementCalls++; throw new Error('SYNTHETIC_REASSIGNED_CALLBACK'); };
  release();
  await work;
  expect(replacementCalls).toBe(0);
  expect(f.calls.read).toBe(10);
});
it.for([null, {}, { assertBeforeSlotRead: false }])('rejects an invalid explicit read context %# before file work', async (invalid, test) => {
  const f = await fixture(test), before = await f.snapshot();
  await expect(f.run(invalid as unknown as ReadSelection)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect(f.calls.slots).toBe(0);
  expect(f.calls.full).toBe(0);
  expect(f.calls.mutations).toBe(0);
});
it('leaves default calls full/slots/full and ignores spreadable read fields', async (test) => {
  const f = await fixture(test);
  let leakedCalls = 0;
  const spreadable = { ...f.byteSelection, assertBeforeSlotRead: async () => { leakedCalls++; } };
  await f.bytes.replaceSelected(serializeWorkspaceDeletionJournal(journal('quarantined')), spreadable);
  expect(leakedCalls).toBe(0);
  expect(f.calls.read).toBe(0);
  expect(f.calls.full).toBe(20);
});
it('does not promote initial-next through recover', async (test) => {
  const f = await fixture(test, 'initial'), before = await f.snapshot();
  await expect(f.run()).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect(f.calls.mutations).toBe(0);
});
it.for(['recovery', 'backupNext', 'currentBackup'] as const)('preserves selected identity during legal interrupted recovery %s', async (mode, test) => {
  const f = await fixture(test, mode);
  const original = f.select.slots.current ?? f.select.slots.backup!;
  const identity = await f.run();
  expect(identity.ino).toBe(original.identity!.ino);
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
  expect(publishedPlan((await f.store.inspect(f.assertAuthority)).plan).selected.phase).toBe(original.value.phase);
});
it('records the first observed failure for independently invalid slot and payload', async (test) => {
  const f = await fixture(test);
  await writeFile(f.payloadPath, 'invalid');
  const bytes = await readFile(f.paths.currentPath);
  await rename(f.paths.currentPath, `${f.paths.currentPath}.retained`);
  await writeFile(f.paths.currentPath, bytes, { flag: 'wx' });
  const before = await f.snapshot();
  const error = await f.run().catch(error => error);
  expect(error.message).toBe('CRASH_SAFE_BYTE_SLOT_UNAVAILABLE');
  expect(await f.snapshot()).toEqual(before);
  expect(f.calls.mutations).toBe(0);
});
it('retains original write and later close errors with the new read argument', async (test) => {
  const f = await fixture(test), first = new Error('SYNTHETIC_WRITE_FAILURE'), later = new Error('SYNTHETIC_CLOSE_FAILURE');
  const create = f.fs.createNextWriter.bind(f.fs);
  f.fs.createNextWriter = async (guard) => {
    const file = await create(guard);
    return {
      readIdentity: () => file.readIdentity!(), async write() { throw first; }, sync: () => file.sync(),
      async close() { await file.close(); throw later; },
    };
  };
  const error = await f.bytes.replaceSelected(serializeWorkspaceDeletionJournal(journal('quarantined')), f.byteSelection, f.readSelection).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors[0]).toBe(first);
  expect(error.errors[1]).toBe(later);
  expect((await f.snapshot())['workspace-deletion-journal-v1.json.next']).toBe('');
});
it('rejects mutation-source identity replacement inside the final full proof', async (test) => {
  const f = await fixture(test);
  let armed = false, attacked: Record<string, string> | undefined;
  const move = f.fs.moveSlot.bind(f.fs);
  f.fs.moveSlot = async (...args) => {
    if (args[0] === 'next')
      armed = true;
    return move(...args);
  };
  f.select.assertExternalSelection = async () => {
    await f.assertFull();
    if (armed && !attacked) {
      const bytes = await readFile(f.paths.nextPath);
      await rename(f.paths.nextPath, `${f.paths.nextPath}.retained`);
      await writeFile(f.paths.nextPath, bytes, { flag: 'wx' });
      attacked = await f.snapshot();
    }
  };
  await expect(f.run()).rejects.toThrow();
  expect(attacked).toBeDefined();
  expect(await f.snapshot()).toEqual(attacked);
  expect(await readdir(f.paths.directoryPath)).not.toContain('workspace-deletion-journal-v1.json');
});
it.for(['advance', 'recover'] as const)('forwards scoped read authority through the actual executor %s call', { timeout: 30000 }, async (stage, test) => {
  const f = await deletionRoleSourceFixture(test);
  const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: join(f.root, WORKSPACE_REGISTRY_FILE_NAME) });
  const base = createSwitchRegistry();
  await registry.write({
    ...base, formatVersion: 2, workspaces: [base.workspaces[0]!,
    { ...base.workspaces[1]!, workspaceId: header.workspaceId, lineageIdentity: header.lineageIdentity }]
  });
  const assertCurrent = f.authority.assertAuthority;
  const target = await captureDeletionTarget({
    installationRoot: f.root, workspaceId: header.workspaceId,
    typedLabel: base.workspaces[1]!.workspaceLabel, registry, assertAuthority: assertCurrent
  });
  let stableCalls = 0, registryReads = 0, tracing = false, failStable = false, scopeOnly = false;
  let stableFailure: unknown;
  const trace: string[] = [];
  io.root = f.root;
  const input = {
    userDataRoot: f.root, registry, assertWritersAbsent: async () => { assertCurrent(); },
    assertStableSelection: async () => {
      stableCalls++; if (tracing)
        trace.push('stable'); if (failStable && tracing)
        throw stableFailure; assertCurrent();
    }
  };
  const operationId = id(200);
  const published = await createWorkspaceDeletionPublisher(input)(assertCurrent, f.authority.assertExternalSelection, target.target, { operationId, target: target.target, backupDisposition: 'explicitDataLoss' }, target.assertCurrent);
  const registryRead = registry.inspectSlots.bind(registry);
  vi.spyOn(registry, 'inspectSlots').mockImplementation(async (...args) => {
    registryReads++;
    if (tracing)
      trace.push('external-registry');
    return registryRead(...args);
  });
  const paths = createWorkspaceDeletionJournalPaths(f.root);
  if (stage === 'recover') {
    const value = JSON.parse((await readFile(paths.currentPath)).toString('utf8'));
    await writeFile(paths.nextPath, JSON.stringify({ ...value, phase: 'quarantined' }), { flag: 'wx', mode: 0o600 });
  }
  const cut = new Error('SYNTHETIC_FIRST_JOURNAL_BOUNDARY_DONE');
  let saved: ReadSelection | undefined, observed = 0;
  let savedIntermediate: {
    assertAfterSlotRead(): Promise<void>;
  } | undefined;
  let oldIntermediate: {
    assertAfterSlotRead(): Promise<void>;
  } | undefined;
  const complete = async (read: ReadSelection | undefined, work: () => Promise<Readonly<CrashSafeFileSlotIdentity>>) => {
    expect(typeof read?.assertBeforeSlotRead).toBe('function');
    saved = read;
    await work();
    observed++;
    throw cut;
  };
  if (stage === 'advance') {
    const original = WorkspaceDeletionJournalStore.prototype.advance;
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(function(this: WorkspaceDeletionJournalStore, ...args) {
      return complete(args[2], async () => {
        const intermediate = Reflect.get(args, 3) as {
          assertAfterSlotRead(): Promise<void>;
        } | undefined;
        expect(typeof intermediate?.assertAfterSlotRead).toBe('function');
        if (oldIntermediate !== undefined) {
          const before = { stable: stableCalls, registry: registryReads, opens: io.handles.length };
          await expect(oldIntermediate.assertAfterSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
          expect({ stable: stableCalls, registry: registryReads, opens: io.handles.length }).toEqual(before);
        }
        const start = stableCalls;
        await args[2]!.assertBeforeSlotRead();
        expect(stableCalls).toBe(start);
        if (intermediate !== undefined) {
          savedIntermediate = intermediate;
          trace.length = 0;
          tracing = true;
          try {
            await intermediate.assertAfterSlotRead();
          }
          finally {
            tracing = false;
          }
          expect(trace).toEqual(['stable', 'external-registry', 'stable']);
          expect(stableCalls).toBe(start + 2);
        }
        if (scopeOnly)
          throw cut;
        return original.apply(this, args);
      });
    });
  }
  else {
    const original = WorkspaceDeletionJournalStore.prototype.recover;
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'recover').mockImplementation(function(this: WorkspaceDeletionJournalStore, ...args) {
      return complete(args[1], () => original.apply(this, args));
    });
  }
  const execute = createWorkspaceDeletionPayloadExecutor(input);
  const work = execute(operationId, { assertCurrent, assertOwned: f.authority.assertExternalSelection }, published.journal);
  test.onTestFinished(async () => { f.expire(); await work.catch(() => undefined); });
  await expect(work).rejects.toBe(cut);
  expect(observed).toBe(1);
  if (stage === 'advance') {
    const before = stableCalls;
    await expect(savedIntermediate!.assertAfterSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(stableCalls).toBe(before);
  }
  await expect(saved!.assertBeforeSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  const slots = await new WorkspaceDeletionJournalStore(f.root).inspect(assertCurrent);
  expect(slots.slots.next).toBeUndefined();
  expect(slots.slots.backup).toBeUndefined();
  expect(publishedPlan(slots.plan).selected.phase).toBe(stage === 'advance' ? 'quarantined' : 'authorized');
  if (stage === 'advance') {
    scopeOnly = true;
    for (const first of [new Error('SYNTHETIC_EXECUTOR_INTERMEDIATE_STABLE'), undefined]) {
      oldIntermediate = savedIntermediate;
      failStable = true;
      stableFailure = first;
      let rejected = false, observedFailure: unknown;
      await execute(operationId, { assertCurrent, assertOwned: f.authority.assertExternalSelection }, published.journal)
        .then(() => undefined, error => { rejected = true; observedFailure = error; });
      expect(rejected).toBe(true);
      expect(observedFailure).toBe(first);
      oldIntermediate = savedIntermediate;
      failStable = false;
      await expect(execute(operationId, { assertCurrent, assertOwned: f.authority.assertExternalSelection }, published.journal)).rejects.toBe(cut);
      expect(publishedPlan((await new WorkspaceDeletionJournalStore(f.root).inspect(assertCurrent)).plan).selected.phase).toBe('quarantined');
    }
  }
});
