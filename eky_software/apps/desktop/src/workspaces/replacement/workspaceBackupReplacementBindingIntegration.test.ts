import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { maximumWorkspaceRemnantBindingBytes } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WorkspaceBackupReplacementBinding } from './workspaceBackupReplacementBinding.js';
import { ProfileRestoreWorkspaceReplacementActivationFactory } from './workspaceBackupReplacementActivationFactory.js';
import type { WorkspaceReplacementActivationAuthority } from './workspaceBackupReplacementPorts.js';
import { deriveWorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';
import { createWorkspaceBackupReplacementFixture, TEST_REPLACEMENT_OPERATION_ID as operationId,
  TEST_REPLACEMENT_WORKSPACE_ID as workspaceId, TEST_REPLACEMENT_CONTAINER_PATH, TEST_REPLACEMENT_PASSWORD } from './workspaceBackupReplacementTestSupport.js';

const input = { targetWorkspaceId: workspaceId, containerPath: TEST_REPLACEMENT_CONTAINER_PATH, password: TEST_REPLACEMENT_PASSWORD };

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

describe('replacement coordinator with real binding slots and lease', () => {
  it('captures before the next await and publishes verified bytes before candidate work', async context => {
    const f = await fixture(context);
    const prepare = f.flow.rootStore.prepareCandidate.bind(f.flow.rootStore);
    f.flow.rootStore.prepareCandidate = async () => {
      expect(JSON.parse(await readFile(f.paths.currentPath, 'utf8'))).toMatchObject({ operationId, workspaceId });
      expect(f.flow.lifecycle.runningOwners).toBe(0);
      expect(f.flow.lifecycle.sqliteOwners).toBe(0);
      expect(f.lease.readState()).toBe('busy');
      await prepare();
    };
    await expect(f.flow.coordinator.replace(input)).resolves.toMatchObject({ workspaceId });
    expect(f.events.slice(0, 2)).toEqual(['lease.acquired', 'binding.captured']);
    expect(f.onUncertain).not.toHaveBeenCalled();
    expect(f.flow.runtimeHandoff.requests).toBe(1);
    expect(f.lease.readState()).toBe('idle');
  });

  for (const interruption of ['beforeNext', 'afterNext', 'lostAcknowledgement'] as const) {
    it(`preserves real slots after ${interruption} and skips cleanup or return`, async context => {
      const f = await fixture(context);
      const primary = new Error(`SYNTHETIC_${interruption}`);
      if (interruption === 'lostAcknowledgement') {
        const move = f.fileSystem.moveSlot.bind(f.fileSystem);
        f.fileSystem.moveSlot = async (...args) => { await move(...args); throw primary; };
      } else {
        const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
        f.fileSystem.createNextWriter = async guard => {
          if (interruption === 'beforeNext') throw primary;
          const writer = await open(guard);
          return { write: writer.write.bind(writer), readIdentity: () => writer.readIdentity!(),
            async sync() { await writer.sync(); throw primary; }, close: writer.close.bind(writer) };
        };
      }
      const error = await f.flow.coordinator.replace(input).catch(error => error as unknown);
      expect(hasCause(error, primary)).toBe(true);
      expect(f.flow.rootStore.prepared).toBe(false);
      expect(f.flow.rootStore.discarded).toBe(false);
      expect(f.flow.events).not.toContain('activation.rollback');
      expect(f.flow.runtimeHandoff.requests).toBe(0);
      expect(f.flow.lifecycle.runningOwners).toBe(0);
      expect(f.onUncertain).toHaveBeenCalledOnce();
      expect(f.lease.readState()).toBe('idle');
      const names = await readdir(f.paths.directoryPath);
      expect(names).toEqual(interruption === 'beforeNext' ? [] :
        [`${operationId}.json${interruption === 'afterNext' ? '.next' : ''}`]);
    });
  }

  for (const change of ['registryBytes', 'registryIdentity', 'bindingIdentity', 'bindingNext', 'lease', 'shutdown'] as const) {
    it(`rejects ${change} before the repairing recovery read and preserves observed files`, async context => {
      const f = await fixture(context);
      let preserved: Record<string, string> | undefined;
      let secondLease: WorkspaceMaintenanceLeaseHandle | undefined;
      const primary = new Error('SYNTHETIC_CANDIDATE_FAILED');
      const repair = vi.spyOn(f.flow.activation, 'read');
      f.flow.candidate.migrate = async () => {
        if (change === 'registryBytes') await writeFile(f.registryPath, ` ${await readFile(f.registryPath, 'utf8')}`, { mode: 0o600 });
        if (change === 'registryIdentity' || change === 'bindingIdentity') {
          const path = change === 'registryIdentity' ? f.registryPath : f.paths.currentPath;
          const bytes = await readFile(path);
          await rename(path, `${path}.preserved`);
          await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        }
        if (change === 'bindingNext') await writeFile(f.paths.nextPath, await readFile(f.paths.currentPath), { flag: 'wx', mode: 0o600 });
        if (change === 'lease') { await f.held()!.release(); secondLease = await f.lease.acquire('replace'); }
        if (change === 'shutdown') f.state.shutdown = true;
        preserved = await snapshot(f.root);
        throw primary;
      };
      try {
        const error = await f.flow.coordinator.replace(input).catch(error => error as unknown);
        expect(hasCause(error, primary)).toBe(true);
        expect(repair).not.toHaveBeenCalled();
        expect(f.flow.rootStore.discarded).toBe(false);
        expect(f.flow.events).not.toContain('activation.rollback');
        expect(f.flow.runtimeHandoff.requests).toBe(0);
        expect(f.onUncertain).toHaveBeenCalledOnce();
        expect(await snapshot(f.root)).toEqual(preserved);
        if (secondLease !== undefined) f.lease.captureCurrentOwner(['replace'], secondLease)();
      } finally { await secondLease?.release(); }
    });
  }

  it('joins the original writer close before releasing its lease after shutdown', async context => {
    const f = await fixture(context);
    const entered = gate(); const finish = gate();
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    let closed = false; let settled = false;
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { write: writer.write.bind(writer), readIdentity: () => writer.readIdentity!(), sync: writer.sync.bind(writer),
        async close() { entered.resolve(); await finish.promise; await writer.close(); closed = true; } };
    };
    const result = f.flow.coordinator.replace(input).then(() => undefined, error => error as unknown).finally(() => { settled = true; });
    try {
      expect(await Promise.race([entered.promise.then(() => 'entered'), result])).toBe('entered');
      f.state.shutdown = true;
      expect(settled).toBe(false); expect(closed).toBe(false);
      expect(f.lease.readState()).toBe('busy');
      expect(f.flow.runtimeHandoff.requests).toBe(0);
    } finally { finish.resolve(); await result; }
    expect(await result).toBeInstanceOf(Error);
    expect(closed).toBe(true); expect(f.lease.readState()).toBe('idle');
    expect(f.flow.rootStore.discarded).toBe(false);
    expect(f.flow.runtimeHandoff.requests).toBe(0);
  });

  for (const repair of ['removeSideSlots', 'promoteBackup'] as const) {
    it(`guards actual ${repair} repair when authority is lost inside the journal read`, async context => {
      const f = await fixture(context, true);
      const primary = new Error('SYNTHETIC_ACTIVATION_INTERRUPTED');
      const activation = f.activation();
      let preserved: Record<string, string> | undefined;
      // The actual factory is constructed when replace selects its target.
      const prepare = f.flow.rootStore.prepareCandidate.bind(f.flow.rootStore);
      f.flow.rootStore.prepareCandidate = async () => {
        await prepare();
        const authority = f.activation()!;
        vi.spyOn(authority.transaction, 'advanceToValidation').mockImplementation(async () => {
          const bytes = await readFile(f.activationPaths.activationJournalPath);
          await writeFile(`${f.activationPaths.activationJournalPath}.backup`, bytes, { mode: 0o600 });
          await writeFile(`${f.activationPaths.activationJournalPath}.next`, bytes, { mode: 0o600 });
          if (repair === 'promoteBackup') await rename(f.activationPaths.activationJournalPath,
            `${f.activationPaths.activationJournalPath}.retained`);
          preserved = await snapshot(f.root);
          vi.mocked(rename).mockClear(); vi.mocked(rm).mockClear();
          throw primary;
        });
        const read = authority.journalStore.read.bind(authority.journalStore);
        vi.spyOn(authority.journalStore, 'read').mockImplementation(async (expected, assertAuthority, assertMutationCurrent) => {
          let checks = 0;
          return read(expected, async () => {
            checks += 1;
            if (checks === (repair === 'promoteBackup' ? 1 : 2)) f.state.shutdown = true;
            await assertAuthority!();
          }, assertMutationCurrent);
        });
        vi.spyOn(authority.transaction, 'rollback');
      };
      expect(activation).toBeUndefined();
      const error = await f.flow.coordinator.replace(input).catch(error => error as unknown);
      expect(hasCause(error, primary)).toBe(true);
      expect(f.activation()!.journalStore.read).toHaveBeenCalledOnce();
      expect(f.activation()!.transaction.rollback).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled(); expect(rm).not.toHaveBeenCalled();
      expect(await snapshot(f.root)).toEqual(preserved);
      expect(f.flow.rootStore.discarded).toBe(false);
      expect(f.flow.runtimeHandoff.requests).toBe(0);
      expect(f.onUncertain).toHaveBeenCalledOnce();
      expect(f.lease.readState()).toBe('idle');
    });
  }

  it('still recovers an ordinary candidate failure under the verified receipt', async context => {
    const f = await fixture(context);
    f.flow.candidate.failure = 'migration';
    await expect(f.flow.coordinator.replace(input)).rejects.toMatchObject({ code: 'WORKSPACE_REPLACEMENT_MIGRATION_FAILED' });
    expect(f.flow.rootStore.discarded).toBe(true);
    expect(f.flow.runtimeHandoff.requests).toBe(1);
    expect(f.onUncertain).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(f.paths.currentPath, 'utf8'))).toMatchObject({ operationId, workspaceId });
    expect(f.lease.readState()).toBe('idle');
  });
});

async function fixture(context: TestContext, actualActivation = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-replacement-coordinator-binding-'));
  await chmod(root, 0o700);
  context.onTestFinished(() => { vi.restoreAllMocks(); });
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const paths = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceReplacement', operationId });
  const fileSystem = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceRemnantBindingBytes);
  const lease = new InMemoryWorkspaceMaintenanceLease();
  let held: WorkspaceMaintenanceLeaseHandle | undefined;
  const state = { shutdown: false };
  const events: string[] = [];
  const onUncertain = vi.fn<() => void>();
  const assertCurrent = () => { if (state.shutdown) throw new Error('SYNTHETIC_MAIN_SHUTDOWN'); };
  let activation: Readonly<WorkspaceReplacementActivationAuthority> | undefined;
  const activationFactory = new ProfileRestoreWorkspaceReplacementActivationFactory();
  const activationPaths = deriveWorkspaceBackupReplacementPaths(root, operationId, workspaceId);
  if (actualActivation) {
    for (const path of [activationPaths.activeDatabasePath, activationPaths.candidateDatabasePath]) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, 'synthetic database', { mode: 0o600 });
    }
    for (const path of [activationPaths.activeArtifactRoot, activationPaths.candidateArtifactRoot]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      await writeFile(join(path, 'synthetic.pdf'), '%PDF-synthetic', { mode: 0o600 });
    }
  }
  // Payload work and main ownership are modeled; receipt/registry I/O and lease identity are real.
  const flow = createWorkspaceBackupReplacementFixture({ userDataRoot: root,
    ...(actualActivation ? { activationAuthorityFactory: { create(paths: Parameters<typeof activationFactory.create>[0]) {
      activation = activationFactory.create(paths); return activation;
    } } } : {}), createBinding(input) {
    events.push('binding.captured');
    return new WorkspaceBackupReplacementBinding({ userDataRoot: root, ...input, maintenanceLease: lease, registry,
      mainOwner: { assertCurrent, async assertOwned() { assertCurrent(); } }, onUncertain,
      runtimeAbsence: { async assertNoActiveWorkspaceRuntime() {
        if (flow.lifecycle.runningOwners !== 0 || flow.lifecycle.sqliteOwners !== 0) throw new Error('SYNTHETIC_RUNTIME_PRESENT');
      } },
    }, fileSystem);
  } });
  await registry.write(flow.registry.value);
  flow.lease.acquire = async () => { held = await lease.acquire('replace'); events.push('lease.acquired'); return held; };
  return { root, registryPath, paths, fileSystem, lease, state, events, onUncertain, flow, held: () => held,
    activationPaths, activation: () => activation };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [child, bytes] of Object.entries(await snapshot(path))) result[`${entry.name}/${child}`] = bytes;
    } else result[entry.name] = (await readFile(path)).toString('hex');
  }
  return result;
}

function hasCause(error: unknown, expected: Error): boolean {
  return error === expected || error instanceof AggregateError && error.errors.some(item => hasCause(item, expected)) ||
    error instanceof Error && hasCause(error.cause, expected);
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
