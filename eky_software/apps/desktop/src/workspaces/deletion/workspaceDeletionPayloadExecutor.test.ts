import { existsSync } from 'node:fs';
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
import { createWorkspaceDeletionCommand } from './workspaceDeletionCommand.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionInventoryPaths } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionMetadataCleaner } from './workspaceDeletionMetadataCleanup.js';
import { createWorkspaceDeletionPayloadExecutor } from './workspaceDeletionPayloadExecutor.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { createWorkspaceDeletionPublisher } from './workspaceDeletionPublication.js';
import { workspaceDeletionPurgeFileSystem } from './workspaceDeletionPurge.js';
import { workspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';
import { createWorkspaceDeletionRegistryPublisher } from './workspaceDeletionRegistryPublication.js';

const physicalPhaseTimeoutMs = 30_000;
const sharedCommandTimeoutMs = 60_000;

async function fixture(test: TestContext, sharedCommand = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-executor-'));
  await chmod(root, 0o700);
  let current = true, writerAbsent = true;
  const pending: Promise<unknown>[] = [];
  const releases: (() => void)[] = [];
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
    for (const release of releases) release();
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
  const shared = sharedCommand ? createWorkspaceDeletionCommand({ userDataRoot: root, registry, assertWritersAbsent }) : undefined;
  const publish = shared?.publish ?? createWorkspaceDeletionPublisher({ userDataRoot: root, registry, assertWritersAbsent });
  const published = await publish(
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
    shared, selected, releases, track<T>(job: Promise<T>) { pending.push(job); return job; },
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

it.for(['completed', 'throws', 'async'] as const)('shared command records removal only after all actual stages and technical retirement finish (%s)', {
  timeout: sharedCommandTimeoutMs,
}, async (outcome, test) => {
  const f = await fixture(test, true), first = new Error('SYNTHETIC_MAIN_RECEIPT_REJECTED');
  const recordRemoved = vi.fn((receipt: unknown) => {
    expect(receipt).toMatchObject({ status: 'removed', journal: { ...f.published.journal, phase: 'registryPublished' } });
    expect(existsSync(f.workspace.workspaceRoot)).toBe(false); expect(existsSync(f.payload.quarantinePath)).toBe(false);
    expect(existsSync(f.inventoryPaths.directoryPath)).toBe(false);
    for (const path of [f.journalPaths.currentPath, f.journalPaths.backupPath, f.journalPaths.nextPath]) expect(existsSync(path)).toBe(false);
    if (outcome === 'throws') throw first;
    if (outcome === 'async') return Promise.resolve();
  });
  const result = f.track(f.shared!.resume(f.operationId, { ...f.authority, recordRemoved }));
  if (outcome === 'throws') await expect(result).rejects.toBe(first);
  else if (outcome === 'async') await expect(result).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  else expect(await result).toEqual({ formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' });
  expect(recordRemoved).toHaveBeenCalledTimes(1);
  expect((await f.registry.inspectSlots()).current!.value.workspaces.map(row => row.workspaceId)).toEqual([TEST_SOURCE_WORKSPACE_ID]);
  expect(await readFile(join(f.other.workspaceRoot, 'retained'), 'utf8')).toBe('other-company-bytes');
  expect(await readFile(f.external, 'utf8')).toBe('external-backup-bytes');
});

it('shared command refuses a changed published binding before any physical stage', { timeout: sharedCommandTimeoutMs }, async test => {
  const f = await fixture(test, true), recordRemoved = vi.fn();
  const changed = serializeWorkspaceDeletionJournal(captureWorkspaceDeletionJournal({ ...f.published.journal, registryAfterSha256: 'c'.repeat(64) }));
  await writeFile(f.journalPaths.currentPath, changed, { mode: 0o600 });
  await expect(f.track(f.shared!.resume(f.operationId, { ...f.authority, recordRemoved }))).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(recordRemoved).not.toHaveBeenCalled(); expect(await readFile(f.journalPaths.currentPath)).toEqual(changed);
  expect(await readFile(join(f.workspace.workspaceRoot, 'corrupt.db'), 'utf8')).toBe('owned-but-not-a-database');
  expect(await workspaceDeletionQuarantineFileSystem.entry(f.payload.quarantinePath, false, f.authority.assertCurrent)).toBeNull(); await f.preserved();
});

it('shared command resumes durable terminal state after a real publication acknowledgement is lost', { timeout: sharedCommandTimeoutMs }, async test => {
  const f = await fixture(test, true), first = new Error('SYNTHETIC_SHARED_TERMINAL_ACK_LOST'), recordRemoved = vi.fn();
  let cut = true;
  f.advanceSpy.mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    const result = await f.advance.apply(this, args);
    if (cut && captureWorkspaceDeletionJournal(args[0]).phase === 'registryPublished') { cut = false; throw first; }
    return result;
  });
  await expect(f.track(f.shared!.resume(f.operationId, { ...f.authority, recordRemoved }))).rejects.toBe(first);
  expect(recordRemoved).not.toHaveBeenCalled(); expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  expect((await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent)).plan).toMatchObject({ mode: 'published', terminalOnly: true });
  // A new owner object is not a real process-crash proof; both enter the same resume implementation.
  const fresh = createWorkspaceDeletionCommand({ userDataRoot: f.root, registry: f.registry, assertWritersAbsent: f.assertWritersAbsent });
  expect(await f.track(fresh.resume(f.operationId, { ...f.authority, recordRemoved }))).toEqual({ formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' });
  expect(recordRemoved).toHaveBeenCalledTimes(1);
  expect((await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertCurrent)).plan.mode).toBe('absent');
  expect(await readFile(join(f.other.workspaceRoot, 'retained'), 'utf8')).toBe('other-company-bytes');
  expect(await readFile(f.external, 'utf8')).toBe('external-backup-bytes');
});

it('shared command joins pending phase work and rejects overlapping publish and resume', { timeout: sharedCommandTimeoutMs }, async test => {
  const f = await fixture(test, true), recordRemoved = vi.fn();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; }); f.releases.push(release);
  f.advanceSpy.mockImplementationOnce(async function (this: WorkspaceDeletionJournalStore, ...args) { entered(); await held; return f.advance.apply(this, args); });
  let settled = false;
  const result = f.track(f.shared!.resume(f.operationId, { ...f.authority, recordRemoved })).then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_SHARED_PHASE_NOT_PENDING'); })]);
    await expect(f.shared!.resume(f.operationId, { ...f.authority, recordRemoved })).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    await expect(f.shared!.publish(f.authority.assertCurrent, f.authority.assertOwned, f.selected.target,
      { operationId: f.operationId, target: f.selected.target, backupDisposition: 'explicitDataLoss' }, f.selected.assertCurrent))
      .rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    f.revoke(); await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toMatchObject({ message: 'SYNTHETIC_OWNER_LOST' }); expect(recordRemoved).not.toHaveBeenCalled(); await f.preserved();
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
