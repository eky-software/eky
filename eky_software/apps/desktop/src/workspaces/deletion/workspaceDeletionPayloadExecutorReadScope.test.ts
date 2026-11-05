import { readFile, readdir, rename, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it, vi, type TestContext } from 'vitest';
import { deriveWorkspaceBackupImportPaths } from "../import/workspaceBackupImportPaths.js";
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { captureDeletionTarget } from "../management/workspaceDeletionTarget.js";
import { WORKSPACE_REGISTRY_FILE_NAME } from "../registry/workspaceRegistryPaths.js";
import { WorkspaceRegistryStore } from "../registry/workspaceRegistryStore.js";
import { createSwitchRegistry } from "../switch/workspaceSwitchTestSupport.js";
import { createNodeCrashSafeFileSlotFileSystem } from "../persistence/crashSafeFileSlot.js";
import { deletionTestHeader as header, deletionTestId as id } from "./workspaceDeletionDataTestSupport.js";
import { WorkspaceDeletionInventoryStore, createWorkspaceDeletionInventoryPaths } from "./workspaceDeletionInventoryStore.js";
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from "./workspaceDeletionJournalStore.js";
import { maximumWorkspaceDeletionJournalBytes } from "./workspaceDeletionJournalCodec.js";
import { createWorkspaceDeletionPayloadExecutor } from "./workspaceDeletionPayloadExecutor.js";
import * as phaseSelection from './workspaceDeletionPhaseSelection.js';
import { createWorkspaceDeletionPublisher } from "./workspaceDeletionPublication.js";
import { workspaceDeletionPurgeFileSystem } from "./workspaceDeletionPurge.js";
import { workspaceDeletionQuarantineFileSystem } from "./workspaceDeletionQuarantine.js";
import { deletionRoleSourceFixture } from "./workspaceDeletionRolesTestSupport.js";
import { remnantTestBinding } from "./workspaceRemnantBindingTestSupport.js";
const io = vi.hoisted(() => ({
  path: undefined as string | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined,
  afterRead: undefined as (() => Promise<void>) | undefined,
  beforeClose: undefined as (() => Promise<void>) | undefined,
  afterClose: undefined as (() => Promise<void>) | undefined,
  handles: [] as FileHandle[], live: new Set<FileHandle>()
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual, async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args);
      if (args[0] !== io.path)
        return handle;
      io.handles.push(handle);
      io.live.add(handle);
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'read')
            return async (...readArgs: Parameters<FileHandle['read']>) => {
              const before = io.beforeRead;
              io.beforeRead = undefined;
              await before?.();
              const result = await Reflect.apply(target.read, target, readArgs);
              const after = io.afterRead;
              io.afterRead = undefined;
              await after?.();
              return result;
            };
          if (key === 'close')
            return async () => {
              const before = io.beforeClose;
              io.beforeClose = undefined;
              await before?.();
              await target.close();
              io.live.delete(target);
              const after = io.afterClose;
              io.afterClose = undefined;
              await after?.();
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  };
});
const options = { timeout: 30000 };
function observePhysicalPass() {
  const capture = phaseSelection.captureWorkspaceDeletionPhaseSelection;
  let phase: Awaited<ReturnType<typeof capture>>['journal']['phase'] | undefined, reads = 0;
  vi.spyOn(phaseSelection, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (...args) => {
    const selected = await capture(...args);
    phase = selected.journal.phase;
    reads = 0;
    return selected;
  });
  return { next(stage: 'move' | 'purge') {
    // Each actual phase first locates the workspace, validates, then mutates.
    return reads++ === 2 && phase === (stage === 'move' ? 'authorized' : 'purgeAuthorized');
  } };
}
type CapturedInventoryRead = {
  authority: Parameters<WorkspaceDeletionInventoryStore['consumeSelectedRecords']>[1];
  consume: Parameters<WorkspaceDeletionInventoryStore['consumeSelectedRecords']>[2];
};
async function snapshot(root: string) {
  const result: Record<string, string> = {};
  const visit = async (path: string, prefix: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const key = prefix + entry.name, child = join(path, entry.name);
      if (entry.isDirectory()) {
        result[key + '/'] = 'directory';
        await visit(child, key + '/');
      }
      else
        result[key] = (await readFile(child)).toString('hex');
    }
  };
  await visit(root, '');
  return result;
}
async function fixture(test: TestContext, binding = false) {
  const f = await deletionRoleSourceFixture(test);
  let candidateRoot: string | undefined;
  if (binding) {
    const value = await f.publish({ ...remnantTestBinding('workspaceImport'), operationId: id(20) });
    candidateRoot = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(value.operationId), value.workspaceId).candidateRoot;
    await f.payload(candidateRoot);
  }
  const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: registryPath });
  const base = createSwitchRegistry();
  await registry.write({
    ...base, formatVersion: 2,
    workspaces: [base.workspaces[0]!, { ...base.workspaces[1]!, workspaceId: header.workspaceId, lineageIdentity: header.lineageIdentity }]
  });
  const selected = await captureDeletionTarget({
    installationRoot: f.root, workspaceId: header.workspaceId,
    typedLabel: base.workspaces[1]!.workspaceLabel, registry, assertAuthority: f.authority.assertAuthority
  });
  const assertCurrent = f.authority.assertAuthority;
  let absent = true;
  const writerError = new Error('SYNTHETIC_EXECUTOR_WRITER_PRESENT');
  const assertWritersAbsent = vi.fn(async () => {
    assertCurrent(); if (!absent)
      throw writerError;
  });
  const input = { userDataRoot: f.root, registry, assertWritersAbsent };
  const operationId = id(200);
  const published = await createWorkspaceDeletionPublisher(input)(assertCurrent, f.authority.assertExternalSelection, selected.target, { operationId, target: selected.target, backupDisposition: 'explicitDataLoss' }, selected.assertCurrent);
  const quarantine = {
    ...workspaceDeletionQuarantineFileSystem,
    entry: vi.fn(workspaceDeletionQuarantineFileSystem.entry), move: vi.fn(workspaceDeletionQuarantineFileSystem.move)
  };
  const purge = {
    ...workspaceDeletionPurgeFileSystem,
    entry: vi.fn(workspaceDeletionPurgeFileSystem.entry), unlink: vi.fn(workspaceDeletionPurgeFileSystem.unlink),
    rmdir: vi.fn(workspaceDeletionPurgeFileSystem.rmdir)
  };
  const command = createWorkspaceDeletionPayloadExecutor(input, { quarantine, purge });
  const pending: Promise<unknown>[] = [], releases: (() => void)[] = [];
  test.onTestFinished(async () => {
    for (const release of releases)
      release(); await Promise.allSettled(pending);
  });
  io.path = createWorkspaceDeletionInventoryPaths(f.root, operationId).currentPath;
  const run = () => {
    const result = command(operationId, { assertCurrent, assertOwned: f.authority.assertExternalSelection });
    pending.push(result.catch(error => error));
    return result;
  };
  return {
    ...f, input, registry, registryPath, published, operationId, quarantine, purge,
    journalPaths: createWorkspaceDeletionJournalPaths(f.root), candidateRoot, assertWritersAbsent,
    writerError, addWriter() { absent = false; }, run, releases,
    mutationCount: () => quarantine.move.mock.calls.length + purge.unlink.mock.calls.length + purge.rmdir.mock.calls.length
  };
}
afterEach(() => {
  expect(io.live.size).toBe(0);
  for (const handle of io.handles)
    expect(handle.fd).toBe(-1);
  io.path = undefined;
  io.beforeRead = undefined;
  io.afterRead = undefined;
  io.beforeClose = undefined;
  io.afterClose = undefined;
  io.handles = [];
  io.live.clear();
  vi.restoreAllMocks();
});
it.for([0, 1].flatMap(pass => ['registryIdentity', 'journalIdentity', 'phase'].map(kind => [pass, kind] as const)))('rejects a late close change in readonly pass %i (%s)', options, async ([pass, kind], test) => {
  const f = await fixture(test), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const advance = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance');
  const recover = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'recover');
  let observed = 0, attacked: Record<string, string> | undefined;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: WorkspaceDeletionInventoryStore, ...args) {
    if (observed++ === pass)
      io.beforeClose = async () => {
        const path = kind === 'registryIdentity' ? f.registryPath : f.journalPaths.currentPath;
        const bytes = await readFile(path);
        await rename(path, `${path}.retained`);
        await writeFile(path, kind === 'phase'
          ? JSON.stringify({ ...JSON.parse(bytes.toString('utf8')), phase: 'quarantined' }) : bytes, { flag: 'wx', mode: 0o600 });
        attacked = await snapshot(f.root);
      };
    return original.apply(this, args);
  });
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(attacked).toBeDefined();
  expect(await snapshot(f.root)).toEqual(attacked);
  expect(f.mutationCount()).toBe(0);
  expect(advance).not.toHaveBeenCalled();
  expect(recover).not.toHaveBeenCalled();
});
it('expires old store and row callbacks during a fresh read and mutation pass', {
  ...options,
}, async (test) => {
  const f = await fixture(test), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let observed = 0, attacks = 0;
  let saved!: CapturedInventoryRead;
  let capturedRow!: Parameters<CapturedInventoryRead['consume']>[0];
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function(this: WorkspaceDeletionInventoryStore, value, authority, consume) {
    const index = observed++;
    if (index === 0)
      saved = { authority, consume };
    if (index === 1 || index === 2) {
      const before = f.assertWritersAbsent.mock.calls.length;
      expect(() => saved.authority.assertAuthority()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      await expect(saved.authority.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      await expect(saved.consume(capturedRow)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(f.assertWritersAbsent.mock.calls.length).toBe(before);
      attacks++;
    }
    return original.call(this, value, authority, async (row) => { capturedRow ??= row; await consume(row); });
  });
  f.quarantine.move.mockImplementationOnce(async (...args) => {
    await workspaceDeletionQuarantineFileSystem.move(...args);
    f.expire();
  });
  await expect(f.run()).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  expect(attacks).toBe(2);
  expect(f.quarantine.move).toHaveBeenCalledTimes(1);
  expect(f.purge.unlink).not.toHaveBeenCalled();
});
it('replays the original failed-read cause after its scope expires', {
  ...options,
}, async (test) => {
  const f = await fixture(test), before = await snapshot(f.root);
  const original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let saved!: CapturedInventoryRead;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: WorkspaceDeletionInventoryStore, value, authority, consume) {
    saved ??= { authority, consume };
    return original.call(this, value, authority, consume);
  });
  io.afterRead = async () => { f.addWriter(); };
  await expect(f.run()).rejects.toBe(f.writerError);
  expect(saved).toBeDefined();
  let syncFailure: unknown;
  try {
    saved.authority.assertAuthority();
  }
  catch (error) {
    syncFailure = error;
  }
  expect(syncFailure).toBe(f.writerError);
  await expect(saved.authority.assertExternalSelection()).rejects.toBe(f.writerError);
  await expect(saved.consume(undefined as unknown as Parameters<CapturedInventoryRead['consume']>[0])).rejects.toBe(f.writerError);
  expect(f.mutationCount()).toBe(0);
  expect(await snapshot(f.root)).toEqual(before);
});
it.for(['read', 'close'] as const)('joins a held native inventory %s and closes its descriptor after revocation', options, async (stage, test) => {
  const f = await fixture(test), before = await snapshot(f.root);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  const hold = async () => { enter(); await held; };
  if (stage === 'read')
    io.beforeRead = hold;
  else
    io.beforeClose = hold;
  let settled = false;
  const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('SYNTHETIC_INVENTORY_NOT_PENDING'); })]);
    expect(io.live.size).toBe(1);
    expect(io.handles[0]!.fd).toBeGreaterThanOrEqual(0);
    f.expire();
    await setImmediate();
    expect(settled).toBe(false);
  }
  finally {
    release();
    await result;
  }
  expect(await result).toMatchObject({ message: 'SYNTHETIC_LEASE_LOST' });
  expect(await snapshot(f.root)).toEqual(before);
  expect(f.mutationCount()).toBe(0);
});
it('retains the first read error and later close error without publishing a phase', options, async (test) => {
  const f = await fixture(test), before = await snapshot(f.root);
  const first = new Error('SYNTHETIC_INVENTORY_READ_FAILED'), close = new Error('SYNTHETIC_INVENTORY_CLOSE_FAILED');
  io.afterRead = async () => { throw first; };
  io.afterClose = async () => { throw close; };
  const advance = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance');
  const result = await f.run().catch(error => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toBe(first);
  expect(result.errors[1]).toBe(close);
  expect(await snapshot(f.root)).toEqual(before);
  expect(advance).not.toHaveBeenCalled();
  expect(f.mutationCount()).toBe(0);
});
it.for(['move', 'purge'].flatMap(stage => ['registryIdentity', 'writer'].map(kind => [stage, kind] as const)))('keeps the full guard before a physical mutation %s (%s)', options, async ([stage, kind], test) => {
  const f = await fixture(test);
  const fs = stage === 'move' ? f.quarantine : f.purge;
  const native = stage === 'move' ? workspaceDeletionQuarantineFileSystem : workspaceDeletionPurgeFileSystem;
  let attacked: Record<string, string> | undefined, count = -1;
  fs.entry.mockImplementationOnce(async (...args) => {
    const value = await native.entry(...args);
    if (kind === 'writer')
      f.addWriter();
    else {
      const bytes = await readFile(f.registryPath);
      await rename(f.registryPath, `${f.registryPath}.retained`);
      await writeFile(f.registryPath, bytes, { flag: 'wx', mode: 0o600 });
    }
    attacked = await snapshot(f.root);
    count = f.mutationCount();
    return value;
  });
  const result = await f.run().catch(error => error);
  if (kind === 'writer')
    expect(result).toBe(f.writerError);
  else
    expect(result).toMatchObject({ message: 'WORKSPACE_DELETE_JOURNAL_CONFLICT' });
  expect(attacked).toBeDefined();
  expect(f.mutationCount()).toBe(count);
  expect(await snapshot(f.root)).toEqual(attacked);
});
it('rejects a competing binding before the candidate rename and preserves all post-attack bytes', options, async (test) => {
  const f = await fixture(test, true);
  let attacked: Record<string, string> | undefined, count = -1;
  f.quarantine.entry.mockImplementation(async (...args) => {
    const result = await workspaceDeletionQuarantineFileSystem.entry(...args);
    if (attacked === undefined && args[0] === f.candidateRoot) {
      await f.publish({ ...remnantTestBinding('workspaceLegacyAdoption'), operationId: id(20) });
      attacked = await snapshot(f.root);
      count = f.mutationCount();
    }
    return result;
  });
  await expect(f.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(attacked).toBeDefined();
  expect(f.mutationCount()).toBe(count);
  expect(await snapshot(f.root)).toEqual(attacked);
});
it.for(['advance', 'recover'].flatMap(stage => ['payloadReappeared', 'registryIdentity'].map(kind => [stage, kind] as const)))('revalidates each journal callback before real %s slot mutation (%s)', options, async ([stage, kind], test) => {
  const f = await fixture(test);
  const advance = WorkspaceDeletionJournalStore.prototype.advance;
  const recover = WorkspaceDeletionJournalStore.prototype.recover;
  if (stage === 'recover') {
    const cut = new Error('SYNTHETIC_NEXT_TO_CURRENT_CUT');
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce(async (value, selection) => {
      const fs = createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
      return advance.call(new WorkspaceDeletionJournalStore(f.root, {
        prepareDirectory: fs.prepareDirectory.bind(fs), readSlot: fs.readSlot.bind(fs),
        createNextWriter: fs.createNextWriter.bind(fs), removeSlot: fs.removeSlot.bind(fs), syncDirectory: fs.syncDirectory.bind(fs),
        async moveSlot(source, destination, guard) {
          if (source === 'next' && destination === 'current')
            throw cut;
          await fs.moveSlot(source, destination, guard);
        },
      }), value, selection);
    });
    await expect(f.run()).rejects.toBe(cut);
    const slots = (await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertAuthority)).slots;
    expect(slots.backup).toBeDefined();
    expect(slots.next).toBeDefined();
    expect(slots.current).toBeUndefined();
  }
  let attacked: Record<string, string> | undefined;
  let inSlotMutation = false, recursiveReads = 0;
  const inspect = WorkspaceDeletionJournalStore.prototype.inspect;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'inspect').mockImplementation(function(this: WorkspaceDeletionJournalStore, ...args) {
    if (inSlotMutation) {
      recursiveReads++;
      throw new Error('SYNTHETIC_RECURSIVE_JOURNAL_READ');
    }
    return inspect.apply(this, args);
  });
  const attack = async () => {
    if (kind === 'payloadReappeared')
      await f.payload(f.workspace.workspaceRoot);
    else {
      const bytes = await readFile(f.registryPath);
      await rename(f.registryPath, `${f.registryPath}.retained`);
      await writeFile(f.registryPath, bytes, { flag: 'wx', mode: 0o600 });
    }
    attacked = await snapshot(f.root);
  };
  if (stage === 'advance')
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce(async function(this: WorkspaceDeletionJournalStore, value, selection, readSelection) {
      await selection.assertExternalSelection();
      await attack();
      inSlotMutation = true;
      try {
        return await advance.call(this, value, selection, readSelection);
      }
      finally {
        inSlotMutation = false;
      }
    });
  else
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'recover').mockImplementationOnce(async function(this: WorkspaceDeletionJournalStore, selection, readSelection) {
      await selection.assertExternalSelection();
      await attack();
      inSlotMutation = true;
      try {
        return await recover.call(this, selection, readSelection);
      }
      finally {
        inSlotMutation = false;
      }
    });
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(attacked).toBeDefined();
  expect(await snapshot(f.root)).toEqual(attacked);
  expect(recursiveReads).toBe(0);
});

it.for((['move', 'purge'] as const).flatMap(stage => ['registryIdentity', 'journalIdentity'].map(kind => [stage, kind] as const)))(
  'rejects a physical-loop post-close selection change (%s, %s)', options, async ([stage, kind], test) => {
  const f = await fixture(test), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const selectedPass = observePhysicalPass();
  const advance = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance');
  let selected = false, advances = -1, attacked: Record<string, string> | undefined;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: WorkspaceDeletionInventoryStore, ...args) {
    if (!selected && selectedPass.next(stage)) {
      selected = true;
      io.afterClose = async () => {
        const path = kind === 'registryIdentity' ? f.registryPath : f.journalPaths.currentPath;
        const bytes = await readFile(path);
        await rename(path, `${path}.retained`);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        advances = advance.mock.calls.length;
        attacked = await snapshot(f.root);
      };
    }
    return original.apply(this, args);
  });
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(selected).toBe(true);
  expect(attacked).toBeDefined();
  expect(f.quarantine.move).toHaveBeenCalledTimes(1);
  expect(f.purge.unlink).toHaveBeenCalledTimes(stage === 'purge' ? 1 : 0);
  expect(f.purge.rmdir).toHaveBeenCalledTimes(stage === 'purge' ? 1 : 0);
  expect(advance.mock.calls.length).toBe(advances);
  expect(await snapshot(f.root)).toEqual(attacked);
});

it.for(['move', 'purge'] as const)(
  'expires the physical-loop callback during the next live read (%s)', options, async (stage, test) => {
  const f = await fixture(test), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const selectedPass = observePhysicalPass();
  let attacks = 0;
  let saved: CapturedInventoryRead | undefined, savedRow!: Parameters<CapturedInventoryRead['consume']>[0];
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function(this: WorkspaceDeletionInventoryStore, value, authority, consume) {
    const selected = saved === undefined && selectedPass.next(stage);
    if (selected) saved = { authority, consume };
    else if (saved !== undefined && attacks === 0) {
      await authority.assertExternalSelection();
      const before = f.assertWritersAbsent.mock.calls.length, mutations = f.mutationCount();
      expect(() => saved!.authority.assertAuthority()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      await expect(saved.authority.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      await expect(saved.consume(savedRow)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(f.assertWritersAbsent.mock.calls.length).toBe(before);
      expect(f.mutationCount()).toBe(mutations);
      await authority.assertExternalSelection();
      attacks++;
      f.expire();
    }
    return original.call(this, value, authority, async row => {
      if (selected) savedRow = row;
      await consume(row);
    });
  });
  await expect(f.run()).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  expect(attacks).toBe(1);
  expect(f.quarantine.move).toHaveBeenCalledTimes(1);
  expect(f.purge.unlink).toHaveBeenCalledTimes(stage === 'purge' ? 1 : 0);
});

it.for((['move', 'purge'] as const).flatMap(stage => ['read', 'close'].map(boundary => [stage, boundary] as const)))(
  'joins held physical-loop IO after revocation (%s, %s)', options, async ([stage, boundary], test) => {
  const f = await fixture(test), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const selectedPass = observePhysicalPass();
  let enter!: () => void, release!: () => void, selected = false;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: WorkspaceDeletionInventoryStore, ...args) {
    if (!selected && selectedPass.next(stage)) {
      selected = true;
      const hold = async () => { enter(); await held; };
      if (boundary === 'read') io.beforeRead = hold;
      else io.beforeClose = hold;
    }
    return original.apply(this, args);
  });
  let settled = false, mutations = -1;
  const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  let before: Record<string, string> | undefined;
  try {
    await Promise.race([entered, result.then(() => { throw new Error('SYNTHETIC_PHYSICAL_READ_NOT_PENDING'); })]);
    expect(selected).toBe(true);
    expect(io.live.size).toBe(1);
    mutations = f.mutationCount(); before = await snapshot(f.root);
    f.expire();
    await setImmediate();
    expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toMatchObject({ message: 'SYNTHETIC_LEASE_LOST' });
  expect(await snapshot(f.root)).toEqual(before);
  expect(f.mutationCount()).toBe(mutations);
});

it.for(['move', 'purge'] as const)('rejects a writer inside the physical inventory read (%s)', options, async (stage, test) => {
  const f = await fixture(test), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const selectedPass = observePhysicalPass();
  let selected = false, mutations = -1, before: Record<string, string> | undefined;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: WorkspaceDeletionInventoryStore, ...args) {
    if (!selected && selectedPass.next(stage)) {
      selected = true;
      io.afterRead = async () => { mutations = f.mutationCount(); before = await snapshot(f.root); f.addWriter(); };
    }
    return original.apply(this, args);
  });
  await expect(f.run()).rejects.toBe(f.writerError);
  expect(selected).toBe(true);
  expect(before).toBeDefined();
  expect(f.mutationCount()).toBe(mutations);
  expect(await snapshot(f.root)).toEqual(before);
});

it.for(['move', 'purge'] as const)('retains the physical read error before its close error (%s)', options, async (stage, test) => {
  const f = await fixture(test), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const selectedPass = observePhysicalPass();
  const first = new Error('SYNTHETIC_PHYSICAL_READ_FAILED'), close = new Error('SYNTHETIC_PHYSICAL_CLOSE_FAILED');
  let saved: CapturedInventoryRead | undefined, before: Record<string, string> | undefined, mutations = -1;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: WorkspaceDeletionInventoryStore, value, authority, consume) {
    if (saved === undefined && selectedPass.next(stage)) {
      saved = { authority, consume };
      io.afterRead = async () => { before = await snapshot(f.root); mutations = f.mutationCount(); throw first; };
      io.afterClose = async () => { throw close; };
    }
    return original.call(this, value, authority, consume);
  });
  const result = await f.run().catch(error => error);
  expect(saved).toBeDefined();
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toBe(first);
  expect(result.errors[1]).toBe(close);
  expect(f.mutationCount()).toBe(mutations);
  expect(await snapshot(f.root)).toEqual(before);
  let replay: unknown;
  try { saved!.authority.assertAuthority(); } catch (error) { replay = error; }
  expect(replay).toBe(result);
  await expect(saved!.authority.assertExternalSelection()).rejects.toBe(result);
  await expect(saved!.consume(undefined as unknown as Parameters<CapturedInventoryRead['consume']>[0])).rejects.toBe(result);
  expect(f.mutationCount()).toBe(mutations);
});

it.for(['move', 'purge'] as const)('selects the actual native physical pass for guard controls (%s)', options, async (stage, test) => {
  const f = await fixture(test), selectedPass = observePhysicalPass();
  const original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let selected = false, inside = false, mutations = 0;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function(this: WorkspaceDeletionInventoryStore, ...args) {
    const current = !selected && selectedPass.next(stage);
    if (current) { selected = true; inside = true; }
    try { return await original.apply(this, args); }
    finally { if (current) inside = false; }
  });
  if (stage === 'move') f.quarantine.move.mockImplementation(async (...args) => {
    expect(inside).toBe(true); mutations++;
    await workspaceDeletionQuarantineFileSystem.move(...args);
  });
  else f.purge.unlink.mockImplementation(async (...args) => {
    expect(inside).toBe(true); mutations++;
    await workspaceDeletionPurgeFileSystem.unlink(...args);
  });
  expect((await f.run()).phase).toBe('purged');
  expect(selected).toBe(true);
  expect(mutations).toBe(1);
});
