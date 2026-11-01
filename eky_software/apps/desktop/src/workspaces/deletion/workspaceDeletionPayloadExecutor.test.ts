import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { captureDeletionTarget } from '../management/workspaceDeletionTarget.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionInventoryPaths } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionMetadataCleaner } from './workspaceDeletionMetadataCleanup.js';
import { createWorkspaceDeletionPayloadExecutor } from './workspaceDeletionPayloadExecutor.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { createWorkspaceDeletionPublisher } from './workspaceDeletionPublication.js';
import { workspaceDeletionPurgeFileSystem } from './workspaceDeletionPurge.js';
import { workspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';
import { createWorkspaceDeletionRegistryPublisher } from './workspaceDeletionRegistryPublication.js';

const physicalPhaseTimeoutMs = 30_000;

async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-executor-'));
  await chmod(root, 0o700);
  let current = true, writerAbsent = true;
  const pending: Promise<unknown>[] = [];
  const started = performance.now();
  const measurements: { phase: string; durationMs: number }[] = [];
  const advance = WorkspaceDeletionJournalStore.prototype.advance;
  const advanceSpy = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    const phaseStarted = performance.now();
    let phase = 'unknown';
    try { phase = captureWorkspaceDeletionJournal(args[0]).phase; } catch { /* Diagnostics must not replace the store's original failure. */ }
    try { return await advance.apply(this, args); }
    finally { measurements.push({ phase, durationMs: Math.round(performance.now() - phaseStarted) }); }
  });
  const assertCurrent = () => { test.signal.throwIfAborted(); if (!current) throw new Error('SYNTHETIC_OWNER_LOST'); };
  const authority = { assertCurrent, async assertOwned() { assertCurrent(); } };
  const assertWritersAbsent = async () => { assertCurrent(); if (!writerAbsent) throw new Error('SYNTHETIC_WRITER_PRESENT'); };
  test.onTestFinished(async () => {
    current = false;
    await Promise.allSettled(pending);
    vi.restoreAllMocks();
    await writeFile(join(root, 'test-phases.json'), JSON.stringify({ schemaVersion: 1, measurements,
      elapsedMs: Math.round(performance.now() - started) }), { flag: 'wx', mode: 0o600 });
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const initial = { ...createSwitchRegistry(), formatVersion: 2 as const };
  await registry.write(initial);
  const registryBytes = await readFile(registryPath);
  const workspace = deriveWorkspaceRoot(root, TEST_TARGET_WORKSPACE_ID, 1);
  const other = deriveWorkspaceRoot(root, TEST_SOURCE_WORKSPACE_ID, 1);
  await mkdir(workspace.workspaceRoot, { recursive: true, mode: 0o700 });
  await mkdir(other.workspaceRoot, { recursive: true, mode: 0o700 });
  await mkdir(join(workspace.workspaceRoot, 'secrets'), { mode: 0o700 });
  await mkdir(join(workspace.workspaceRoot, 'recovery-points'), { mode: 0o700 });
  for (const slot of ['current', 'backup', 'next']) {
    await writeFile(join(workspace.workspaceRoot, 'secrets', slot), `synthetic-secret-${slot}`, { mode: 0o600 });
  }
  await writeFile(join(workspace.workspaceRoot, 'corrupt.db'), 'owned-but-not-a-database', { mode: 0o600 });
  await writeFile(join(workspace.workspaceRoot, 'recovery-points', 'own-point'), 'synthetic-owned-point', { mode: 0o600 });
  await writeFile(join(other.workspaceRoot, 'retained'), 'other-company-bytes', { mode: 0o600 });
  const external = join(root, 'user-chosen-backup');
  await writeFile(external, 'external-backup-bytes', { mode: 0o600 });
  const selected = await captureDeletionTarget({ installationRoot: root, workspaceId: TEST_TARGET_WORKSPACE_ID,
    typedLabel: initial.workspaces[1]!.workspaceLabel, registry, assertAuthority: assertCurrent });
  const operationId = deletionTestId(100);
  const published = await createWorkspaceDeletionPublisher({ userDataRoot: root, registry, assertWritersAbsent })(
    assertCurrent, async () => { await selected.assertCurrent(); }, selected.target,
    { operationId, target: selected.target, backupDisposition: 'explicitDataLoss' }, () => selected.assertCurrent());
  measurements.push({ phase: 'prepared', durationMs: Math.round(performance.now() - started) });
  const inventoryPaths = createWorkspaceDeletionInventoryPaths(root, operationId);
  const inventoryBytes = await readFile(inventoryPaths.currentPath);
  const quarantine = { ...workspaceDeletionQuarantineFileSystem, move: vi.fn(workspaceDeletionQuarantineFileSystem.move) };
  const purge = { ...workspaceDeletionPurgeFileSystem, unlink: vi.fn(workspaceDeletionPurgeFileSystem.unlink),
    rmdir: vi.fn(workspaceDeletionPurgeFileSystem.rmdir) };
  const command = createWorkspaceDeletionPayloadExecutor({ userDataRoot: root, registry, assertWritersAbsent }, { quarantine, purge });
  const parentIdentity = await workspaceDeletionQuarantineFileSystem.ancestor(workspace.workspacesRoot, false, assertCurrent);
  if (parentIdentity === null) throw new Error('SYNTHETIC_WORKSPACE_PARENT_REQUIRED');
  const payload = deriveWorkspaceDeletionPayloadPaths(root, published.journal.target, {
    role: 'workspace', ownerOperationId: null, generationId: null, member: null, bindingSha256: null,
    rootIdentity: selected.target.rootIdentity, parentIdentity,
  })[0]!;
  const run = () => { const result = command(operationId, authority); pending.push(result); return result; };
  return { root, registry, registryPath, registryBytes, workspace, other, external, published, inventoryPaths, inventoryBytes,
    journalPaths: createWorkspaceDeletionJournalPaths(root), quarantine, purge, payload, command, run, authority, assertWritersAbsent, operationId, advance, advanceSpy,
    revoke() { current = false; }, renew() { current = true; }, writerAppears() { writerAbsent = false; },
    async preserved() {
      expect(await readFile(join(other.workspaceRoot, 'retained'), 'utf8')).toBe('other-company-bytes');
      expect(await readFile(external, 'utf8')).toBe('external-backup-bytes');
      expect(await readFile(registryPath)).toEqual(registryBytes);
      expect(await readFile(inventoryPaths.currentPath)).toEqual(inventoryBytes);
    },
  };
}

it('advances the actual published inventory through physical purge while preserving registry and technical evidence', {
  timeout: physicalPhaseTimeoutMs,
}, async test => {
  const f = await fixture(test);
  const result = await f.run();
  expect(result.phase).toBe('purged');
  expect(f.quarantine.move).toHaveBeenCalledTimes(1);
  expect(f.purge.unlink).toHaveBeenCalledTimes(5);
  expect(f.purge.rmdir).toHaveBeenCalledTimes(3);
  expect(await workspaceDeletionQuarantineFileSystem.entry(f.workspace.workspaceRoot, false, f.authority.assertCurrent)).toBeNull();
  expect(await workspaceDeletionQuarantineFileSystem.entry(f.payload.quarantinePath, false, f.authority.assertCurrent)).toBeNull();
  const journal = await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent);
  expect(journal.plan).toMatchObject({ mode: 'published', selected: result });
  expect(journal.slots.backup).toBeUndefined(); expect(journal.slots.next).toBeUndefined();
  await f.preserved();
  const repeated = await f.run();
  expect(repeated).toEqual(result);
  expect(f.quarantine.move).toHaveBeenCalledTimes(1);
  expect(f.purge.unlink).toHaveBeenCalledTimes(5);
});

it('composes physical purge, registry publication, metadata cleanup and journal-last retirement under one authority', {
  timeout: physicalPhaseTimeoutMs,
}, async test => {
  const f = await fixture(test);
  const input = { userDataRoot: f.root, registry: f.registry, assertWritersAbsent: f.assertWritersAbsent };
  expect((await f.run()).phase).toBe('purged');
  expect((await createWorkspaceDeletionRegistryPublisher(input)(f.operationId, f.authority)).registryState).toBe('after');
  expect((await createWorkspaceDeletionMetadataCleaner(input)(f.operationId, f.authority)).phase).toBe('purged');
  expect((await createWorkspaceDeletionFinalizer(input)(f.operationId, f.authority)).phase).toBe('registryPublished');
  expect((await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent)).plan.mode).toBe('absent');
  await expect(readFile(f.inventoryPaths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await workspaceDeletionQuarantineFileSystem.entry(f.workspace.workspaceRoot, false, f.authority.assertCurrent)).toBeNull();
  expect(await workspaceDeletionQuarantineFileSystem.entry(f.payload.quarantinePath, false, f.authority.assertCurrent)).toBeNull();
  const registry = (await f.registry.inspectSlots()).current!.value;
  expect(registry.workspaces.map(row => row.workspaceId)).toEqual([TEST_SOURCE_WORKSPACE_ID]);
  expect(registry.activeWorkspaceId).toBe(TEST_SOURCE_WORKSPACE_ID);
  expect(f.quarantine.move).toHaveBeenCalledTimes(1); expect(f.purge.unlink).toHaveBeenCalledTimes(5);
  expect(await readFile(join(f.other.workspaceRoot, 'retained'), 'utf8')).toBe('other-company-bytes');
  expect(await readFile(f.external, 'utf8')).toBe('external-backup-bytes');
});

it.for(['moveAck', 'unlinkAck', 'phaseAck'] as const)('resumes from actual durable state after %s is lost', {
  timeout: physicalPhaseTimeoutMs,
}, async (boundary, test) => {
  const f = await fixture(test);
  const first = new Error('SYNTHETIC_ACKNOWLEDGEMENT_LOST');
  if (boundary === 'moveAck') f.quarantine.move.mockImplementationOnce(async (...args) => {
    await workspaceDeletionQuarantineFileSystem.move(...args); throw first;
  });
  else if (boundary === 'unlinkAck') f.purge.unlink.mockImplementationOnce(async path => {
    await workspaceDeletionPurgeFileSystem.unlink(path); throw first;
  });
  else f.advanceSpy.mockImplementationOnce(async function (this: WorkspaceDeletionJournalStore, ...args) {
    await f.advance.apply(this, args); throw first;
  });
  await expect(f.run()).rejects.toBe(first);
  const retained = await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent);
  expect(retained.plan).toMatchObject({ mode: 'published', selected: {
    phase: boundary === 'moveAck' ? 'authorized' : boundary === 'unlinkAck' ? 'purgeAuthorized' : 'quarantined',
  } });
  await f.preserved();
  const resumed = await f.run();
  expect(resumed.phase).toBe('purged');
  expect((await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent)).plan)
    .toMatchObject({ mode: 'published', selected: resumed });
  expect(f.quarantine.move).toHaveBeenCalledTimes(1);
  expect(f.purge.unlink).toHaveBeenCalledTimes(5);
  expect(await workspaceDeletionQuarantineFileSystem.entry(f.payload.quarantinePath, false, f.authority.assertCurrent)).toBeNull();
  await f.preserved();
});

it.for(['before', 'after'] as const)('recovers a real interrupted journal publication %s next-to-current without skipping a phase', {
  timeout: physicalPhaseTimeoutMs,
}, async (boundary, test) => {
  const f = await fixture(test), first = new Error('SYNTHETIC_JOURNAL_MOVE_FAILED');
  f.advanceSpy.mockImplementationOnce(async (value, selection) => {
    const fs = createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
    return f.advance.call(new WorkspaceDeletionJournalStore(f.root, {
      prepareDirectory: fs.prepareDirectory.bind(fs), readSlot: fs.readSlot.bind(fs),
      createNextWriter: fs.createNextWriter.bind(fs), removeSlot: fs.removeSlot.bind(fs), syncDirectory: fs.syncDirectory.bind(fs),
      async moveSlot(source, destination, guard) {
      if (source === 'next' && destination === 'current') {
        if (boundary === 'before') throw first;
        await fs.moveSlot(source, destination, guard); throw first;
      }
      await fs.moveSlot(source, destination, guard);
    } }), value, selection);
  });
  await expect(f.run()).rejects.toBe(first);
  const retained = await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent);
  expect(retained.plan).toMatchObject({ mode: 'published', selected: { phase: boundary === 'before' ? 'authorized' : 'quarantined' } });
  expect(retained.slots.backup).toBeDefined();
  if (boundary === 'before') expect(retained.slots.next).toBeDefined();
  await f.preserved();
  const result = await f.run();
  expect(result.phase).toBe('purged');
  const final = await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent);
  expect(final.plan).toMatchObject({ mode: 'published', selected: result });
  expect(final.slots.next).toBeUndefined(); expect(final.slots.backup).toBeUndefined();
  expect(f.quarantine.move).toHaveBeenCalledTimes(1);
  await f.preserved();
});

it('rejects concurrent execution and joins a pending rename before reporting owner loss', async test => {
  const f = await fixture(test);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.quarantine.move.mockImplementationOnce(async (...args) => {
    entered(); await pending; await workspaceDeletionQuarantineFileSystem.move(...args);
  });
  let settled = false;
  const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_RENAME_NOT_PENDING'); })]);
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    f.revoke();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toMatchObject({ message: 'SYNTHETIC_OWNER_LOST' });
  f.renew();
  expect((await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent)).plan)
    .toMatchObject({ mode: 'published', selected: { phase: 'authorized' } });
  expect(f.purge.unlink).not.toHaveBeenCalled();
  expect(await readFile(join(f.payload.quarantinePath, 'corrupt.db'), 'utf8')).toBe('owned-but-not-a-database');
  await f.preserved();
});
