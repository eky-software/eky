import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, vi, type TestContext } from 'vitest';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { validateWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalValidation.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId as id, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionMetadataCleaner } from './workspaceDeletionMetadataCleanup.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { readDeletionInventoryDirectoryIdentity as identity } from './workspaceDeletionInventoryFile.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, captureWorkspaceDeletionOriginalJournalProof, maximumWorkspaceDeletionJournalBytes, workspaceDeletionPhases, type WorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import * as inventoryFiles from './workspaceDeletionInventoryFile.js';

export async function createWorkspaceDeletionFinalizationTestFixture(test: TestContext, terminal = false, originalProof = false,
  options: Readonly<{ coldSelection?: boolean; metadataBinding?: boolean }> = {}) {
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
  const prepared = (async () => {
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
  const originalBinding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport', operationId: id(223),
    workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
  const originalPaths = deriveWorkspaceBackupImportPaths(root, validateWorkspaceBackupImportOperationId(originalBinding.operationId), target.workspaceId);
  let metadataRow: ReturnType<typeof captureDeletionInventoryPayloadRecord> | undefined;
  let foreignMetadata: { path: string; bytes: Buffer } | undefined;
  if (options.metadataBinding) {
    await new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(originalBinding)).publish(originalBinding, external);
    const foreign = captureWorkspaceRemnantBinding({ ...originalBinding, operationId: id(225),
      workspaceId: before.workspaces[0]!.workspaceId, lineageIdentity: before.workspaces[0]!.lineageIdentity });
    await new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(foreign)).publish(foreign, external);
    const foreignPath = createWorkspaceRemnantBindingPaths(root, workspaceRemnantBindingKey(foreign)).currentPath;
    foreignMetadata = { path: foreignPath, bytes: await readFile(foreignPath) };
    await mkdir(originalPaths.candidateRoot, { recursive: true, mode: 0o700 });
    metadataRow = captureDeletionInventoryPayloadRecord({ role: 'importCandidate', ownerOperationId: originalBinding.operationId,
      generationId: null, member: null, bindingSha256: workspaceRemnantBindingSha256(originalBinding),
      rootIdentity: await identity(originalPaths.candidateRoot, assertCurrent),
      parentIdentity: await identity(originalPaths.operationRoot, assertCurrent) });
  }
  const inventory = await new WorkspaceDeletionInventoryStore(root, header.operationId).publish(header,
    (async function* () { if (metadataRow !== undefined) yield metadataRow; yield row; })(), external);
  // Terminal-state fixture only: actual quarantine and purge have separate physical-chain tests.
  await rmdir(workspace.workspaceRoot);
  if (metadataRow !== undefined) await rmdir(originalPaths.candidateRoot);
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const originalJournalProofs: WorkspaceDeletionOriginalJournalProof[] = [];
  if (originalProof) {
    const filePath = join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
    const original = new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath });
    await original.write(validateWorkspaceBackupImportJournal({ formatVersion: 2, operationId: originalBinding.operationId,
      workspaceId: target.workspaceId, workspaceLabel: 'Synthetic original proof', createdAt: '2026-11-02T00:00:00.000Z',
      previousActiveWorkspaceId: null, state: 'prepared', lineageIdentity: null }));
    const selected = await original.inspectSlots(assertCurrent), current = selected.current!;
    originalJournalProofs.push(captureWorkspaceDeletionOriginalJournalProof(header, {
      owner: originalBinding.owner, operationId: originalBinding.operationId, bindingSha256: workspaceRemnantBindingSha256(originalBinding),
      slots: { current: { sha256: hash(current.bytes), identity: current.identity }, next: null, backup: null },
    }));
    // Terminal-state fixture only; metadata-owner retirement has separate native tests.
    await unlink(filePath);
  }
  const journal = captureWorkspaceDeletionJournal({ ...deletionTestJournal(), ...inventory,
    ...(originalProof ? { formatVersion: 2, originalJournalProofs } : {}),
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
  const fullProof = vi.fn(async () => { authority.assertCurrent(); });
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: root, registry, async assertWritersAbsent() { assertCurrent(); },
    ...(options.coldSelection ? { assertStableSelection: fullProof } : {}) });
  return { root, registry, registryPath, before, after, header, workspace, store, journal, journalPaths, inventoryPaths, journalBytes, inventoryBytes, originalPaths, originalBinding,
    authority, external, first, releases, fullProof, revoke() { active = false; }, failAsyncOwner(error: Error) { asyncOwnerFailure = error; },
    run() { const result = command(header.operationId, authority); jobs.push(result); return result; },
    track<T>(pending: Promise<T>) { jobs.push(pending); return pending; },
    async preserved() {
      expect(await readFile(kept, 'utf8')).toBe('other company'); expect(await readFile(backup, 'utf8')).toBe('external backup');
      if (foreignMetadata !== undefined) expect(await readFile(foreignMetadata.path)).toEqual(foreignMetadata.bytes);
      expect(await readFile(registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(after)));
    },
  };
  })();
  jobs.push(prepared); return prepared;
}

export async function captureWorkspaceDeletionMetadataPostClearTestFailure(test: TestContext, first: unknown, closeFailure: Error) {
  const f = await createWorkspaceDeletionFinalizationTestFixture(test, false, false, { metadataBinding: true });
  let cleared = false, failed = false, closed = 0;
  const clear = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
  const clearSpy = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation(async function(this: WorkspaceRemnantBindingStore, ...args) {
    const result = await clear.apply(this, args); cleared = true; return result;
  });
  const inspect = WorkspaceRemnantBindingStore.prototype.inspectCommittedDeletionSlots;
  const inspectSpy = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspectCommittedDeletionSlots').mockImplementation(function(this: WorkspaceRemnantBindingStore, ...args) {
    if (cleared) { failed = true; f.revoke(); throw first; }
    return inspect.apply(this, args);
  });
  const open = inventoryFiles.openWorkspaceDeletionInventoryFile;
  const openSpy = vi.spyOn(inventoryFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await open(...args);
    return { ...file, async close() {
      await file.close();
      if (failed && args[0] === f.inventoryPaths.currentPath) { closed++; throw closeFailure; }
    } };
  });
  let error: unknown;
  try {
    const clean = createWorkspaceDeletionMetadataCleaner({ userDataRoot: f.root, registry: f.registry,
      async assertWritersAbsent() { f.authority.assertCurrent(); } });
    error = await f.track(clean(f.header.operationId, f.authority)).then(() => undefined, cause => cause);
  } finally { openSpy.mockRestore(); inspectSpy.mockRestore(); clearSpy.mockRestore(); }
  expect(cleared).toBe(true); expect(failed).toBe(true); expect(closed).toBe(1);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toHaveLength(2);
  expect((error as AggregateError).errors[0]).toBe(first);
  expect((error as AggregateError).errors[1]).toBe(closeFailure);
  const binding = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.originalBinding));
  await expect(readFile(binding.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
  return error;
}

export async function captureWorkspaceDeletionPurgedInventoryTestFailure(test: TestContext, first: unknown, closeFailure: Error) {
  const f = await createWorkspaceDeletionFinalizationTestFixture(test);
  let read = false, closed = 0;
  const open = inventoryFiles.openWorkspaceDeletionInventoryFile;
  const openSpy = vi.spyOn(inventoryFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await open(...args);
    if (args[0] !== f.inventoryPaths.currentPath) return file;
    return { ...file, async read(...values) { await file.read(...values); read = true; throw first; },
      async close() { await file.close(); closed++; throw closeFailure; } };
  });
  let error: unknown;
  try { error = await f.run().then(() => undefined, cause => cause); }
  finally { openSpy.mockRestore(); }
  expect(read).toBe(true); expect(closed).toBe(1);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toHaveLength(2);
  expect((error as AggregateError).errors[0]).toBe(first);
  expect((error as AggregateError).errors[1]).toBe(closeFailure);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
  return error;
}

export async function captureWorkspaceDeletionPublicationPrefixTestFailure(test: TestContext, first: unknown) {
  const f = await createWorkspaceDeletionFinalizationTestFixture(test, false, false, { coldSelection: true });
  const fs = createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
  const prepare = fs.prepareDirectory.bind(fs), advance = WorkspaceDeletionJournalStore.prototype.advance;
  let prefixCalls = 0, normalized: unknown;
  fs.prepareDirectory = async (...args) => {
    f.fullProof.mockRejectedValueOnce(first);
    try { return await prepare(...args); }
    catch (error) { normalized = error; throw error; }
  };
  const advanceSpy = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(function(
    this: WorkspaceDeletionJournalStore, value, selection, readSelection,
  ) {
    if (readSelection === undefined) throw new Error('PUBLICATION_PREFIX_NOT_FORWARDED');
    return advance.call(new WorkspaceDeletionJournalStore(f.root, fs), value, selection, {
      async assertBeforeSlotRead() { prefixCalls++; await readSelection.assertBeforeSlotRead(); },
    });
  });
  let outcome: { ok: true } | { ok: false; error: unknown };
  try { outcome = await f.run().then(() => ({ ok: true as const }), error => ({ ok: false as const, error })); }
  finally { advanceSpy.mockRestore(); }
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('PUBLICATION_PREFIX_EXPECTED_REJECTION');
  expect(prefixCalls).toBe(2);
  expect(normalized).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
  expect(outcome.error).toBe(first);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
  return outcome.error;
}

export async function captureWorkspaceDeletionTerminalPrefixTestFailure(test: TestContext, first: unknown) {
  const f = await createWorkspaceDeletionFinalizationTestFixture(test, true, false, { coldSelection: true });
  await unlink(f.inventoryPaths.currentPath); await rmdir(f.inventoryPaths.directoryPath);
  const fs = createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
  const remove = fs.removeSlot.bind(fs), clear = WorkspaceDeletionJournalStore.prototype.clearTerminal;
  let prefixCalls = 0, normalized: unknown;
  fs.removeSlot = async (...args) => {
    f.fullProof.mockRejectedValueOnce(first);
    try { return await remove(...args); }
    catch (error) { normalized = error; throw error; }
  };
  const clearSpy = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementation(function(this: WorkspaceDeletionJournalStore, selection, terminal, readSelection) {
    if (readSelection === undefined) throw new Error('TERMINAL_PREFIX_NOT_FORWARDED');
    return clear.call(new WorkspaceDeletionJournalStore(f.root, fs), selection, terminal, {
      async assertBeforeSlotRead() { prefixCalls++; await readSelection.assertBeforeSlotRead(); },
    });
  });
  let outcome: { ok: true } | { ok: false; error: unknown };
  try { outcome = await f.run().then(() => ({ ok: true as const }), error => ({ ok: false as const, error })); }
  finally { clearSpy.mockRestore(); }
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('TERMINAL_PREFIX_EXPECTED_REJECTION');
  expect(prefixCalls).toBe(2);
  expect(normalized).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
  expect(outcome.error).toBe(first);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes); await f.preserved();
  return outcome.error;
}

export async function captureWorkspaceDeletionRetirementReadTestFailure(
  test: TestContext, first: unknown, closeFailure: Error, coldSelection = false,
) {
  const f = await createWorkspaceDeletionFinalizationTestFixture(test, true, false, { coldSelection });
  let inside = false, armed = false, invoked = false, closed = 0;
  let readAuthority: Parameters<WorkspaceDeletionInventoryStore['inspect']>[1] | undefined;
  const owned = f.authority.assertOwned.bind(f.authority);
  f.authority.assertOwned = async () => { if (armed) throw first; await owned(); };
  const inspect = WorkspaceDeletionInventoryStore.prototype.inspect;
  const inspectSpy = vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'inspect').mockImplementation(async function(this: WorkspaceDeletionInventoryStore, ...args) {
    inside = true; readAuthority = args[1];
    try { return await inspect.apply(this, args); } finally { inside = false; }
  });
  const open = inventoryFiles.openWorkspaceDeletionInventoryFile;
  const openSpy = vi.spyOn(inventoryFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await open(...args);
    if (!inside || args[0] !== f.inventoryPaths.currentPath || args[1] !== 'r') return file;
    return { ...file, async read(...values) {
      const result = await file.read(...values);
      if (!invoked) {
        invoked = true; armed = true;
        await readAuthority!.assertExternalSelection();
        throw new Error('RETIREMENT_OWNER_FAILURE_WAS_SWALLOWED');
      }
      return result;
    }, async close() { await file.close(); closed++; throw closeFailure; } };
  });
  let result: { ok: true } | { ok: false; error: unknown };
  try { result = await f.run().then(() => ({ ok: true as const }), error => ({ ok: false as const, error })); }
  finally { openSpy.mockRestore(); inspectSpy.mockRestore(); }
  expect(result.ok).toBe(false); expect(invoked).toBe(true); expect(closed).toBe(1);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
  if (result.ok) throw new Error('RETIREMENT_REJECTION_REQUIRED');
  expect(result.error).toBeInstanceOf(AggregateError);
  expect((result.error as AggregateError).errors).toHaveLength(2);
  expect((result.error as AggregateError).errors[0]).toBe(first);
  expect((result.error as AggregateError).errors[1]).toBe(closeFailure);
  return result.error as AggregateError;
}
