import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { maximumWorkspaceRemnantBindingBytes } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { createWorkspaceRegistryPaths, WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { createWorkspaceSwitchJournalPaths, serializeVersionedWorkspaceSwitchJournal,
  WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import { createWorkspaceSelectorSwitchJournal, createWorkspaceSelectorSwitchRegistryVariants } from '../switch/workspaceSelectorSwitchState.js';
import { createSwitchJournal, createSwitchRegistry, TEST_SWITCH_CREATED_AT, TEST_SWITCH_OPERATION_ID as operationId,
  TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID as workspaceId } from '../switch/workspaceSwitchTestSupport.js';
import { WorkspaceActivationMigrationBinding, type WorkspaceActivationMigrationBindingOptions } from './workspaceActivationMigrationBinding.js';
import type { WorkspaceActivationMigrationProof } from './workspaceActivationMigrationGuard.js';

const required = 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED';

describe('activation migration binding authority', () => {
  it.for([false, true])('publishes before target stop and grants mutations only after verified stop (selector: %s)', async (selector, context) => {
    const f = await fixture(context, selector);
    await f.binding.publishBeforeSnapshot();
    await f.binding.assertPublished();
    expect(f.binding.assertSnapshotCleanupCurrent()).toBeUndefined();
    expect(f.assertAbsent).not.toHaveBeenCalled();
    expect(f.assertOwned).not.toHaveBeenCalled();
    expect(f.assertStopped).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(f.paths.currentPath, 'utf8'))).toMatchObject({
      owner: 'workspaceActivationMigration', operationId, workspaceId,
    });
    f.state.absent = true; f.state.mainOwned = true;
    await f.binding.enterStopped();
    await f.binding.assertPublished();
    expect(f.binding.assertMutationCurrent()).toBeUndefined();
    expect(f.binding.assertSnapshotCleanupCurrent()).toBeUndefined();
    expect(f.assertAbsent).toHaveBeenCalled(); expect(f.assertOwned).toHaveBeenCalled();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('refuses payload mutation before stop without promoting a publication receipt to shutdown proof', async context => {
    const f = await fixture(context);
    await f.binding.publishBeforeSnapshot();
    const before = await snapshot(f.root);
    expect(() => f.binding.assertMutationCurrent()).toThrow(required);
    f.state.absent = true; f.state.mainOwned = true;
    await expect(f.binding.enterStopped()).rejects.toThrow(required);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('does not grant snapshot cleanup before publication or after owner loss', async context => {
    const f = await fixture(context);
    expect(() => f.binding.assertSnapshotCleanupCurrent()).toThrow(required);
    await f.binding.publishBeforeSnapshot();
    f.state.current = false;
    expect(() => f.binding.assertSnapshotCleanupCurrent()).toThrow('SYNTHETIC_STARTUP_LOST');
    f.state.current = true;
    expect(() => f.binding.assertSnapshotCleanupCurrent()).toThrow(required);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(f.assertStopped).not.toHaveBeenCalled();
  });

  it.for(['present', 'mainNotOwned', 'asyncLoss'] as const)('rejects an unproved stopped transition: %s', async (reason, context) => {
    const f = await fixture(context);
    await f.binding.publishBeforeSnapshot();
    f.state.mainOwned = true;
    if (reason !== 'present') f.state.absent = true;
    if (reason === 'mainNotOwned') f.state.mainOwned = false;
    if (reason === 'asyncLoss') f.assertOwned.mockImplementationOnce(async () => { f.state.current = false; });
    const before = await snapshot(f.root);
    await expect(f.binding.enterStopped()).rejects.toThrow();
    f.state.current = true; f.state.absent = true; f.state.mainOwned = true;
    expect(() => f.binding.assertMutationCurrent()).toThrow(required);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('does not mistake a stopped target for ownership while a candidate holds the reservation', async context => {
    const f = await fixture(context);
    await f.binding.publishBeforeSnapshot();
    f.state.absent = true; f.state.mainOwned = true;
    await f.binding.enterStopped();
    f.state.mainOwned = false;
    expect(() => f.binding.assertMutationCurrent()).toThrow('SYNTHETIC_MAIN_NOT_OWNED');
    f.state.mainOwned = true;
    await expect(f.binding.assertPublished()).rejects.toThrow(required);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(['registryBytes', 'journalBytes', 'registryIdentity', 'journalIdentity',
    'registryNext', 'journalBackup', 'bindingIdentity'] as const)('rejects changed %s without repairing or removing any bytes', async (change, context) => {
    const f = await fixture(context);
    await f.binding.publishBeforeSnapshot();
    const path = change.startsWith('registry') ? f.registryPaths.currentPath
      : change.startsWith('journal') ? f.journalPaths.currentPath : f.paths.currentPath;
    const bytes = await readFile(path);
    if (change.endsWith('Bytes')) await writeFile(path, Buffer.concat([Buffer.from(' '), bytes]));
    else if (change.endsWith('Identity')) {
      await rename(path, path + '.preserved');
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    } else await writeFile(path + (change.endsWith('Next') ? '.next' : '.backup'), bytes, { flag: 'wx', mode: 0o600 });
    const before = await snapshot(f.root);
    await expect(f.binding.assertPublished()).rejects.toThrow();
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(['registry', 'journal'] as const)('refuses initial %s side slots without a repairing read', async (kind, context) => {
    const f = await fixture(context);
    const path = kind === 'registry' ? f.registryPaths.currentPath : f.journalPaths.currentPath;
    await writeFile(path + '.next', await readFile(path), { flag: 'wx', mode: 0o600 });
    const before = await snapshot(f.root);
    await expect(f.binding.publishBeforeSnapshot()).rejects.toThrow(required);
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.readRegistry).not.toHaveBeenCalled(); expect(f.readJournal).not.toHaveBeenCalled();
  });

  it('captures only the acquired switch lease and cannot reuse it after reacquisition', async context => {
    const f = await fixture(context);
    await f.binding.publishBeforeSnapshot();
    await f.held.release();
    const next = await f.maintenance.acquire('switch');
    try {
      expect(() => new WorkspaceActivationMigrationBinding(f.options)).toThrow('WORKSPACE_MAINTENANCE_BUSY');
      await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
      f.maintenance.captureCurrentOwner(['switch'], next)();
    } finally { await next.release(); }
  });

  it('captures proof bytes and callbacks before later caller mutation', async context => {
    const f = await fixture(context);
    f.options.proof.registrySnapshot.fill(0); f.options.proof.switchJournalSnapshot.fill(0);
    f.options.registry.inspectSlots = async () => { throw new Error('REPLACED_READER'); };
    await f.binding.publishBeforeSnapshot();
    f.options.startupOwner.assertCurrent = () => {};
    f.state.current = false;
    await expect(f.binding.assertPublished()).rejects.toThrow('SYNTHETIC_STARTUP_LOST');
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('retains a published current after lost acknowledgement and never treats it as success', async context => {
    const f = await fixture(context);
    const primary = new Error('SYNTHETIC_ACK_LOST');
    const move = f.fileSystem.moveSlot.bind(f.fileSystem);
    f.fileSystem.moveSlot = async (...args) => { await move(...args); throw primary; };
    await expect(f.binding.publishBeforeSnapshot()).rejects.toBe(primary);
    const before = await snapshot(f.root);
    expect(JSON.parse(await readFile(f.paths.currentPath, 'utf8'))).toMatchObject({ operationId });
    await expect(f.binding.publishBeforeSnapshot()).rejects.toThrow(required);
    await expect(f.binding.assertPublished()).rejects.toThrow(required);
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('joins the original file close and preserves first failure before uncertainty notification failure', async context => {
    const f = await fixture(context);
    const entered = gate(); const finish = gate();
    const primary = new Error('SYNTHETIC_WRITE'); const secondary = new Error('SYNTHETIC_NOTIFY');
    f.onUncertain.mockImplementation(() => { throw secondary; });
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    let closed = false;
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { async write() { throw primary; }, sync: writer.sync.bind(writer),
        async close() { entered.resolve(); await finish.promise; await writer.close(); closed = true; } };
    };
    const pending = f.binding.publishBeforeSnapshot().then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('WRITER_DID_NOT_ENTER_CLOSE'); })]);
      expect(closed).toBe(false); expect(f.onUncertain).not.toHaveBeenCalled();
      f.maintenance.captureCurrentOwner(['switch'], f.held)();
    } finally { finish.resolve(); result = await pending; }
    expect(result).toMatchObject({ errors: [primary, secondary] });
    expect(closed).toBe(true); expect(f.onUncertain).toHaveBeenCalledOnce();
    f.maintenance.captureCurrentOwner(['switch'], f.held)();
    expect(f.assertOwned).not.toHaveBeenCalled();
  });

  it('rejects an asynchronous startup assertion before writing any metadata', async context => {
    const f = await fixture(context);
    const binding = new WorkspaceActivationMigrationBinding({ ...f.options, startupOwner: { assertCurrent: async () => {} } });
    const before = await snapshot(f.root);
    await expect(binding.publishBeforeSnapshot()).rejects.toThrow(required);
    expect(await snapshot(f.root)).toEqual(before);
  });

  it.for([undefined, null, {}, { release: async () => {} }])('refuses a missing or foreign exact lease: %j', async (lease, context) => {
    const f = await fixture(context);
    const before = await snapshot(f.root);
    expect(() => new WorkspaceActivationMigrationBinding({ ...f.options,
      lease: lease as WorkspaceActivationMigrationBindingOptions['lease'] })).toThrow();
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).not.toHaveBeenCalled();
    f.maintenance.captureCurrentOwner(['switch'], f.held)();
  });

  it('invalidates an overlapping call while joining the original publication', async context => {
    const f = await fixture(context);
    const entered = gate(); const finish = gate();
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    let closed = false;
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { write: writer.write.bind(writer), sync: writer.sync.bind(writer),
        async close() { entered.resolve(); await finish.promise; await writer.close(); closed = true; } };
    };
    const pending = f.binding.publishBeforeSnapshot().then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('WRITER_DID_NOT_ENTER_CLOSE'); })]);
      await expect(f.binding.assertPublished()).rejects.toThrow(required);
      expect(f.onUncertain).toHaveBeenCalledOnce();
      expect(closed).toBe(false);
      f.maintenance.captureCurrentOwner(['switch'], f.held)();
    } finally { finish.resolve(); result = await pending; }
    expect(result).toBeInstanceOf(Error);
    expect(closed).toBe(true);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    const before = await snapshot(f.root);
    await expect(f.binding.publishBeforeSnapshot()).rejects.toThrow(required);
    expect(() => f.binding.assertMutationCurrent()).toThrow(required);
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('latches guard loss before reader finalization and retains first, notification and close failures', async context => {
    const f = await fixture(context);
    const entered = gate(); const finish = gate();
    const first = new Error('SYNTHETIC_FIRST_GUARD');
    const notification = new Error('SYNTHETIC_NOTIFICATION');
    const close = new Error('SYNTHETIC_READER_CLOSE');
    let inject = false; let current = true; let finalized = false;
    const read = f.options.registry.inspectSlots.bind(f.options.registry);
    f.onUncertain.mockImplementation(() => { throw notification; });
    const binding = new WorkspaceActivationMigrationBinding({ ...f.options,
      startupOwner: { assertCurrent() { if (!current) throw first; } },
      registry: { async inspectSlots(guard) {
        if (!inject) return read(guard);
        current = false;
        try { guard?.(); }
        finally { entered.resolve(); await finish.promise; finalized = true; throw close; }
      } },
    });
    await binding.publishBeforeSnapshot();
    inject = true;
    const pending = binding.assertPublished().then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('READER_DID_NOT_ENTER_FINALLY'); })]);
      expect(f.onUncertain).toHaveBeenCalledOnce();
      expect(finalized).toBe(false);
      current = true;
      await expect(binding.assertPublished()).rejects.toMatchObject({ cause: { errors: [first, notification] } });
      f.maintenance.captureCurrentOwner(['switch'], f.held)();
    } finally { finish.resolve(); result = await pending; }
    expect(result).toMatchObject({ errors: [{ errors: [first, notification] }, close] });
    expect(finalized).toBe(true);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(() => binding.assertMutationCurrent()).toThrow(required);
  });
});

async function fixture(context: TestContext, selector = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-migration-binding-'));
  await chmod(root, 0o700);
  const maintenance = new InMemoryWorkspaceMaintenanceLease();
  const held = await maintenance.acquire('switch');
  context.onTestFinished(async () => {
    await held.release();
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const registryPaths = createWorkspaceRegistryPaths(root, join(root, WORKSPACE_REGISTRY_FILE_NAME));
  const journalPaths = createWorkspaceSwitchJournalPaths(root);
  const before = { ...createSwitchRegistry(), formatVersion: 2 as const, activeWorkspaceId: null };
  const registryValue = selector ? createWorkspaceSelectorSwitchRegistryVariants(before, workspaceId).selected
    : createSwitchRegistry(workspaceId);
  const journalValue = selector ? { ...createWorkspaceSelectorSwitchJournal(before, workspaceId, operationId, TEST_SWITCH_CREATED_AT),
    state: 'targetSelected' as const } : createSwitchJournal('targetSelected');
  const registryBytes = serializeWorkspaceRegistry(registryValue);
  const journalBytes = serializeVersionedWorkspaceSwitchJournal(journalValue);
  await mkdir(journalPaths.directoryPath, { recursive: true, mode: 0o700 });
  await writeFile(registryPaths.currentPath, registryBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(journalPaths.currentPath, journalBytes, { flag: 'wx', mode: 0o600 });
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPaths.currentPath });
  const switchJournal = new WorkspaceSwitchJournalStore(root);
  const readRegistry = vi.spyOn(registry, 'read'); const readJournal = vi.spyOn(switchJournal, 'read');
  const proof: WorkspaceActivationMigrationProof = { operationId: validateWorkspaceBackupImportOperationId(operationId), profileId: 'b'.repeat(64),
    sourceWorkspaceId: selector ? null : TEST_SOURCE_WORKSPACE_ID, targetWorkspaceId: workspaceId,
    registrySnapshot: registryBytes, switchJournalSnapshot: journalBytes };
  const state = { current: true, mainOwned: false, absent: false };
  const assertStopped = vi.fn(() => { if (!state.mainOwned) throw new Error('SYNTHETIC_MAIN_NOT_OWNED'); });
  const assertOwned = vi.fn(async () => { assertStopped(); });
  const assertAbsent = vi.fn(async () => { if (!state.absent) throw new Error('SYNTHETIC_TARGET_PRESENT'); });
  const onUncertain = vi.fn<() => void>();
  const options: WorkspaceActivationMigrationBindingOptions = { userDataRoot: root, proof, lease: held,
    maintenanceLease: maintenance, registry, switchJournal,
    startupOwner: { assertCurrent() { if (!state.current) throw new Error('SYNTHETIC_STARTUP_LOST'); } },
    stoppedOwner: { assertCurrent: assertStopped, assertOwned },
    runtimeAbsence: { assertNoActiveWorkspaceRuntime: assertAbsent }, onUncertain };
  const paths = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceActivationMigration', operationId });
  const fileSystem = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceRemnantBindingBytes);
  return { root, registryPaths, journalPaths, paths, fileSystem, state, options, maintenance, held,
    assertStopped, assertOwned, assertAbsent, onUncertain, readRegistry, readJournal,
    binding: new WorkspaceActivationMigrationBinding(options, fileSystem) };
}

async function snapshot(root: string): Promise<readonly unknown[]> {
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const result: unknown[] = [];
  for (const entry of entries) result.push([entry.name, entry.isDirectory() ? await snapshot(join(root, entry.name))
    : (await readFile(join(root, entry.name))).toString('hex')]);
  return result;
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
