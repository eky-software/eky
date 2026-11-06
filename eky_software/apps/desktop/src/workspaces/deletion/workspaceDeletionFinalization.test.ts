import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalSerializer.js';
import { validateWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalValidation.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import * as inventoryRetirement from './workspaceDeletionInventoryRetirement.js';
import { WorkspaceDeletionInventoryStore, workspaceDeletionInventoryFileName } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
const terminalChainTimeoutMs = 30_000;
type Fixture = Awaited<ReturnType<typeof fixture>>;
function journalSystem(f: Fixture): CrashSafeFileSlotFileSystem {
  return createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
}

it.for([false, true])('publishes terminal current before inventory retirement and clears the journal last (original proof: %s)', { timeout: terminalChainTimeoutMs }, async (originalProof, test) => {
  const f = await fixture(test, false, originalProof), advance = WorkspaceDeletionJournalStore.prototype.advance, clear = WorkspaceDeletionJournalStore.prototype.clearTerminal;
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

it.for([false, true])('rejects a proof-only payload before terminal cleanup (terminal: %s)', async (terminal, test) => {
  const f = await fixture(test, terminal, true);
  await f.track((async () => {
    expect(f.journal.inventory.recordCount).toBe(1);
    await expect(readFile(join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' });
    const retire = vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory');
    const clear = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal');
    await mkdir(f.originalPaths.candidateRoot, { recursive: true, mode: 0o700 });
    const path = join(f.originalPaths.candidateRoot, 'retained'); await writeFile(path, 'returned payload', { mode: 0o600, flag: 'wx' });
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(retire).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe('returned payload');
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
  })());
});

it.for(['inventory', 'journal'] as const)('preserves terminal evidence after a proof-only payload returns before native %s removal', async (boundary, test) => {
  const f = await fixture(test, true, true); let injected = false;
  await f.track((async () => {
    const path = join(f.originalPaths.candidateRoot, 'retained');
    const inject = async () => {
      expect(injected).toBe(false); injected = true;
      await mkdir(f.originalPaths.candidateRoot, { recursive: true, mode: 0o700 });
      await writeFile(path, 'late returned payload', { mode: 0o600, flag: 'wx' });
    };
    if (boundary === 'inventory') {
      const retire = inventoryRetirement.retireWorkspaceDeletionInventory;
      vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (root, journal, authority) => {
        const fs = createNodeCrashSafeFileSlotFileSystem(f.inventoryPaths, Number.MAX_SAFE_INTEGER), remove = fs.removeSlot.bind(fs);
        fs.removeSlot = async (...args) => { await inject(); return remove(...args); };
        return retire(root, journal, authority, { inventory: fs });
      });
    } else {
      // Select the interrupted terminal state after inventory retirement, not that earlier mutation chain.
      await unlink(f.inventoryPaths.currentPath); await rmdir(f.inventoryPaths.directoryPath);
      const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal, fs = journalSystem(f), remove = fs.removeSlot.bind(fs);
      fs.removeSlot = async (...args) => { await inject(); return remove(...args); };
      vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementationOnce((...args) => clear.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
    }
    await expect(f.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID'); expect(injected).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('late returned payload');
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    if (boundary === 'inventory') expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
    else await expect(readdir(f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.preserved();
  })());
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

it('rejects full-proof loss inside native journal sync after the journal removal', async test => {
  const f = await fixture(test, true, false, { coldSelection: true });
  await unlink(f.inventoryPaths.currentPath); await rmdir(f.inventoryPaths.directoryPath);
  const first = new Error('SYNTHETIC_FINAL_JOURNAL_SYNC_PROOF_LOST');
  const fs = journalSystem(f), sync = fs.syncDirectory.bind(fs);
  let reached = false, guardStarted = false, guardCompleted = false, syncCompleted = false;
  fs.syncDirectory = async (...args) => {
    reached = true; f.fullProof.mockRejectedValue(first);
    const guard = args[0];
    if (guard === undefined) throw new Error('SYNTHETIC_JOURNAL_SYNC_GUARD_MISSING');
    args[0] = { assertAuthority: guard.assertAuthority.bind(guard), async beforeMutation() {
      guardStarted = true; await guard.beforeMutation(); guardCompleted = true;
    } };
    await sync(...args); syncCompleted = true;
  };
  const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementationOnce((...args) =>
    clear.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
  await expect(f.run()).rejects.toBe(first);
  expect(reached).toBe(true);
  expect(guardStarted).toBe(true); expect(guardCompleted).toBe(false); expect(syncCompleted).toBe(false);
  expect((await f.store.inspect(f.authority.assertCurrent)).plan.mode).toBe('absent');
  await expect(readdir(f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved();
});

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

it.for(['inventory', 'journal'] as const)('cold terminal rejects full-proof loss before native %s removal', async (boundary, test) => {
  const f = await fixture(test, true, false, { coldSelection: true }), first = new Error('SYNTHETIC_FULL_TERMINAL_SELECTION_LOST');
  let injected = false;
  const inject = () => { injected = true; f.fullProof.mockRejectedValueOnce(first); };
  if (boundary === 'inventory') {
    const retire = inventoryRetirement.retireWorkspaceDeletionInventory;
    let narrowCalls = 0;
    vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (root, journal, authority, fileSystems, readSelection) => {
      if (readSelection === undefined) throw new Error('SYNTHETIC_TERMINAL_READ_CONTEXT_REQUIRED');
      const fs = createNodeCrashSafeFileSlotFileSystem(f.inventoryPaths, Number.MAX_SAFE_INTEGER), remove = fs.removeSlot.bind(fs);
      fs.removeSlot = async (...args) => { inject(); expect(narrowCalls).toBeGreaterThan(0); return remove(...args); };
      return retire(root, journal, authority, { inventory: fs }, { async assertExternalSelection() { narrowCalls++; await readSelection.assertExternalSelection(); } });
    });
  } else {
    await unlink(f.inventoryPaths.currentPath); await rmdir(f.inventoryPaths.directoryPath);
    const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal, fs = journalSystem(f), remove = fs.removeSlot.bind(fs);
    fs.removeSlot = async (...args) => { inject(); return remove(...args); };
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementationOnce((...args) => clear.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
  }
  await expect(f.run()).rejects.toBe(first); expect(injected).toBe(true);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  if (boundary === 'inventory') expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  else await expect(readdir(f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved();
});

it('cold terminal rejects an ancestor replaced after its once-per-phase capture', async test => {
  const f = await fixture(test, true, true, { coldSelection: true }), retire = inventoryRetirement.retireWorkspaceDeletionInventory;
  await mkdir(f.originalPaths.operationRoot, { recursive: true, mode: 0o700 });
  let replaced = false;
  const retained = join(f.originalPaths.operationsRoot, 'retained-original-operation-parent');
  vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (...args) => {
    await rename(f.originalPaths.operationRoot, retained);
    await mkdir(f.originalPaths.operationRoot, { mode: 0o700 }); replaced = true;
    return retire(...args);
  });
  await expect(f.run()).rejects.toThrow(); expect(replaced).toBe(true);
  await expect(readdir(f.originalPaths.candidateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(retained)).toEqual([]);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});

it('cold nonterminal retains exact full-proof failure at native terminal promotion', async test => {
  const f = await fixture(test), first = new Error('SYNTHETIC_PURGED_FULL_SELECTION_LOST');
  const advance = WorkspaceDeletionJournalStore.prototype.advance, fs = journalSystem(f), move = fs.moveSlot.bind(fs);
  let changed = false;
  fs.moveSlot = async (source, destination, guard) => {
    if (source === 'next' && destination === 'current') changed = true;
    return move(source, destination, guard);
  };
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce((...args) =>
    advance.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() { f.authority.assertCurrent(); },
    async assertStableSelection() { f.authority.assertCurrent(); if (changed) throw first; } });
  await expect(f.track(command(f.header.operationId, f.authority))).rejects.toBe(first);
  expect(changed).toBe(true);
  const retained = await f.store.inspect(f.authority.assertCurrent);
  expect(retained.slots.current).toBeUndefined(); expect(retained.slots.next).toBeDefined(); expect(retained.slots.backup).toBeDefined();
  expect(Buffer.from(retained.slots.backup!.bytes)).toEqual(f.journalBytes);
  expect(Buffer.from(retained.slots.next!.bytes)).toEqual(serializeWorkspaceDeletionJournal({ ...f.journal, phase: 'registryPublished' }));
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});


it.for([false, true])('keeps the actual finalizer call boundary (cold: %s)', async (cold, test) => {
  const f = await fixture(test, true, false, { coldSelection: cold }), first = new Error('SYNTHETIC_STOP_AFTER_CALLER_PROOF');
  let observed = false;
  vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (root, journal, authority, fileSystems, readSelection) => {
    observed = true; expect(root).toBe(f.root); expect(captureWorkspaceDeletionJournal(journal).phase).toBe('registryPublished'); expect(fileSystems).toBeUndefined();
    expect(readSelection).toBeDefined();
    { if (readSelection === undefined) throw new Error('SYNTHETIC_TERMINAL_READ_CONTEXT_REQUIRED'); const calls = f.fullProof.mock.calls.length; await readSelection.assertExternalSelection(); expect(f.fullProof.mock.calls.length).toBe(calls); }
    await authority.assertExternalSelection(); if (cold) expect(f.fullProof).toHaveBeenCalled();
    throw first;
  });
  await expect(f.run()).rejects.toBe(first); expect(observed).toBe(true);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});

it('keeps the actual original ancestor proof after the complete read', async test => {
  const f = await fixture(test, true, true, { coldSelection: true });
  await mkdir(f.originalPaths.operationRoot, { recursive: true, mode: 0o700 });
  const original = WorkspaceDeletionInventoryStore.prototype.inspect, retained = join(f.originalPaths.operationsRoot, 'kept-original-parent');
  let replaced = false;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'inspect').mockImplementationOnce(async function (this: WorkspaceDeletionInventoryStore, ...args) {
    const result = await original.apply(this, args);
    await rename(f.originalPaths.operationRoot, retained); await mkdir(f.originalPaths.operationRoot, { mode: 0o700 });
    replaced = true; return result;
  });
  await expect(f.run()).rejects.toThrow(); expect(replaced).toBe(true);
  expect(await readdir(retained)).toEqual([]);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});
