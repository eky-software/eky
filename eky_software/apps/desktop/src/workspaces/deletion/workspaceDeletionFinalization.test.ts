import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalSerializer.js';
import { validateWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalValidation.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId as id, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { readDeletionInventoryDirectoryIdentity as identity } from './workspaceDeletionInventoryFile.js';
import * as inventoryRetirement from './workspaceDeletionInventoryRetirement.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore, workspaceDeletionInventoryFileName } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal, workspaceDeletionPhases } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

const terminalChainTimeoutMs = 30_000;

async function fixture(test: TestContext, terminal = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-finalization-')); await chmod(root, 0o700);
  let active = true, asyncOwnerFailure: Error | undefined;
  const jobs: Promise<unknown>[] = [], releases: (() => void)[] = [];
  const first = new Error('SYNTHETIC_FINALIZATION_OWNER_LOST');
  const assertCurrent = () => { test.signal.throwIfAborted(); if (!active) throw first; };
  const authority = { assertCurrent, async assertOwned() { assertCurrent(); if (asyncOwnerFailure !== undefined) throw asyncOwnerFailure; } };
  const external = { assertAuthority: assertCurrent, async assertExternalSelection() { assertCurrent(); } };
  test.onTestFinished(async () => {
    active = false; for (const release of releases) release(); await Promise.allSettled(jobs); vi.restoreAllMocks();
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME), registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const before = { ...createSwitchRegistry(), formatVersion: 2 as const }; await registry.write(before);
  const target = before.workspaces.find(row => row.workspaceId === TEST_TARGET_WORKSPACE_ID)!;
  const after = removeWorkspaceEntry({ registry: before, targetWorkspaceId: target.workspaceId, expectedActiveWorkspaceId: before.activeWorkspaceId });
  const header = captureDeletionInventoryHeader({ ...deletionTestJournal().target, operationId: id(220), workspaceId: target.workspaceId,
    lineageIdentity: target.lineageIdentity, registryEntrySha256: workspaceRegistryEntrySha256(target) });
  const workspace = deriveWorkspaceRoot(root, target.workspaceId, 1);
  await mkdir(workspace.workspaceRoot, { recursive: true, mode: 0o700 });
  const row = captureDeletionInventoryPayloadRecord({ role: 'workspace', ownerOperationId: null, generationId: null, member: null, bindingSha256: null,
    rootIdentity: await identity(workspace.workspaceRoot, assertCurrent), parentIdentity: await identity(workspace.workspacesRoot, assertCurrent) });
  const inventory = await new WorkspaceDeletionInventoryStore(root, header.operationId).publish(header, (async function* () { yield row; })(), external);
  // Terminal-state fixture only: actual quarantine and purge have separate physical-chain tests.
  await rmdir(workspace.workspaceRoot);
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const journal = captureWorkspaceDeletionJournal({ ...deletionTestJournal(), ...inventory,
    previousActiveWorkspaceId: before.activeWorkspaceId, registryBeforeSha256: hash(await readFile(registryPath)), registryAfterSha256: hash(serializeWorkspaceRegistry(after)) });
  const store = new WorkspaceDeletionJournalStore(root);
  await store.publish(journal, { ...external, slots: (await store.inspect(assertCurrent)).slots });
  for (const phase of workspaceDeletionPhases.slice(1, terminal ? undefined : -1)) {
    await store.advance({ ...journal, phase }, { ...external, slots: (await store.inspect(assertCurrent)).slots });
  }
  await registry.write(after);
  const journalPaths = createWorkspaceDeletionJournalPaths(root), inventoryPaths = createWorkspaceDeletionInventoryPaths(root, header.operationId);
  const journalBytes = await readFile(journalPaths.currentPath), inventoryBytes = await readFile(inventoryPaths.currentPath);
  const other = deriveWorkspaceRoot(root, before.workspaces[0]!.workspaceId, 1);
  await mkdir(other.workspaceRoot, { recursive: true, mode: 0o700 });
  const kept = join(other.workspaceRoot, 'kept'), backup = join(root, 'user-export.ekybackup');
  await writeFile(kept, 'other company', { mode: 0o600 }); await writeFile(backup, 'external backup', { mode: 0o600 });
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: root, registry, async assertWritersAbsent() { assertCurrent(); } });
  return { root, registry, registryPath, before, after, header, workspace, store, journal, journalPaths, inventoryPaths, journalBytes, inventoryBytes,
    authority, external, first, releases, revoke() { active = false; }, failAsyncOwner(error: Error) { asyncOwnerFailure = error; },
    run() { const result = command(header.operationId, authority); jobs.push(result); return result; },
    async preserved() {
      expect(await readFile(kept, 'utf8')).toBe('other company'); expect(await readFile(backup, 'utf8')).toBe('external backup');
      expect(await readFile(registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(after)));
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function journalSystem(f: Fixture): CrashSafeFileSlotFileSystem {
  return createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
}

it('publishes terminal current before inventory retirement and clears the journal last', { timeout: terminalChainTimeoutMs }, async test => {
  const f = await fixture(test), advance = WorkspaceDeletionJournalStore.prototype.advance, clear = WorkspaceDeletionJournalStore.prototype.clearTerminal;
  const order: string[] = [];
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); order.push('publish'); return advance.apply(this, args);
  });
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    await expect(readdir(f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.store.inspect(f.authority.assertCurrent)).plan).toMatchObject({ mode: 'published', terminalOnly: true });
    order.push('clear'); return clear.apply(this, args);
  });
  expect((await f.run()).phase).toBe('registryPublished'); expect(order).toEqual(['publish', 'clear']);
  expect((await f.store.inspect(f.authority.assertCurrent)).plan.mode).toBe('absent');
  expect(await readdir(f.inventoryPaths.parentPath)).toEqual([]); await f.preserved();
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT'); await f.preserved();
});

it.for(['beforeBackup', 'beforePublication', 'afterPublication', 'backupRemoval'] as const)(
  'reconciles real terminal write slots after %s before retiring the inventory', { timeout: terminalChainTimeoutMs }, async (cut, test) => {
    const f = await fixture(test), first = new Error('SYNTHETIC_TERMINAL_WRITE_CUT');
    const advance = WorkspaceDeletionJournalStore.prototype.advance, fs = journalSystem(f), move = fs.moveSlot.bind(fs), remove = fs.removeSlot.bind(fs);
    fs.moveSlot = async (source, destination, guard) => {
      if ((cut === 'beforeBackup' && source === 'current') || (cut === 'beforePublication' && source === 'next')) throw first;
      await move(source, destination, guard); if (cut === 'afterPublication' && source === 'next') throw first;
    };
    fs.removeSlot = async (...args) => { if (cut === 'backupRemoval' && args[0] === 'backup') throw first; return remove(...args); };
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce((...args) => advance.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
    await expect(f.run()).rejects.toBe(first);
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
    const interrupted = await f.store.inspect(f.authority.assertCurrent);
    expect(interrupted.plan).toMatchObject({ mode: 'published', selected: { phase:
      cut === 'afterPublication' || cut === 'backupRemoval' ? 'registryPublished' : 'purged' } });
    expect((await f.run()).phase).toBe('registryPublished');
    expect((await f.store.inspect(f.authority.assertCurrent)).plan.mode).toBe('absent'); await f.preserved();
  },
);

it('uses durable terminal selection after a real publication acknowledgement is lost', { timeout: terminalChainTimeoutMs }, async test => {
  const f = await fixture(test), first = new Error('SYNTHETIC_TERMINAL_ACK_LOST'), advance = WorkspaceDeletionJournalStore.prototype.advance;
  const calls = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce(async function (this: WorkspaceDeletionJournalStore, ...args) {
    await advance.apply(this, args); throw first;
  });
  await expect(f.run()).rejects.toBe(first); expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  expect((await f.store.inspect(f.authority.assertCurrent)).plan).toMatchObject({ mode: 'published', terminalOnly: true });
  expect((await f.run()).phase).toBe('registryPublished'); expect(calls).toHaveBeenCalledTimes(1); await f.preserved();
});

it('requires the acknowledged terminal file identity before starting inventory retirement', { timeout: terminalChainTimeoutMs }, async test => {
  const f = await fixture(test), advance = WorkspaceDeletionJournalStore.prototype.advance;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce(async function (this: WorkspaceDeletionJournalStore, ...args) {
    const receipt = await advance.apply(this, args), bytes = await readFile(f.journalPaths.currentPath);
    await rename(f.journalPaths.currentPath, join(f.root, 'retained-terminal'));
    await writeFile(f.journalPaths.currentPath, bytes, { mode: 0o600, flag: 'wx' }); return receipt;
  });
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(await readFile(join(f.root, 'retained-terminal'))); await f.preserved();
});

it('pins the original terminal identity across the retirement delegate before any inventory deletion', { timeout: terminalChainTimeoutMs }, async test => {
  const f = await fixture(test, true), retire = inventoryRetirement.retireWorkspaceDeletionInventory;
  vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (...args) => {
    await rename(f.journalPaths.currentPath, join(f.root, 'retained-selected-terminal'));
    await writeFile(f.journalPaths.currentPath, f.journalBytes, { mode: 0o600, flag: 'wx' }); return retire(...args);
  });
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  expect(await readdir(f.inventoryPaths.directoryPath)).toEqual([workspaceDeletionInventoryFileName]);
  expect(await readFile(join(f.root, 'retained-selected-terminal'))).toEqual(f.journalBytes); await f.preserved();
});

it.for(['inventory', 'journal'] as const)('retains the first async owner failure inside native %s removal', { timeout: terminalChainTimeoutMs }, async (boundary, test) => {
  const f = await fixture(test, true), first = new Error('SYNTHETIC_ASYNC_OWNER_FAILURE');
  if (boundary === 'inventory') {
    const retire = inventoryRetirement.retireWorkspaceDeletionInventory;
    vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (root, journal, authority) => {
      const fs = createNodeCrashSafeFileSlotFileSystem(f.inventoryPaths, Number.MAX_SAFE_INTEGER), remove = fs.removeSlot.bind(fs);
      fs.removeSlot = async (...args) => { f.failAsyncOwner(first); return remove(...args); };
      return retire(root, journal, authority, { inventory: fs });
    });
  } else {
    const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal, fs = journalSystem(f), remove = fs.removeSlot.bind(fs);
    fs.removeSlot = async (...args) => { f.failAsyncOwner(first); return remove(...args); };
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementationOnce((...args) => clear.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
  }
  await expect(f.run()).rejects.toBe(first);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  if (boundary === 'inventory') expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  else await expect(readdir(f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved();
});

it.for(['afterInventoryUnlink', 'afterOperationRmdir', 'afterParentSync'] as const)(
  'resumes only technical cleanup with terminal current after %s', { timeout: terminalChainTimeoutMs }, async (cut, test) => {
    const f = await fixture(test), first = new Error('SYNTHETIC_INVENTORY_RETIREMENT_CUT');
    const retire = inventoryRetirement.retireWorkspaceDeletionInventory;
    vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (root, journal, authority) => {
      const fs = createNodeCrashSafeFileSlotFileSystem(f.inventoryPaths, Number.MAX_SAFE_INTEGER), remove = fs.removeSlot.bind(fs);
      const parent = createNodeCrashSafeFileSlotFileSystem({ ...f.inventoryPaths, directoryPath: f.inventoryPaths.parentPath }, 1), sync = parent.syncDirectory.bind(parent);
      fs.removeSlot = async (...input) => { const result = await remove(...input); if (cut === 'afterInventoryUnlink') throw first; return result; };
      parent.syncDirectory = async (...input) => { await sync(...input); if (cut === 'afterParentSync') throw first; };
      return retire(root, journal, authority, {
        inventory: fs, parent, async removeDirectory(path) { await rmdir(path); if (cut === 'afterOperationRmdir') throw first; },
      });
    });
    await expect(f.run()).rejects.toBe(first);
    expect((await f.store.inspect(f.authority.assertCurrent)).plan).toMatchObject({ mode: 'published', terminalOnly: true });
    expect((await f.run()).phase).toBe('registryPublished');
    expect((await f.store.inspect(f.authority.assertCurrent)).plan.mode).toBe('absent'); await f.preserved();
  },
);

it.for(['beforeRemove', 'afterRemove', 'afterSync'] as const)(
  'never fabricates successful completion after the final journal %s fails', { timeout: terminalChainTimeoutMs }, async (cut, test) => {
    const f = await fixture(test, true), first = new Error('SYNTHETIC_FINAL_JOURNAL_CUT');
    const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal, fs = journalSystem(f), remove = fs.removeSlot.bind(fs), sync = fs.syncDirectory.bind(fs);
    fs.removeSlot = async (...args) => { if (cut === 'beforeRemove') throw first; const result = await remove(...args); if (cut === 'afterRemove') throw first; return result; };
    fs.syncDirectory = async (...args) => { await sync(...args); if (cut === 'afterSync') throw first; };
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementationOnce((...args) => clear.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
    await expect(f.run()).rejects.toBe(first);
    await expect(readdir(f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    if (cut === 'beforeRemove') expect((await f.run()).phase).toBe('registryPublished');
    else {
      expect((await f.store.inspect(f.authority.assertCurrent)).plan.mode).toBe('absent');
      await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    }
    await f.preserved();
  },
);

it.for(['inventory', 'source', 'binding', 'registry'] as const)(
  'does not publish completion when the original %s proof is missing or changed', { timeout: terminalChainTimeoutMs }, async (change, test) => {
    const f = await fixture(test);
    if (change === 'inventory') await unlink(f.inventoryPaths.currentPath);
    if (change === 'source') { await mkdir(f.workspace.workspaceRoot, { mode: 0o700 }); await writeFile(join(f.workspace.workspaceRoot, 'retained'), 'late source'); }
    if (change === 'binding') await new WorkspaceRemnantBindingStore(f.root, { owner: 'workspaceImport', operationId: id(221) }).publish({
      formatVersion: 1, owner: 'workspaceImport', operationId: id(221), workspaceId: f.header.workspaceId, lineageIdentity: f.header.lineageIdentity,
    }, f.external);
    if (change === 'registry') await f.registry.write(f.before);
    await expect(f.run()).rejects.toThrow(); expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    if (change !== 'inventory') expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
    if (change === 'source') expect(await readFile(join(f.workspace.workspaceRoot, 'retained'), 'utf8')).toBe('late source');
    if (change === 'binding') expect(await readFile(createWorkspaceRemnantBindingPaths(f.root, { owner: 'workspaceImport', operationId: id(221) }).currentPath, 'utf8')).toContain(f.header.workspaceId);
    if (change !== 'registry') await f.preserved();
  },
);

it.for([false, true])('keeps an unretired original journal and all deletion evidence (terminal: %s)', { timeout: terminalChainTimeoutMs }, async (terminal, test) => {
  const f = await fixture(test, terminal), path = join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
  const bytes = serializeWorkspaceBackupImportJournal(validateWorkspaceBackupImportJournal({ formatVersion: 2, operationId: id(222),
    workspaceId: f.header.workspaceId, workspaceLabel: 'Synthetic pending import', createdAt: '2026-11-01T00:00:00.000Z',
    previousActiveWorkspaceId: null, state: 'prepared', lineageIdentity: null }));
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(path)).toEqual(Buffer.from(bytes)); expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});

it.for(['registryIdentity', 'source', 'binding'] as const)(
  'stops the actual terminal publication after a late %s change', { timeout: terminalChainTimeoutMs }, async (change, test) => {
    const f = await fixture(test), advance = WorkspaceDeletionJournalStore.prototype.advance, fs = journalSystem(f), move = fs.moveSlot.bind(fs);
    fs.moveSlot = async (source, destination, guard) => {
      if (source === 'next') {
        if (change === 'registryIdentity') {
          const bytes = await readFile(f.registryPath); await rename(f.registryPath, join(f.root, 'retained-registry')); await writeFile(f.registryPath, bytes, { mode: 0o600, flag: 'wx' });
        } else if (change === 'source') await mkdir(f.workspace.workspaceRoot, { mode: 0o700 });
        else await new WorkspaceRemnantBindingStore(f.root, { owner: 'workspaceImport', operationId: id(221) }).publish({
          formatVersion: 1, owner: 'workspaceImport', operationId: id(221), workspaceId: f.header.workspaceId, lineageIdentity: f.header.lineageIdentity,
        }, f.external);
      }
      await move(source, destination, guard);
    };
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce((...args) => advance.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
    await expect(f.run()).rejects.toThrow(); expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
    const after = await f.store.inspect(f.authority.assertCurrent);
    expect(after.slots.current).toBeUndefined(); expect(after.slots.next?.value.phase).toBe('registryPublished'); expect(after.slots.backup?.value.phase).toBe('purged');
    await f.preserved();
  },
);

it('refuses missing inventory until terminal side slots have been reconciled with the original evidence', { timeout: terminalChainTimeoutMs }, async test => {
  const f = await fixture(test, true);
  await writeFile(f.journalPaths.backupPath, serializeWorkspaceDeletionJournal({ ...f.journal, phase: 'purged' }), { mode: 0o600, flag: 'wx' });
  await unlink(f.inventoryPaths.currentPath);
  const retained = await readFile(f.journalPaths.backupPath);
  await expect(f.run()).rejects.toThrow();
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes); expect(await readFile(f.journalPaths.backupPath)).toEqual(retained); await f.preserved();
});

it('joins a pending terminal write and rejects concurrent finalization after owner revocation', { timeout: terminalChainTimeoutMs }, async test => {
  const f = await fixture(test), advance = WorkspaceDeletionJournalStore.prototype.advance, fs = journalSystem(f), move = fs.moveSlot.bind(fs);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; }); f.releases.push(release);
  fs.moveSlot = async (source, destination, guard) => { if (source === 'next') { entered(); await held; } await move(source, destination, guard); };
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce((...args) => advance.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
  let settled = false; const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_TERMINAL_WRITE_NOT_PENDING'); })]);
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT'); f.revoke(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toBe(f.first); expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});
