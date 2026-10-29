import { chmod, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { maximumWorkspaceRemnantBindingBytes } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createWorkspaceRegistryPaths, WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { validateWorkspaceReplacementTarget } from './workspaceBackupReplacementRegistry.js';
import { WorkspaceBackupReplacementBinding, type WorkspaceBackupReplacementBindingOptions } from './workspaceBackupReplacementBinding.js';
import { createWorkspaceBackupReplacementFixture, TEST_REPLACEMENT_OPERATION_ID as operationId,
  TEST_REPLACEMENT_WORKSPACE_ID as workspaceId } from './workspaceBackupReplacementTestSupport.js';

describe('workspace replacement binding authority', () => {
  it('requires completed publication before the last synchronous mutation guard', async context => {
    const f = await fixture(context);
    expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(f.onUncertain).not.toHaveBeenCalled();
    await f.binding.publish();
    await f.binding.assertPublished();
    expect(f.binding.assertMutationCurrent()).toBeUndefined();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  for (const loss of ['shutdown', 'lease'] as const) {
  it(`latches ${loss} loss in the last mutation guard without reading or changing files`, async context => {
    const f = await fixture(context);
    await f.binding.publish();
    const before = await snapshot(f.root);
    f.assertOwned.mockClear(); f.assertAbsent.mockClear();
    if (loss === 'shutdown') f.state.shutdown = true;
    else await f.held.release();
    expect(() => f.binding.assertMutationCurrent()).toThrow();
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(f.assertOwned).not.toHaveBeenCalled(); expect(f.assertAbsent).not.toHaveBeenCalled();
    f.state.shutdown = false;
    expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(await snapshot(f.root)).toEqual(before);
  });
  }

  it('does not authorize a mutation while original receipt readback is still pending', async context => {
    const f = await fixture(context);
    await f.binding.publish();
    const entered = gate(); const finish = gate();
    f.assertOwned.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
    const readback = f.binding.assertPublished().then(() => undefined, error => error as unknown);
    await entered.promise;
    try {
      expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(f.onUncertain).toHaveBeenCalledOnce();
    } finally { finish.resolve(); }
    expect(await readback).toBeInstanceOf(Error);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
  });

  it('publishes real bytes under the exact lease, revalidates readback and never removes payloads', async context => {
    const f = await fixture(context);
    const payload = join(f.root, 'preserved-payload');
    await writeFile(payload, 'preserved');
    await f.binding.publish();
    await f.binding.assertPublished();
    expect(JSON.parse(await readFile(f.paths.currentPath, 'utf8'))).toMatchObject({ owner: 'workspaceReplacement', operationId, workspaceId });
    expect(await readFile(payload, 'utf8')).toBe('preserved');
    expect(f.onUncertain).not.toHaveBeenCalled();
    expect(f.assertOwned).toHaveBeenCalled();
    expect(f.assertAbsent).toHaveBeenCalled();
    expect(await readdir(f.paths.directoryPath)).toEqual([`${operationId}.json`]);
  });

  it('captures the acquired handle synchronously rather than a later busy owner', async context => {
    const f = await fixture(context);
    await f.held.release();
    const second = await f.lease.acquire('replace');
    expect(() => new WorkspaceBackupReplacementBinding(f.options)).toThrow('WORKSPACE_MAINTENANCE_BUSY');
    await expect(f.binding.publish()).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    expect(await readdir(f.root)).toEqual([WORKSPACE_REGISTRY_FILE_NAME]);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    await second.release();
  });

  it.for([undefined, null, {}, { release: async () => {} }])('refuses a missing or foreign exact lease: %j', async (lease, context) => {
    const f = await fixture(context);
    const before = await snapshot(f.root);
    expect(() => new WorkspaceBackupReplacementBinding({ ...f.options,
      lease: lease as WorkspaceBackupReplacementBindingOptions['lease'] })).toThrow();
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).not.toHaveBeenCalled();
    f.lease.captureCurrentOwner(['replace'], f.held)();
  });

  for (const slot of ['next', 'backup'] as const) {
    it(`rejects registry ${slot} without repairing it or creating a binding`, async context => {
      const f = await fixture(context);
      const bytes = await readFile(f.registryPaths.currentPath);
      await writeFile(f.registryPaths[`${slot}Path`], bytes, { flag: 'wx', mode: 0o600 });
      await expect(f.binding.publish()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(await readFile(f.registryPaths[`${slot}Path`])).toEqual(bytes);
      expect(await readdir(f.root)).not.toContain('workspace-state');
    });
  }

  for (const change of ['bytes', 'identity', 'missing', 'sideSlot', 'bindingIdentity', 'bindingMissing', 'bindingSideSlot'] as const) {
    it(`rejects ${change} after publication and preserves every observed file`, async context => {
      const f = await fixture(context);
      await f.binding.publish();
      if (change === 'bytes') {
        const raw = await readFile(f.registryPaths.currentPath, 'utf8');
        await writeFile(f.registryPaths.currentPath, ` ${raw}`, { mode: 0o600 });
      } else if (change === 'identity' || change === 'bindingIdentity') {
        const path = change === 'identity' ? f.registryPaths.currentPath : f.paths.currentPath;
        const bytes = await readFile(path);
        await rename(path, `${path}.preserved`);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      } else if (change === 'missing' || change === 'bindingMissing') {
        const path = change === 'missing' ? f.registryPaths.currentPath : f.paths.currentPath;
        await rename(path, `${path}.preserved`);
      } else {
        const paths = change === 'sideSlot' ? f.registryPaths : f.paths;
        await writeFile(paths.nextPath, await readFile(paths.currentPath), { flag: 'wx', mode: 0o600 });
      }
      const before = await snapshot(f.root);
      await expect(f.binding.assertPublished()).rejects.toThrow();
      expect(await snapshot(f.root)).toEqual(before);
      expect(f.onUncertain).toHaveBeenCalledOnce();
      await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(f.onUncertain).toHaveBeenCalledOnce();
    });
  }

  for (const loss of ['lease', 'shutdown', 'ownership', 'runtime', 'registry'] as const) {
    it(`renews ${loss} authority after actual file I/O and retains the incomplete next`, async context => {
      const f = await fixture(context);
      const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
      let closed = false;
      f.fileSystem.createNextWriter = async guard => {
        const writer = await open(guard);
        return { write: writer.write.bind(writer), readIdentity: () => writer.readIdentity!(),
          async sync() {
            await writer.sync();
            if (loss === 'lease') await f.held.release();
            if (loss === 'shutdown') f.state.shutdown = true;
            if (loss === 'ownership') f.state.owned = false;
            if (loss === 'runtime') f.state.absent = false;
            if (loss === 'registry') await writeFile(f.registryPaths.backupPath, await readFile(f.registryPaths.currentPath), { flag: 'wx', mode: 0o600 });
          }, async close() { await writer.close(); closed = true; } };
      };
      await expect(f.binding.publish()).rejects.toThrow();
      expect(closed).toBe(true);
      expect(await readdir(f.paths.directoryPath)).toEqual([`${operationId}.json.next`]);
      expect(f.onUncertain).toHaveBeenCalledOnce();
    });
  }

  it('does not accept persisted current bytes after a lost acknowledgement or retry them', async context => {
    const f = await fixture(context);
    const primary = new Error('SYNTHETIC_ACK_LOST');
    const move = f.fileSystem.moveSlot.bind(f.fileSystem);
    f.fileSystem.moveSlot = async (...args) => { await move(...args); throw primary; };
    await expect(f.binding.publish()).rejects.toBe(primary);
    const before = await snapshot(f.root);
    expect(JSON.parse(await readFile(f.paths.currentPath, 'utf8'))).toMatchObject({ operationId, workspaceId });
    await expect(f.binding.publish()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('joins a pending close before signalling uncertainty or releasing its owner', async context => {
    const f = await fixture(context);
    const entered = gate();
    const release = gate();
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    let closed = false;
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { write: writer.write.bind(writer), sync: writer.sync.bind(writer), readIdentity: () => writer.readIdentity!(),
        async close() { entered.resolve(); await release.promise; await writer.close(); closed = true; } };
    };
    const result = f.binding.publish().then(() => undefined, error => error as unknown);
    await entered.promise;
    try {
      f.state.shutdown = true;
      expect(closed).toBe(false);
      expect(f.onUncertain).not.toHaveBeenCalled();
      f.lease.captureCurrentOwner(['replace'], f.held)();
    } finally { release.resolve(); }
    expect(await result).toBeInstanceOf(Error);
    expect(closed).toBe(true);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    f.lease.captureCurrentOwner(['replace'], f.held)();
  });

  it('preserves first write, close and fail-closed notification failures in order', async context => {
    const f = await fixture(context);
    const primary = new Error('SYNTHETIC_WRITE');
    const close = new Error('SYNTHETIC_CLOSE');
    const notification = new Error('SYNTHETIC_NOTIFY');
    f.onUncertain.mockImplementation(() => { throw notification; });
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { async write() { throw primary; }, sync: writer.sync.bind(writer),
        async close() { await writer.close(); throw close; } };
    };
    await expect(f.binding.publish()).rejects.toMatchObject({ errors: [
      { errors: [primary, close] }, notification,
    ] });
    await expect(f.binding.publish()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('invalidates an overlapping call while joining the original publication', async context => {
    const f = await fixture(context);
    const entered = gate(); const finish = gate();
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    let closed = false;
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { write: writer.write.bind(writer), sync: writer.sync.bind(writer), readIdentity: () => writer.readIdentity!(),
        async close() { entered.resolve(); await finish.promise; await writer.close(); closed = true; } };
    };
    const pending = f.binding.publish().then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('WRITER_DID_NOT_ENTER_CLOSE'); })]);
      await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(f.onUncertain).toHaveBeenCalledOnce();
      expect(closed).toBe(false);
      f.lease.captureCurrentOwner(['replace'], f.held)();
    } finally { finish.resolve(); result = await pending; }
    expect(result).toBeInstanceOf(Error);
    expect(closed).toBe(true);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    const before = await snapshot(f.root);
    await expect(f.binding.publish()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('latches guard loss inside registry reading before finalization and retains all failure causes', async context => {
    const f = await fixture(context);
    const entered = gate(); const finish = gate();
    const first = new Error('SYNTHETIC_FIRST_GUARD');
    const notification = new Error('SYNTHETIC_NOTIFICATION');
    const close = new Error('SYNTHETIC_READER_CLOSE');
    let inject = false; let current = true; let finalized = false;
    const read = f.options.registry.inspectSlots.bind(f.options.registry);
    f.onUncertain.mockImplementation(() => { throw notification; });
    const binding = new WorkspaceBackupReplacementBinding({ ...f.options,
      mainOwner: { assertCurrent() { if (!current) throw first; }, assertOwned: f.assertOwned },
      registry: { async inspectSlots(guard) {
        if (!inject) return read(guard);
        current = false;
        try { guard?.(); }
        finally { entered.resolve(); await finish.promise; finalized = true; throw close; }
      } },
    });
    await binding.publish();
    inject = true;
    const before = await snapshot(f.root);
    const pending = binding.assertPublished().then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('READER_DID_NOT_ENTER_FINALLY'); })]);
      expect(f.onUncertain).toHaveBeenCalledOnce();
      expect(finalized).toBe(false);
      current = true;
      await expect(binding.assertPublished()).rejects.toMatchObject({ cause: { errors: [first, notification] } });
      f.lease.captureCurrentOwner(['replace'], f.held)();
    } finally { finish.resolve(); result = await pending; }
    expect(result).toMatchObject({ errors: [{ errors: [first, notification] }, close] });
    expect(finalized).toBe(true);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(() => binding.assertMutationCurrent()).toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('rejects an asynchronous main assertion without accepting later completion as authority', async context => {
    const f = await fixture(context);
    const binding = new WorkspaceBackupReplacementBinding({ ...f.options,
      mainOwner: { assertCurrent: async () => {}, assertOwned: f.assertOwned } }, f.fileSystem);
    await expect(binding.publish()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(await readdir(f.root)).toEqual([WORKSPACE_REGISTRY_FILE_NAME]);
  });

  it('captures original target bytes before callers can mutate their buffer', async context => {
    const f = await fixture(context);
    f.options.target.registrySnapshot.fill(0);
    await f.binding.publish();
    await f.binding.assertPublished();
  });

  it('does not replace captured main authority with a later no-op method', async context => {
    const f = await fixture(context);
    f.options.mainOwner.assertCurrent = () => {};
    f.state.shutdown = true;
    await expect(f.binding.publish()).rejects.toThrow('SYNTHETIC_SHUTDOWN');
    expect(await readdir(f.root)).toEqual([WORKSPACE_REGISTRY_FILE_NAME]);
  });

  it('does not change its registry reader when caller options are replaced', async context => {
    const f = await fixture(context);
    f.options.registry.inspectSlots = async () => { throw new Error('SYNTHETIC_REPLACED_READER'); };
    await f.binding.publish();
    await f.binding.assertPublished();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('checks authority again after the pending main ownership query settles', async context => {
    const f = await fixture(context);
    const entered = gate();
    const release = gate();
    f.assertOwned.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const result = f.binding.publish().then(() => undefined, error => error as unknown);
    await entered.promise;
    try { await f.held.release(); } finally { release.resolve(); }
    expect(await result).toMatchObject({ message: 'WORKSPACE_MAINTENANCE_BUSY' });
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(await readdir(f.root)).toEqual([WORKSPACE_REGISTRY_FILE_NAME]);
  });

  it('cannot reuse a published receipt under a later replacement lease', async context => {
    const f = await fixture(context);
    await f.binding.publish();
    await f.held.release();
    const second = await f.lease.acquire('replace');
    const before = await snapshot(f.root);
    await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    expect(await snapshot(f.root)).toEqual(before);
    f.lease.captureCurrentOwner(['replace'], second)();
    await second.release();
  });
});

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-replacement-binding-'));
  await chmod(root, 0o700);
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const registryPaths = createWorkspaceRegistryPaths(root, join(root, WORKSPACE_REGISTRY_FILE_NAME));
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPaths.currentPath });
  const existing = createWorkspaceBackupReplacementFixture({ userDataRoot: root });
  await registry.write(existing.registry.value);
  const target = validateWorkspaceReplacementTarget(await registry.inspect(), workspaceId);
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const held = await lease.acquire('replace');
  const paths = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceReplacement', operationId });
  const fileSystem = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceRemnantBindingBytes);
  const state = { owned: true, absent: true, shutdown: false };
  const onUncertain = vi.fn<() => void>();
  const assertOwned = vi.fn(async () => { if (!state.owned) throw new Error('SYNTHETIC_MAIN_NOT_OWNED'); });
  const assertAbsent = vi.fn(async () => { if (!state.absent) throw new Error('SYNTHETIC_RUNTIME_PRESENT'); });
  const options: WorkspaceBackupReplacementBindingOptions = { userDataRoot: root, operationId, target,
    lease: held, maintenanceLease: lease, registry, runtimeAbsence: { assertNoActiveWorkspaceRuntime: assertAbsent },
    mainOwner: { assertCurrent() { if (state.shutdown) throw new Error('SYNTHETIC_SHUTDOWN'); }, assertOwned }, onUncertain };
  return { root, paths, registryPaths, registry, lease, held, state, options, fileSystem, onUncertain, assertOwned, assertAbsent,
    binding: new WorkspaceBackupReplacementBinding(options, fileSystem) };
}

async function snapshot(root: string): Promise<readonly unknown[]> {
  const paths = await readdir(root, { withFileTypes: true });
  paths.sort((a, b) => a.name.localeCompare(b.name));
  const result: unknown[] = [];
  for (const entry of paths) result.push([entry.name, entry.isDirectory()
    ? await snapshot(join(root, entry.name)) : await readFile(join(root, entry.name))]);
  return result;
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
