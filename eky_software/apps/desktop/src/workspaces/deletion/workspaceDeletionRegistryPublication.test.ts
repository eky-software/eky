import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
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
import { captureWorkspaceDeletionJournal, workspaceDeletionPhases, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionRegistryPublisher } from './workspaceDeletionRegistryPublication.js';

async function fixture(test: TestContext, phase: WorkspaceDeletionJournalV1['phase'] = 'purged',
  options: Readonly<{ activeTarget?: boolean; last?: boolean }> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-registry-publication-'));
  await chmod(root, 0o700);
  let active = true;
  const pending: Promise<unknown>[] = [];
  const assertCurrent = () => { test.signal.throwIfAborted(); if (!active) throw new Error('SYNTHETIC_OWNER_LOST'); };
  const authority = { assertCurrent, async assertOwned() { assertCurrent(); } };
  const assertWritersAbsent = async () => { assertCurrent(); };
  const external = { assertAuthority: assertCurrent, async assertExternalSelection() { assertCurrent(); } };
  test.onTestFinished(async () => {
    active = false; await Promise.allSettled(pending);
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
  await rmdir(workspace.workspaceRoot);
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
    run() { const result = command(header.operationId, authority); pending.push(result); return result; },
    revoke() { active = false; },
    async preservedEvidence() {
      expect(await readFile(journalPaths.currentPath)).toEqual(journalBytes);
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
