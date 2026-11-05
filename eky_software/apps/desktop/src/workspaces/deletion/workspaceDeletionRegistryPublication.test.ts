import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi, type TestContext } from 'vitest';
import type { CrashSafeFileSlot } from '../persistence/crashSafeFileSlot.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME, createWorkspaceRegistryPaths } from '../registry/workspaceRegistryPaths.js';
import { createNodeWorkspaceRegistryFileSystem } from '../registry/workspaceRegistryFileSystem.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { readDeletionInventoryDirectoryIdentity as identity } from './workspaceDeletionInventoryFile.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, workspaceDeletionPhases, type WorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionRegistryPublisher } from './workspaceDeletionRegistryPublication.js';
import * as phaseSelection from './workspaceDeletionPhaseSelection.js';
import * as inventoryFile from './workspaceDeletionInventoryFile.js';

async function fixture(test: TestContext, phase: WorkspaceDeletionJournal['phase'] = 'purged',
  options: Readonly<{ activeTarget?: boolean; last?: boolean; preservePayload?: boolean }> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-registry-publication-'));
  await chmod(root, 0o700);
  let active = true;
  const pending: Promise<unknown>[] = [];
  const cleanup: (() => Promise<void>)[] = [];
  const assertCurrent = () => { test.signal.throwIfAborted(); if (!active) throw new Error('SYNTHETIC_OWNER_LOST'); };
  const authority = { assertCurrent, async assertOwned() { assertCurrent(); } };
  const assertWritersAbsent = async () => { assertCurrent(); };
  const external = { assertAuthority: assertCurrent, async assertExternalSelection() { assertCurrent(); } };
  test.onTestFinished(async () => {
    active = false; await Promise.allSettled(pending);
    const closed = await Promise.allSettled(cleanup.map(close => close()));
    vi.restoreAllMocks();
    const failures = closed.filter(value => value.status === 'rejected').map(value => value.reason);
    if (failures.length !== 0) throw new AggregateError(failures, 'SYNTHETIC_FIXTURE_CLOSE_FAILED');
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const base = createSwitchRegistry();
  const before = { ...base, formatVersion: 2 as const,
    activeWorkspaceId: options.activeTarget || options.last ? TEST_TARGET_WORKSPACE_ID : base.activeWorkspaceId,
    workspaces: options.last ? [base.workspaces[1]!] : base.workspaces };
  const after = removeWorkspaceEntry({ registry: before, targetWorkspaceId: TEST_TARGET_WORKSPACE_ID,
    expectedActiveWorkspaceId: before.activeWorkspaceId });
  await registry.write(before);
  const registryBytes = await readFile(registryPath);
  const target = before.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)!;
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const header = captureDeletionInventoryHeader({ ...deletionTestJournal().target, operationId: deletionTestId(200),
    workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity, registryEntrySha256: workspaceRegistryEntrySha256(target) });
  const workspace = deriveWorkspaceRoot(root, target.workspaceId, 1);
  await mkdir(workspace.workspaceRoot, { recursive: true, mode: 0o700 });
  const record = captureDeletionInventoryPayloadRecord({ role: 'workspace', ownerOperationId: null, generationId: null, member: null,
    bindingSha256: null, rootIdentity: await identity(workspace.workspaceRoot, assertCurrent),
    parentIdentity: await identity(workspace.workspacesRoot, assertCurrent) });
  const inventory = await new WorkspaceDeletionInventoryStore(root, header.operationId).publish(header,
    (async function* () { yield record; })(), external);
  // State fixture only: the physical executor's separate tests must prove these phase preconditions.
  if (!options.preservePayload) await rmdir(workspace.workspaceRoot);
  const journal = captureWorkspaceDeletionJournal({ ...deletionTestJournal(), ...inventory,
    previousActiveWorkspaceId: before.activeWorkspaceId, registryBeforeSha256: hash(registryBytes),
    registryAfterSha256: hash(serializeWorkspaceRegistry(after)) });
  const store = new WorkspaceDeletionJournalStore(root);
  await store.publish(journal, { ...external, slots: (await store.inspect(assertCurrent)).slots });
  for (const next of workspaceDeletionPhases.slice(1, workspaceDeletionPhases.indexOf(phase) + 1)) {
    await store.advance({ ...journal, phase: next }, { ...external, slots: (await store.inspect(assertCurrent)).slots });
  }
  const journalPaths = createWorkspaceDeletionJournalPaths(root), journalBytes = await readFile(journalPaths.currentPath);
  const inventoryPaths = createWorkspaceDeletionInventoryPaths(root, header.operationId), inventoryBytes = await readFile(inventoryPaths.currentPath);
  const write = registry.writeSelected.bind(registry), recover = registry.recoverSelected.bind(registry);
  const writeSelected = vi.fn(write), recoverSelected = vi.fn(recover);
  const command = createWorkspaceDeletionRegistryPublisher({ userDataRoot: root,
    registry: { inspectSlots: registry.inspectSlots.bind(registry), writeSelected, recoverSelected }, assertWritersAbsent });
  return { root, registry, registryPath, registryBytes, before, after, header, workspace, journalPaths, journalBytes,
    inventoryPaths, inventoryBytes, authority, write, recover, writeSelected, recoverSelected,
    cleanup,
    track<T>(task: Promise<T>) { pending.push(task); return task; },
    run() { const result = command(header.operationId, authority); pending.push(result); return result; },
    runWith<T>(selectedCommand: (operationId: string, owner: typeof authority) => Promise<T>) {
      const result = selectedCommand(header.operationId, authority); pending.push(result); return result;
    },
    revoke() { active = false; },
    async preservedEvidence(expectedJournalBytes: Uint8Array = journalBytes) {
      expect(await readFile(journalPaths.currentPath)).toEqual(expectedJournalBytes);
      expect(await readFile(inventoryPaths.currentPath)).toEqual(inventoryBytes);
    },
  };
}

function interceptedRegistry(f: Awaited<ReturnType<typeof fixture>>, hooks: Readonly<{
  beforeMove?(source: CrashSafeFileSlot, destination: CrashSafeFileSlot): Promise<void>;
  afterMove?(source: CrashSafeFileSlot, destination: CrashSafeFileSlot): Promise<void>;
  beforeRemove?(slot: CrashSafeFileSlot): Promise<void>;
}>) {
  const fs = createNodeWorkspaceRegistryFileSystem(createWorkspaceRegistryPaths(f.root, f.registryPath));
  return new WorkspaceRegistryStore({ installationRoot: f.root, filePath: f.registryPath, fileSystem: {
    prepareDirectory: fs.prepareDirectory.bind(fs), readSlot: fs.readSlot.bind(fs),
    createNextWriter: fs.createNextWriter.bind(fs), syncDirectory: fs.syncDirectory.bind(fs),
    async moveSlot(source, destination, guard) {
      await hooks.beforeMove?.(source, destination);
      await fs.moveSlot(source, destination, guard);
      await hooks.afterMove?.(source, destination);
    },
    async removeSlot(slot, guard) { await hooks.beforeRemove?.(slot); return fs.removeSlot(slot, guard); },
  } });
}

it('publishes only the exact after-registry and retains purged journal plus inventory for owner cleanup', async test => {
  const f = await fixture(test);
  const result = await f.run();
  expect(result.registryState).toBe('after');
  expect(result.journal.phase).toBe('purged');
  expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
  expect((await f.registry.inspectSlots()).backup).toBeUndefined();
  expect((await f.registry.inspectSlots()).next).toBeUndefined();
  expect(f.writeSelected).toHaveBeenCalledTimes(1);
  expect(f.recoverSelected).not.toHaveBeenCalled();
  await f.preservedEvidence();
  expect((await f.run()).registryState).toBe('after');
  expect(f.writeSelected).toHaveBeenCalledTimes(1);
  await f.preservedEvidence();
});

it('does not duplicate publication after its actual acknowledgement was lost', async test => {
  const f = await fixture(test), failure = new Error('SYNTHETIC_REGISTRY_ACK_LOST');
  f.writeSelected.mockImplementationOnce(async (...args) => { await f.write(...args); throw failure; });
  await expect(f.run()).rejects.toBe(failure);
  expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
  await f.preservedEvidence();
  expect((await f.run()).registryState).toBe('after');
  expect(f.writeSelected).toHaveBeenCalledTimes(1);
});

it.for(['inventory', 'source'] as const)('preserves the original %s cause when the registry store generalizes a guard failure', async (change, test) => {
  const f = await fixture(test);
  f.writeSelected.mockImplementationOnce(async (...args) => {
    if (change === 'inventory') await writeFile(f.inventoryPaths.currentPath, 'invalid-inventory');
    else { await mkdir(f.workspace.workspaceRoot, { mode: 0o700 }); await writeFile(join(f.workspace.workspaceRoot, 'retained'), 'unexpected-source'); }
    return f.write(...args);
  });
  await expect(f.run()).rejects.toThrow(change === 'inventory' ? 'WORKSPACE_DELETE_INVENTORY_INVALID' : 'WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  if (change === 'source') expect(await readFile(join(f.workspace.workspaceRoot, 'retained'), 'utf8')).toBe('unexpected-source');
  else expect(await readFile(f.inventoryPaths.currentPath, 'utf8')).toBe('invalid-inventory');
});

it.for(['beforeBackup', 'beforePublication', 'afterPublication', 'backupRemoval'] as const)(
  'recovers the exact real registry slots after %s without promoting an unpublished next', async (boundary, test) => {
    const f = await fixture(test), first = new Error('SYNTHETIC_REGISTRY_IO_FAILED');
    const faulty = interceptedRegistry(f, {
      async beforeMove(source, destination) {
        if ((boundary === 'beforeBackup' && source === 'current' && destination === 'backup') ||
            (boundary === 'beforePublication' && source === 'next' && destination === 'current')) throw first;
      },
      async afterMove(source, destination) {
        if (boundary === 'afterPublication' && source === 'next' && destination === 'current') throw first;
      },
      async beforeRemove(slot) { if (boundary === 'backupRemoval' && slot === 'backup') throw first; },
    });
    f.writeSelected.mockImplementationOnce((...args) => faulty.writeSelected(...args));
    await expect(f.run()).rejects.toBe(first);
    const interrupted = await f.registry.inspectSlots();
    const afterPublished = boundary === 'afterPublication' || boundary === 'backupRemoval';
    if (afterPublished) expect(Buffer.from(interrupted.current!.bytes)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
    else expect(Buffer.from((interrupted.current ?? interrupted.backup)!.bytes)).toEqual(f.registryBytes);
    await f.preservedEvidence();
    const result = await f.run();
    expect(result.registryState).toBe('after');
    expect(f.writeSelected).toHaveBeenCalledTimes(afterPublished ? 1 : 2);
    expect(f.recoverSelected).toHaveBeenCalledTimes(1);
    const final = await f.registry.inspectSlots();
    expect(final.next).toBeUndefined(); expect(final.backup).toBeUndefined();
    expect(Buffer.from(final.current!.bytes)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
    await f.preservedEvidence();
  },
);

it.for(['sourceBeforePublication', 'ownerBeforePublication', 'journalBeforeBackupRemoval'] as const)(
  'rechecks original external authority at the late registry boundary: %s', async (change, test) => {
    const f = await fixture(test);
    let changed = false;
    const faulty = interceptedRegistry(f, {
      async beforeMove(source, destination) {
        if (source !== 'next' || destination !== 'current' || change === 'journalBeforeBackupRemoval') return;
        changed = true;
        if (change === 'sourceBeforePublication') {
          await mkdir(f.workspace.workspaceRoot, { mode: 0o700 });
          await writeFile(join(f.workspace.workspaceRoot, 'retained'), 'late-source-bytes', { mode: 0o600 });
        } else f.revoke();
      },
      async beforeRemove(slot) {
        if (slot !== 'backup' || change !== 'journalBeforeBackupRemoval') return;
        changed = true;
        await rename(f.journalPaths.currentPath, join(f.root, 'preserved-original-journal'));
        await writeFile(f.journalPaths.currentPath, f.journalBytes, { mode: 0o600, flag: 'wx' });
      },
    });
    f.writeSelected.mockImplementationOnce((...args) => faulty.writeSelected(...args));
    await expect(f.run()).rejects.toThrow(change === 'ownerBeforePublication' ? 'SYNTHETIC_OWNER_LOST' : 'WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(changed).toBe(true);
    const retained = await f.registry.inspectSlots();
    expect(retained.backup).toBeDefined();
    expect(Buffer.from(retained.backup!.bytes)).toEqual(f.registryBytes);
    if (change === 'journalBeforeBackupRemoval') {
      expect(Buffer.from(retained.current!.bytes)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
      expect(await readFile(join(f.root, 'preserved-original-journal'))).toEqual(f.journalBytes);
    } else {
      expect(retained.current).toBeUndefined(); expect(retained.next).toBeDefined();
      expect(Buffer.from(retained.backup!.bytes)).toEqual(f.registryBytes);
    }
    if (change === 'sourceBeforePublication') {
      expect(await readFile(join(f.workspace.workspaceRoot, 'retained'), 'utf8')).toBe('late-source-bytes');
    }
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  },
);

it.for([false, true])('clears active selection without creating a default company (last: %s)', async (last, test) => {
  const f = await fixture(test, 'purged', { activeTarget: true, last });
  const result = await f.run();
  expect(result.registryState).toBe('after');
  const actual = (await f.registry.inspectSlots()).current!.value;
  expect(actual.formatVersion).toBe(2);
  expect(actual.activeWorkspaceId).toBeNull();
  expect(actual.workspaces).toEqual(last ? [] : [f.before.workspaces[0]]);
  expect(result.journal.phase).toBe('purged');
  await f.preservedEvidence();
});

it('joins an in-flight registry write after revocation and rejects concurrent publication', async test => {
  const f = await fixture(test);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const held = interceptedRegistry(f, { async beforeMove(source, destination) {
    if (source === 'next' && destination === 'current') { entered(); await pending; }
  } });
  f.writeSelected.mockImplementationOnce((...args) => held.writeSelected(...args));
  let settled = false;
  const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_WRITE_NOT_PENDING'); })]);
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    f.revoke();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toMatchObject({ message: 'SYNTHETIC_OWNER_LOST' });
  const retained = await f.registry.inspectSlots();
  expect(retained.current).toBeUndefined(); expect(retained.next).toBeDefined();
  expect(Buffer.from(retained.backup!.bytes)).toEqual(f.registryBytes);
  await f.preservedEvidence();
});

afterEach(() => vi.restoreAllMocks());

it.for(['rename', 'purge', 'journal'] as const)('cold payload rejects full selection loss before native %s', async (boundary, test) => {
  const f = await fixture(test, 'authorized', { preservePayload: true }), first = new Error('SYNTHETIC_FULL_PAYLOAD_SELECTION_LOST');
  const { createWorkspaceDeletionPayloadExecutor } = await import('./workspaceDeletionPayloadExecutor.js');
  const { workspaceDeletionQuarantineFileSystem: physical } = await import('./workspaceDeletionQuarantine.js');
  const { workspaceDeletionPurgeFileSystem: purgeSystem } = await import('./workspaceDeletionPurge.js');
  const { maximumWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal } = await import('./workspaceDeletionJournalCodec.js');
  const { createNodeCrashSafeFileSlotFileSystem } = await import('../persistence/crashSafeFileSlot.js');
  const fullProof = vi.fn(async () => { f.authority.assertCurrent(); });
  let injected = false;
  const inject = () => { if (!injected) { injected = true; fullProof.mockRejectedValueOnce(first); } };
  const quarantine = { ...physical, move: vi.fn(physical.move), async entry(...args: Parameters<typeof physical.entry>) {
    const value = await physical.entry(...args); if (boundary === 'rename') inject(); return value;
  } };
  const purge = { ...purgeSystem, unlink: vi.fn(purgeSystem.unlink), rmdir: vi.fn(purgeSystem.rmdir), async readEntry(...args: Parameters<typeof purgeSystem.readEntry>) {
    const value = await purgeSystem.readEntry(...args); if (boundary === 'purge') inject(); return value;
  } };
  const bytes = Buffer.from('synthetic-payload-before-purge');
  await writeFile(join(f.workspace.workspaceRoot, 'retained'), bytes, { flag: 'wx', mode: 0o600 });
  const foreign = join(f.root, 'unowned-user-backup'); await writeFile(foreign, 'preserved-foreign-bytes', { flag: 'wx', mode: 0o600 });
  const advance = WorkspaceDeletionJournalStore.prototype.advance;
  if (boundary === 'journal') vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce(async function (value, selection, options) {
    const fs = createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes), move = fs.moveSlot.bind(fs);
    fs.moveSlot = async (source, destination, guard) => {
      if (source === 'next' && destination === 'current') inject(); return move(source, destination, guard);
    };
    return advance.call(new WorkspaceDeletionJournalStore(f.root, fs), value, selection, options);
  });
  const command = createWorkspaceDeletionPayloadExecutor({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() { f.authority.assertCurrent(); }, assertStableSelection: fullProof }, { quarantine, purge });
  await expect(f.runWith(command)).rejects.toBe(first); expect(injected).toBe(true);
  expect(purge.unlink).not.toHaveBeenCalled(); expect(purge.rmdir).not.toHaveBeenCalled();
  expect(quarantine.move).toHaveBeenCalledTimes(boundary === 'rename' ? 0 : 1);
  const current = await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent);
  if (boundary === 'rename') {
    expect(current.plan).toMatchObject({ mode: 'published', selected: { phase: 'authorized' } });
    expect(await readFile(join(f.workspace.workspaceRoot, 'retained'))).toEqual(bytes);
  } else {
    const source = quarantine.move.mock.calls[0]![1]; expect(await readFile(join(source, 'retained'))).toEqual(bytes);
    if (boundary === 'purge') expect(current.plan).toMatchObject({ mode: 'published', selected: { phase: 'purgeAuthorized' } });
    else {
      expect(current.slots.current).toBeUndefined(); expect(current.slots.next).toBeDefined(); expect(current.slots.backup).toBeDefined();
      expect(Buffer.from(current.slots.backup!.bytes)).toEqual(f.journalBytes);
      expect(Buffer.from(current.slots.next!.bytes)).toEqual(serializeWorkspaceDeletionJournal({
        ...JSON.parse(f.journalBytes.toString('utf8')), phase: 'quarantined' }));
    }
  }
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  expect(await readFile(foreign, 'utf8')).toBe('preserved-foreign-bytes');
});

it.for([false, true].flatMap(withFull => ['promise', 'value'].map(mode => [withFull, mode] as const)))(
  'cold payload rejects malformed synchronous authority (S: %s, return: %s)', async ([withFull, mode], test) => {
    const f = await fixture(test, 'authorized', { preservePayload: true });
    const { createWorkspaceDeletionPayloadExecutor } = await import('./workspaceDeletionPayloadExecutor.js');
    const { workspaceDeletionQuarantineFileSystem: physical } = await import('./workspaceDeletionQuarantine.js');
    const current = f.authority.assertCurrent.bind(f.authority), fullProof = vi.fn(async () => { current(); });
    const quarantine = { ...physical, move: vi.fn(physical.move) };
    f.authority.assertCurrent = (() => { current(); return mode === 'promise' ? Promise.resolve() : true; }) as never;
    const command = createWorkspaceDeletionPayloadExecutor({ userDataRoot: f.root, registry: f.registry,
      async assertWritersAbsent() { current(); }, ...(withFull ? { assertStableSelection: fullProof } : {}) }, { quarantine });
    await expect(f.runWith(command)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(quarantine.move).not.toHaveBeenCalled(); expect(fullProof).not.toHaveBeenCalled();
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
    expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  },
);


it.for(['persistent', 'restored'] as const)(
  'cold read group payload readRecords models %s external selection within read group', async (mode, test) => {
    const f = await fixture(test, 'authorized', { preservePayload: true });
    const { createWorkspaceDeletionPayloadExecutor } = await import('./workspaceDeletionPayloadExecutor.js');
    const { workspaceDeletionQuarantineFileSystem: physical } = await import('./workspaceDeletionQuarantine.js');
    const first = new Error('SYNTHETIC_PAYLOAD_GROUP_CHANGED'), stopped = new Error('SYNTHETIC_PAYLOAD_GROUP_CONTROL_COMPLETE');
    let changed = false, externalChanged = false, rawSawChange = false, successfulBookends = 0;
    const fullProof = vi.fn(async () => {
      f.authority.assertCurrent(); if (externalChanged) throw first;
      if (changed && ++successfulBookends === 2) throw stopped;
    });
    const read = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementationOnce(async function (this: WorkspaceDeletionInventoryStore, value, scope, consume) {
      return read.call(this, value, scope, async row => {
        changed = true; externalChanged = true; const before = fullProof.mock.calls.length;
        await scope.assertExternalSelection(); rawSawChange = true; await consume(row);
        expect(fullProof.mock.calls.length).toBe(before);
        if (mode === 'restored') externalChanged = false;
      });
    });
    const move = vi.fn(physical.move);
    const bytes = Buffer.from('synthetic retained payload group bytes'); await writeFile(join(f.workspace.workspaceRoot, 'retained'), bytes);
    const command = createWorkspaceDeletionPayloadExecutor({ userDataRoot: f.root, registry: f.registry,
      async assertWritersAbsent() { f.authority.assertCurrent(); }, assertStableSelection: fullProof }, { quarantine: { ...physical, move } });
    await expect(f.runWith(command)).rejects.toBe(mode === 'persistent' ? first : stopped);
    expect(changed).toBe(true); expect(rawSawChange).toBe(true); expect(successfulBookends).toBe(mode === 'persistent' ? 0 : 2);
    expect(move).not.toHaveBeenCalled(); expect(await readFile(join(f.workspace.workspaceRoot, 'retained'))).toEqual(bytes);
    expect(await readFile(f.registryPath)).toEqual(f.registryBytes); await f.preservedEvidence();
  },
);

import * as realColdOwner from '../../main/workspaceDeletionContinuation.js';
import * as realDeleteCommand from './workspaceDeletionCommand.js';
import { recoverDesktopWorkspaceDeletion as realMainRecovery } from '../../main/recoverDesktopWorkspaceDeletion.js';
import { acquireWorkspaceProcessReservation as acquireNativeReservation } from '../../runtime/workspaceProcessReservation.js';
import { InMemoryWorkspaceMaintenanceLease as NativeMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { createDesktopProfilePaths as nativeProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths as nativeUpdatePaths } from '../../update/localUpdateRuntimePaths.js';
import { createWorkspaceCreationJournalPaths as nativeCreationPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME as creationName } from '../creation/workspaceCreationJournalPaths.js';
import { dirname as nativeDirname } from 'node:path';

function coldMainGate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function containsColdMainCause(value: unknown, expected: unknown): boolean {
  const seen = new Set<unknown>(), pending = [value];
  while (pending.length !== 0 && seen.size < 64) {
    const current = pending.pop(); if (current === expected) return true;
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    seen.add(current); if ('cause' in current) pending.push(current.cause);
    if ('errors' in current && Array.isArray(current.errors)) pending.push(...current.errors);
  }
  return false;
}
async function originalColdMainProof(f: Awaited<ReturnType<typeof fixture>>, time: string) {
  const { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } = await import('./workspaceRemnantBindingCodec.js');
  const { WorkspaceRemnantBindingStore } = await import('./workspaceRemnantBindingStore.js');
  const { createWorkspaceRemnantBindingPaths } = await import('./workspaceRemnantBindingPaths.js');
  const { WorkspaceBackupImportJournalStore } = await import('../import/workspaceBackupImportJournalStore.js');
  const { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } = await import('../import/workspaceBackupImportJournalPaths.js');
  const { captureWorkspaceDeletionOriginalJournals } = await import('./workspaceDeletionOriginalJournalSelection.js');
  const { serializeWorkspaceDeletionJournal } = await import('./workspaceDeletionJournalCodec.js');
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport', operationId: deletionTestId(301),
    workspaceId: f.header.workspaceId, lineageIdentity: f.header.lineageIdentity });
  const authority = { assertAuthority: f.authority.assertCurrent, assertExternalSelection: f.authority.assertOwned,
    assertWritersAbsent: f.authority.assertOwned };
  await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
  const importPath = join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
  await new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: importPath }).write({
    formatVersion: 2, operationId: binding.operationId, workspaceId: binding.workspaceId, workspaceLabel: 'Synthetic original proof',
    createdAt: time, previousActiveWorkspaceId: f.before.activeWorkspaceId, state: 'prepared', lineageIdentity: null });
  const importBytes = await readFile(importPath);
  const original = await captureWorkspaceDeletionOriginalJournals(f.root, f.header, authority);
  let journalBytes: Buffer;
  try { journalBytes = serializeWorkspaceDeletionJournal({ ...JSON.parse(f.journalBytes.toString('utf8')),
    formatVersion: 2, originalJournalProofs: original.proofs }); }
  finally { original.revoke(); }
  await writeFile(f.journalPaths.currentPath, journalBytes);
  const bindingPath = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)).currentPath;
  return { journalBytes, bindingPath, importPath, importBytes };
}

it.for(['build', 'foreign', 'heldBuild', 'original'] as const)(
  'cold main actual service owner and native selection reject %s before mutation', async (variant, test) => {
    const f = await fixture(test), time = '2026-10-25T12:00:00.000Z';
    const accepted = { formatVersion: 1, acceptedAt: time, appVersion: '0.2.81', buildRevision: 'a'.repeat(40), releaseChannel: 'pilot' };
    const buildInfo = { schemaVersion: 1 as const, appVersion: accepted.appVersion, buildRevision: accepted.buildRevision, buildCreatedAt: time, buildDirty: false };
    const releaseInfo = { schemaVersion: 1 as const, appIdentity: 'Eky' as const, appVersion: accepted.appVersion,
      msiProductVersion: accepted.appVersion, buildRevision: accepted.buildRevision, platform: 'win32' as const,
      architecture: 'x64' as const, releaseChannel: 'pilot' as const, upgradeCode: deletionTestId(50) };
    const update = nativeUpdatePaths({ userDataPath: f.root, legacyRuntimeRoot: nativeProfilePaths(f.root).runtimeRoot });
    await mkdir(nativeDirname(update.acceptedBuildMetadataPath), { recursive: true });
    await writeFile(update.acceptedBuildMetadataPath, JSON.stringify(accepted));
    const original = variant === 'original' ? await originalColdMainProof(f, time) : undefined;
    const physical = await acquireNativeReservation({ userDataRoot: f.root, signal: test.signal });
    const rawEntered = coldMainGate(), rawRelease = coldMainGate(), closeEntered = coldMainGate();
    f.cleanup.push(async () => { rawRelease.resolve(); await physical.release(); });
    test.onTestFinished(() => rawRelease.resolve());
    const lease = new NativeMaintenanceLease(), work: { pending: boolean; uncertainty?: { reason: unknown } } = { pending: false };
    const events: string[] = [], record = vi.fn(); let current = true, holdRaw = false, fullCount = 0;
    let first: unknown, pair: { assertReservationOwned(): Promise<void>; assertStableSelection(): Promise<void> } | undefined;
    let rawResult: Promise<unknown> | undefined, changedPath = '', changedBytes = Buffer.alloc(0);
    const assertMainCurrent = () => { test.signal.throwIfAborted(); physical.invalidated.throwIfAborted(); if (!current) throw new Error('SYNTHETIC_MAIN_INVALIDATED'); };
    const reservation = { assertMainCurrent, async assertMainOwned() {
      assertMainCurrent();
      if (holdRaw) { holdRaw = false; rawEntered.resolve(); await rawRelease.promise; }
      await physical.assertOwned(); assertMainCurrent();
    }, invalidate() { events.push('invalidate'); current = false; } };
    const createOwner = realColdOwner.createWorkspaceDeletionColdContinuation;
    vi.spyOn(realColdOwner, 'createWorkspaceDeletionColdContinuation').mockImplementation(input => {
      const actual = createOwner(input);
      return { ...actual, owner: { ...actual.owner, async assertOwned() {
        fullCount++;
        try { await actual.owner.assertOwned(); } catch (cause) { first ??= cause; throw cause; }
      }, async close() {
        events.push('closeStarted'); closeEntered.resolve();
        try { await actual.owner.close(); events.push('closeCompleted'); }
        catch (cause) { events.push('closeFailed'); throw cause; }
      } } };
    });
    const createCommand = realDeleteCommand.createWorkspaceDeletionCommand;
    vi.spyOn(realDeleteCommand, 'createWorkspaceDeletionCommand').mockImplementation(input => {
      const actual = createCommand(input); pair = input.coldSelection;
      return { ...actual, async resumeSelected(...args) {
        expect(lease.readState()).toBe('busy'); expect(work.pending).toBe(true); expect(pair).toBeDefined();
        const before = fullCount;
        await pair!.assertReservationOwned(); await pair!.assertReservationOwned();
        expect(fullCount).toBe(before);
        if (variant === 'original') {
          changedPath = original!.bindingPath; changedBytes = Buffer.from('synthetic changed original binding');
        } else if (variant === 'foreign') {
          changedPath = nativeCreationPaths(f.root, join(f.root, creationName)).currentPath;
          changedBytes = Buffer.from('synthetic foreign journal must be retained');
        } else {
          changedPath = update.acceptedBuildMetadataPath;
          changedBytes = Buffer.from(JSON.stringify({ ...accepted, buildRevision: 'b'.repeat(40) }));
        }
        await writeFile(changedPath, changedBytes);
        if (variant === 'heldBuild') {
          holdRaw = true; rawResult = pair!.assertReservationOwned().catch(cause => cause); f.track(rawResult);
          await rawEntered.promise;
        }
        // Delegate the real command: its full content guard must find the changed bytes.
        return actual.resumeSelected(...args);
      } };
    });
    const task = f.track(realMainRecovery({ userDataRoot: f.root, buildInfo, releaseInfo, maintenanceLease: lease,
      reservation, work, assertStartupCurrent: assertMainCurrent, observer: { record } }).catch(cause => cause));
    if (variant === 'heldBuild') {
      await closeEntered.promise;
      expect(work.pending).toBe(true); expect(lease.readState()).toBe('busy');
      expect(events).toEqual(['closeStarted']); expect(first).toBeDefined();
      rawRelease.resolve();
    }
    const failure = await task;
    expect(first).toBeInstanceOf(Error); expect(containsColdMainCause(failure, first)).toBe(true);
    expect(work.pending).toBe(false); expect(fullCount).toBeGreaterThan(1);
    expect(await readFile(changedPath)).toEqual(changedBytes);
    expect(await readFile(f.registryPath)).toEqual(f.registryBytes); await f.preservedEvidence(original?.journalBytes);
    if (original !== undefined) expect(await readFile(original.importPath)).toEqual(original.importBytes);
    await expect(pair!.assertStableSelection()).rejects.toBeDefined();
    await expect(pair!.assertReservationOwned()).rejects.toBeDefined();
    if (variant === 'heldBuild') {
      expect(await rawResult).toBe(first); expect(events).toEqual(['closeStarted', 'closeFailed', 'invalidate']);
      expect(work.uncertainty).toBeDefined(); expect(lease.readState()).toBe('busy');
    } else {
      expect(events).toEqual(['closeStarted', 'closeCompleted']); expect(work.uncertainty).toBeUndefined();
      expect(lease.readState()).toBe('idle'); await physical.assertOwned();
    }
    expect(record).toHaveBeenCalled();
  },
);

it.for(['content', 'identity'] as const)('cold registry rejects late external %s before publication', async (change, test) => {
  const f = await fixture(test), { lstat } = await import('node:fs/promises');
  const marker = join(f.root, 'synthetic-external-selection'), bytes = Buffer.from('synthetic-accepted');
  await writeFile(marker, bytes, { flag: 'wx', mode: 0o600 }); const expected = await lstat(marker, { bigint: true });
  const first = new Error('SYNTHETIC_STABLE_SELECTION_CHANGED'); let changed = false;
  const faulty = interceptedRegistry(f, { async beforeMove(source, destination) {
    if (source !== 'next' || destination !== 'current') return;
    changed = true;
    if (change === 'content') await writeFile(marker, 'synthetic-modified');
    else { await rename(marker, join(f.root, 'retained-external-selection')); await writeFile(marker, bytes, { flag: 'wx', mode: 0o600 }); }
  } });
  f.writeSelected.mockImplementationOnce((...args) => faulty.writeSelected(...args));
  const command = createWorkspaceDeletionRegistryPublisher({ userDataRoot: f.root,
    registry: { inspectSlots: f.registry.inspectSlots.bind(f.registry), writeSelected: f.writeSelected, recoverSelected: f.recoverSelected },
    async assertWritersAbsent() { f.authority.assertCurrent(); }, async assertStableSelection() {
      f.authority.assertCurrent(); const current = await lstat(marker, { bigint: true });
      if (!Buffer.from(await readFile(marker)).equals(bytes) || current.dev !== expected.dev || current.ino !== expected.ino ||
          current.size !== expected.size || current.mtimeNs !== expected.mtimeNs || current.ctimeNs !== expected.ctimeNs) throw first;
      f.authority.assertCurrent();
    } });
  await expect(f.runWith(command)).rejects.toBe(first); expect(changed).toBe(true);
  const slots = await f.registry.inspectSlots();
  expect(slots.current).toBeUndefined(); expect(slots.next).toBeDefined(); expect(slots.backup).toBeDefined();
  expect(Buffer.from(slots.backup!.bytes)).toEqual(f.registryBytes);
  if (change === 'identity') expect(await readFile(join(f.root, 'retained-external-selection'))).toEqual(bytes);
  else expect(await readFile(marker, 'utf8')).toBe('synthetic-modified');
  await f.preservedEvidence();
});

it.for(['persistent', 'restored'] as const)('cold registry models %s external state during one read group', async (mode, test) => {
  const f = await fixture(test), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let externalChanged = false, changed = false, rawSawChanged = false;
  const first = new Error('SYNTHETIC_STABLE_GROUP_CHANGED');
  f.authority.assertOwned = async () => { f.authority.assertCurrent(); if (externalChanged) rawSawChanged = true; };
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, value, scope, consume) {
    return original.call(this, value, scope, async row => {
      if (changed) return consume(row);
      changed = true; externalChanged = true;
      await scope.assertExternalSelection(); await consume(row);
      if (mode === 'restored') externalChanged = false;
    });
  });
  const command = createWorkspaceDeletionRegistryPublisher({ userDataRoot: f.root,
    registry: { inspectSlots: f.registry.inspectSlots.bind(f.registry), writeSelected: f.writeSelected, recoverSelected: f.recoverSelected },
    async assertWritersAbsent() { f.authority.assertCurrent(); },
    async assertStableSelection() { f.authority.assertCurrent(); if (externalChanged) throw first; } });
  if (mode === 'persistent') {
    await expect(f.runWith(command)).rejects.toBe(first); expect(f.writeSelected).not.toHaveBeenCalled();
    expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  } else {
    expect((await f.runWith(command)).registryState).toBe('after'); expect(f.writeSelected).toHaveBeenCalledOnce();
    expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
  }
  expect(changed).toBe(true); expect(rawSawChanged).toBe(true); await f.preservedEvidence();
});

it('keeps full row and mutation guards outside internal inventory journal reads', async test => {
  const f = await fixture(test), capture = phaseSelection.captureWorkspaceDeletionPhaseSelection;
  const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let inRead = false, inRow = false, internalFull = 0, fullRow = 0, readOwned = 0, rounds = 0;
  vi.spyOn(phaseSelection, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async input => {
    const phase = await capture(input);
    return { ...phase, async assertJournalSelected() {
      if (inRow) fullRow++; else if (inRead) internalFull++;
      await phase.assertJournalSelected();
    }, async assertJournalReadOwned() { readOwned++; await phase.assertJournalReadOwned(); } };
  });
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (
    this: WorkspaceDeletionInventoryStore, value, owner, row, onFailure,
  ) {
    rounds++; inRead = true;
    try { await consume.call(this, value, owner, async record => {
      inRow = true; try { await row(record); } finally { inRow = false; }
    }, onFailure); } finally { inRead = false; }
  });
  await f.run();
  expect(rounds).toBeGreaterThan(1);
  expect(fullRow).toBe(rounds);
  expect(internalFull).toBe(0);
  expect(readOwned).toBeGreaterThan(rounds);
  expect(f.writeSelected).toHaveBeenCalledTimes(1);
  expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
  await f.preservedEvidence();
});

it.for(['bytes', 'identity', 'side', 'payload', 'inventory'] as const)(
  'blocks persistent changes within an actual registry mutation read: %s', async (change, test) => {
    const f = await fixture(test), consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
    let mutating = false, changed = false;
    f.writeSelected.mockImplementationOnce(async (...args) => { mutating = true; return f.write(...args); });
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (
      this: WorkspaceDeletionInventoryStore, value, owner, row, onFailure,
    ) {
      const external = async () => {
        if (mutating && !changed) {
          changed = true;
          if (change === 'bytes') await writeFile(f.journalPaths.currentPath, 'corrupt');
          if (change === 'identity') {
            await rename(f.journalPaths.currentPath, join(f.root, 'retained-journal'));
            await writeFile(f.journalPaths.currentPath, f.journalBytes, { flag: 'wx', mode: 0o600 });
          }
          if (change === 'side') await writeFile(f.journalPaths.nextPath, f.journalBytes, { flag: 'wx', mode: 0o600 });
          if (change === 'inventory') await writeFile(f.inventoryPaths.currentPath, 'corrupt');
          if (change === 'payload') {
            await mkdir(f.workspace.workspaceRoot, { mode: 0o700 });
            await writeFile(join(f.workspace.workspaceRoot, 'retained'), 'retained-payload');
          }
        }
        await owner.assertExternalSelection();
      };
      return consume.call(this, value, { ...owner, assertExternalSelection: external }, row, onFailure);
    });
    await expect(f.run()).rejects.toBeDefined();
    expect(changed).toBe(true);
    expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(change === 'inventory' ? Buffer.from('corrupt') : f.inventoryBytes);
    if (change === 'identity') expect(await readFile(join(f.root, 'retained-journal'))).toEqual(f.journalBytes);
    if (change === 'payload') expect(await readFile(join(f.workspace.workspaceRoot, 'retained'), 'utf8')).toBe('retained-payload');
  },
);

it.for([false, true])('retains the approved transient journal observation window inside mutation: %s', async (duringMutation, test) => {
  const f = await fixture(test), consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let mutating = false, changed = false;
  f.writeSelected.mockImplementationOnce(async (...args) => { mutating = true; return f.write(...args); });
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (
    this: WorkspaceDeletionInventoryStore, value, owner, row, onFailure,
  ) {
    const external = async () => {
      if (!changed && mutating === duringMutation) {
        changed = true;
        await writeFile(f.journalPaths.nextPath, f.journalBytes, { flag: 'wx', mode: 0o600 });
        try { await owner.assertExternalSelection(); }
        finally { await rm(f.journalPaths.nextPath); }
      } else await owner.assertExternalSelection();
    };
    return consume.call(this, value, { ...owner, assertExternalSelection: external }, row, onFailure);
  });
  await expect(f.run()).resolves.toMatchObject({ registryState: 'after' });
  expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
  expect(changed).toBe(true); await f.preservedEvidence();
});

it.for(['read', 'close'] as const)('joins the actual held %s before rejecting registry publication', async (stage, test) => {
  const f = await fixture(test), open = inventoryFile.openWorkspaceDeletionInventoryFile;
  const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const first = new Error('SYNTHETIC_HELD_FIRST'), later = new Error('SYNTHETIC_HELD_CLOSE');
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const abort = () => release(); test.signal.addEventListener('abort', abort, { once: true });
  let closed = 0, current: (() => void) | undefined, rejectedDuringClose = false, closeCause: unknown;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (
    this: WorkspaceDeletionInventoryStore, value, owner, row, onFailure,
  ) {
    current = owner.assertAuthority; return consume.call(this, value, owner, row, onFailure);
  });
  vi.spyOn(inventoryFile, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await open(...args);
    return { ...file, async read(bytes, position) {
      if (stage === 'close') throw first;
      entered(); await held; return file.read(bytes, position);
    }, async close() {
      if (stage === 'close') {
        try { current!(); } catch (error) { closeCause = error; rejectedDuringClose = true; }
        entered(); await held;
      }
      await file.close(); closed++;
      if (stage === 'close') throw later;
    } };
  });
  let settled = false;
  const result = f.run().then(() => { settled = true; return null; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('HELD_OPERATION_NOT_ENTERED'); })]);
    if (stage === 'read') f.revoke();
    await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
  } finally { release(); test.signal.removeEventListener('abort', abort); }
  const error = await result;
  if (stage === 'close') {
    expect(rejectedDuringClose).toBe(true); expect(closeCause).toBe(first); expect(error.errors).toEqual([first, later]);
  } else expect(error.message).toBe('SYNTHETIC_OWNER_LOST');
  expect(closed).toBe(1); expect(await readFile(f.registryPath)).toEqual(f.registryBytes); await f.preservedEvidence();
});

it('expires inventory callbacks without poisoning a later registry read scope', async test => {
  const f = await fixture(test), consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let stale: Parameters<typeof consume>[1] | undefined;
  let checked = 0;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (
    this: WorkspaceDeletionInventoryStore, value, owner, row, onFailure,
  ) {
    if (stale) {
      expect(() => stale!.assertAuthority()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      await expect(stale.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      checked++;
    }
    await consume.call(this, value, owner, row, onFailure); stale = owner;
  });
  await f.run(); await f.run(); expect(checked).toBeGreaterThan(1);
  expect(f.writeSelected).toHaveBeenCalledTimes(1); await f.preservedEvidence();
});

it.for(['read', 'consumer', 'undefined', 'phase', 'parser'] as const)(
  'returns the complete registry publisher failure chain and closes after %s', async (stage, test) => {
    const f = await fixture(test), first = stage === 'undefined' ? undefined : new Error('SYNTHETIC_FIRST_' + stage);
    const later = new Error('SYNTHETIC_CLOSE_FAILED');
    const open = inventoryFile.openWorkspaceDeletionInventoryFile;
    const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
    const capture = phaseSelection.captureWorkspaceDeletionPhaseSelection;
    let opened = 0, closed = 0, inRead = false, injected = false, notified = false, closeRejected = false;
    let closeCause: unknown, firstNotified: unknown;
    let releaseClose!: () => void, enterClose!: () => void;
    const heldClose = new Promise<void>(resolve => { releaseClose = resolve; });
    const closeStarted = new Promise<void>(resolve => { enterClose = resolve; });
    const releaseOnAbort = () => releaseClose();
    test.signal.addEventListener('abort', releaseOnAbort, { once: true });
    let current: (() => void) | undefined;
    if (stage === 'phase') vi.spyOn(phaseSelection, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async input => {
      const phase = await capture({ ...input, async assertWritersAbsent() {
        if (inRead) throw first;
        await input.assertWritersAbsent();
      } });
      return phase;
    });
    vi.spyOn(inventoryFile, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
      const file = await open(...args); opened++;
      return { ...file, async read(bytes, position) {
        if (stage === 'read' && !injected) { injected = true; throw first; }
        const count = await file.read(bytes, position);
        if (stage === 'parser' && count > 0 && !injected) { injected = true; bytes[0] = 0; }
        return count;
      }, async close() {
        if (stage === 'phase' || stage === 'consumer' || stage === 'undefined' || injected) {
          try { current!(); } catch (error) { closeRejected = true; closeCause = error; }
        }
        if (stage === 'parser') { enterClose(); await heldClose; }
        await file.close(); closed++; throw later;
      } };
    });
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (
      this: WorkspaceDeletionInventoryStore, value, owner, row, onFailure,
    ) {
      current = owner.assertAuthority;
      // Fail the phase only after the real file was opened, not at its initial guard.
      const consumer = async (record: Parameters<typeof row>[0]) => {
        inRead = true;
        if (stage === 'consumer' || stage === 'undefined') throw first;
        await row(record);
      };
      return consume.call(this, value, owner, consumer, error => {
        if (!notified) { notified = true; firstNotified = error; }
        onFailure?.(error);
      });
    });
    let settled = false;
    const task = f.run().then(() => { settled = true; return null; }, error => { settled = true; return error; });
    try {
      if (stage === 'parser') {
        await Promise.race([closeStarted, task.then(() => { throw new Error('PARSER_CLOSE_NOT_PENDING'); })]);
        await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false); expect(closed).toBe(0);
        let rejected = false;
        try { current!(); } catch (error) { rejected = true; expect(error).toBe(firstNotified); }
        expect(rejected).toBe(true);
      }
    } finally { releaseClose(); test.signal.removeEventListener('abort', releaseOnAbort); }
    const result = await task;
    expect(result).toBeInstanceOf(AggregateError);
    expect(notified).toBe(true);
    expect(result.errors).toEqual([firstNotified, later]);
    expect(result.errors[0]).toBe(firstNotified);
    if (stage === 'parser') expect(result.errors[0].message).toBe('WORKSPACE_DELETE_INVENTORY_INVALID');
    else expect(result.errors[0]).toBe(first);
    expect(result.errors[1]).toBe(later);
    expect(opened).toBe(1); expect(closed).toBe(1);
    expect(closeRejected).toBe(true); expect(closeCause).toBe(firstNotified);
    expect(await readFile(f.registryPath)).toEqual(f.registryBytes); await f.preservedEvidence();
  },
);

it.for([false, true])('closes the actual inventory handle before a faulty close oracle is evaluated: %s', async (faultyOracle, test) => {
  const f = await fixture(test), open = inventoryFile.openWorkspaceDeletionInventoryFile;
  const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const first = new Error('SYNTHETIC_ORACLE_SOURCE'), later = new Error('SYNTHETIC_ORACLE_CLOSE');
  let closed = 0, observed = false, current: (() => void) | undefined;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (
    this: WorkspaceDeletionInventoryStore, value, owner, row, onFailure,
  ) {
    current = faultyOracle ? () => {} : owner.assertAuthority;
    return consume.call(this, value, owner, row, onFailure);
  });
  vi.spyOn(inventoryFile, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await open(...args);
    return { ...file, async read() { throw first; }, async close() {
      try { current!(); } catch { observed = true; }
      await file.close(); closed++; throw later;
    } };
  });
  const result = await f.run().then(() => null, error => error);
  expect(closed).toBe(1);
  expect(result.errors[0]).toBe(first); expect(result.errors[1]).toBe(later);
  const checkOracle = () => expect(observed).toBe(true);
  if (faultyOracle) expect(checkOracle).toThrow(); else checkOracle();
  await f.preservedEvidence();
});
