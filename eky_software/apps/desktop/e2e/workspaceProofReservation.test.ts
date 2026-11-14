import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceCandidateReservationOwner } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { createWorkspaceFirstStartProofFactories, type WorkspaceFirstStartProofReservationScope } from './workspaceFirstStartMigrationProofFixtures.js';
import { runWorkspaceFirstStartMigrationProof } from './workspaceFirstStartMigrationProof.js';
import { runWorkspaceActivationMigrationProof } from './workspaceActivationMigrationProof.js';
import { provePublishedWorkspaceColdRecovery } from './workspacePublishedColdRecoveryProof.js';
import { ProofActiveWorkspaceLifecycle, ProofRuntimeRelaunch } from './workspaceManagementCompositionProofRuntime.js';
import { prepareWorkspaceRecoveryDeletionFixture } from './workspaceRecoveryDeletionFixture.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceBackupImportJournalStore } from '../src/workspaces/import/workspaceBackupImportJournalStore.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../src/workspaces/import/workspaceBackupImportJournalPaths.js';
import { createNodeWorkspaceBackupImportJournalFileSystem, type WorkspaceBackupImportJournalFileSystem } from '../src/workspaces/import/workspaceBackupImportJournalFileSystem.js';

const hooks = vi.hoisted(() => ({
  acquire: vi.fn(),
  hasLock: vi.fn(),
  paths: vi.fn(),
  metrics: vi.fn(),
  protocolHandled: vi.fn(),
  candidateStart: vi.fn(),
  owners: [] as WorkspaceCandidateReservationOwner[],
}));
vi.mock('electron', () => ({
  app: { hasSingleInstanceLock: hooks.hasLock, getAppMetrics: hooks.metrics },
  protocol: { isProtocolHandled: hooks.protocolHandled, unhandle: vi.fn() },
}));
vi.mock('../src/main/desktopComposition.js', () => ({
  acquireDesktopWorkspaceReservation: hooks.acquire,
  startDesktopComposition: vi.fn(),
}));
vi.mock('../src/workspaces/runtime/workspaceCandidateRuntimePaths.js', () => ({
  resolveWorkspaceCandidateRuntimePaths: hooks.paths,
}));
vi.mock('../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js', () => ({
  ElectronWorkspaceCandidateRuntimeFactory: class {
    constructor(options: { readonly reservationOwner: WorkspaceCandidateReservationOwner }) {
      hooks.owners.push(options.reservationOwner);
    }
    start = hooks.candidateStart;
  },
}));

let root: string;
let databaseDirectory: string;
let owner: ReturnType<typeof createOwner>;

describe('modeled proof deferred return', () => {
  it('keeps the modeled runtime absent until the real deferred completion guard succeeds', async () => {
    const lifecycle = new ProofActiveWorkspaceLifecycle(null);
    const relaunch = new ProofRuntimeRelaunch();
    relaunch.request(() => lifecycle.completeReturn(null));
    await lifecycle.assertNoActiveWorkspaceRuntime();
    expect(lifecycle.events).toEqual(['absent']);
    const guard = vi.fn(); relaunch.complete(guard);
    expect(guard).toHaveBeenCalledOnce();
    expect(lifecycle.events).toEqual(['absent', 'running']);
    relaunch.complete(guard);
    expect(guard).toHaveBeenCalledOnce();
  });

  it('burns a failed return before its guard and does not run the modeled continuation', () => {
    const relaunch = new ProofRuntimeRelaunch(); const resumed = vi.fn();
    const primary = new Error('SYNTHETIC_RETURN_OWNER_EXPIRED');
    relaunch.request(resumed);
    expect(() => relaunch.complete(() => { throw primary; })).toThrow(primary);
    relaunch.complete();
    expect(resumed).not.toHaveBeenCalled();
  });

  it('retains separate requests for successive modeled operations without repeating a completed return', () => {
    const relaunch = new ProofRuntimeRelaunch(); const first = vi.fn(); const second = vi.fn();
    relaunch.request(first); relaunch.complete();
    relaunch.request(second); relaunch.complete(); relaunch.complete();
    expect(relaunch.requestCount).toBe(2);
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  });
});

beforeEach(async () => {
  vi.resetAllMocks();
  hooks.owners.length = 0;
  hooks.hasLock.mockReturnValue(true);
  hooks.metrics.mockReturnValue([]);
  hooks.protocolHandled.mockReturnValue(false);
  root = await mkdtemp(join(tmpdir(), 'eky-proof-owner-'));
  databaseDirectory = join(root, 'backend', 'dist', 'database');
  const migrationsDirectory = join(databaseDirectory, 'migrations');
  await mkdir(migrationsDirectory, { recursive: true });
  await writeFile(join(migrationsDirectory, '001.sql'), 'SELECT 1;');
  await writeFile(join(migrationsDirectory, '002.sql'), 'SELECT 2;');
  hooks.paths.mockResolvedValue({
    backendRoot: join(root, 'backend'),
    migrationsDirectory,
    runnerPath: join(root, 'candidate.js'),
  });
  owner = createOwner();
  hooks.acquire.mockImplementation(async (options: { assertSingleInstanceOwnership(): void }) => {
    options.assertSingleInstanceOwnership();
    owner.assertMainOwned.mockImplementation(async () => options.assertSingleInstanceOwnership());
    return owner;
  });
});

afterEach(async context => {
  // No processes or real reservations are created in this orchestration fixture.
  if (context.task.result?.state !== 'fail') await rm(root, { recursive: true, force: true });
});

describe('recovery deletion interruption metadata fixture', () => {
  async function prepareMetadata(activeIsTarget = false) {
    const target = '11111111-1111-4111-8111-111111111111', previous = '22222222-2222-4222-8222-222222222222';
    const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
    const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
    await registry.write({ formatVersion: 2, activeWorkspaceId: activeIsTarget ? target : previous,
      workspaces: [target, previous].map((workspaceId, index) => ({ workspaceId,
        workspaceLabel: `Synthetic recovery ${index}`, createdAt: '2026-01-01T00:00:00.000Z',
        layoutVersion: 1, lifecycleState: 'ready', lineageIdentity: { formatVersion: 1, profileId: (index ? 'b' : 'a').repeat(64) } })) });
    let admission = true, main = true;
    const lost = new Error('SYNTHETIC_METADATA_PREPARATION_REVOKED');
    const input = { userDataRoot: root, workspaceId: target, backendIsRunning: () => false,
      assertAdmissionCurrent() { if (!admission) throw lost; }, assertMainCurrent() { if (!main) throw lost; } };
    const paths = createWorkspaceBackupImportJournalPaths(root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME));
    return { input, paths, target, previous, lost, registryPath,
      revoke(kind: 'admission' | 'ownership') { if (kind === 'admission') admission = false; else main = false; } };
  }

  it('publishes only reachable import metadata while preserving registry bytes', async () => {
    const f = await prepareMetadata();
    const before = await readFile(f.registryPath);
    await prepareWorkspaceRecoveryDeletionFixture(f.input);
    const slots = await new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: f.paths.currentPath }).inspectSlots();
    expect(slots.current?.value).toMatchObject({ formatVersion: 2, state: 'registryPublished',
      workspaceId: f.target, previousActiveWorkspaceId: f.previous });
    expect(slots.next).toBeUndefined(); expect(slots.backup).toBeUndefined();
    expect(await readFile(f.registryPath)).toEqual(before);
    expect(owner.close).toHaveBeenCalledOnce();
  });

  it('refuses a target that is its own previous active import workspace before journal creation', async () => {
    const f = await prepareMetadata(true);
    await expect(prepareWorkspaceRecoveryDeletionFixture(f.input)).rejects.toThrow('E2E_RECOVERY_DELETION_SELF_IMPORT');
    expect(await readFile(f.paths.currentPath).catch(() => undefined)).toBeUndefined();
    expect(owner.close).toHaveBeenCalledOnce();
  });

  it.each(['admission', 'ownership'] as const)('fences real store publication after %s is lost during its inner read', async kind => {
    const f = await prepareMetadata();
    const base = createNodeWorkspaceBackupImportJournalFileSystem(f.paths);
    let reads = 0, entered!: () => void, release!: () => void;
    const began = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const mutate = vi.fn();
    const fileSystem: WorkspaceBackupImportJournalFileSystem = {
      async readSlot(...args) {
        const value = await base.readSlot(...args);
        // Initial census, selected census, then the real store's guarded read.
        if (++reads === 7) { entered(); await held; }
        return value;
      },
      async prepareDirectory(guard) { mutate(); await base.prepareDirectory(guard); },
      async createNextWriter(guard) { mutate(); return base.createNextWriter(guard); },
      async moveSlot(...args) { mutate(); await base.moveSlot(...args); },
      async removeSlot(...args) { mutate(); return base.removeSlot(...args); },
      async syncDirectory(guard) { mutate(); await base.syncDirectory(guard); },
    };
    const work = prepareWorkspaceRecoveryDeletionFixture({ ...f.input, journalFileSystem: fileSystem });
    void work.catch(() => undefined);
    try {
      await Promise.race([began, work]);
      expect(reads).toBe(7);
      f.revoke(kind); release();
      const result = await work.catch(error => error);
      if (kind === 'admission') expect(result).toBe(f.lost);
      else expect(result).toMatchObject({ cause: f.lost, errors: [f.lost, f.lost] });
      expect(mutate).not.toHaveBeenCalled();
      for (const path of [f.paths.currentPath, f.paths.nextPath, f.paths.backupPath]) {
        expect(await readFile(path).catch(() => undefined)).toBeUndefined();
      }
      expect(owner.close).toHaveBeenCalledTimes(kind === 'admission' ? 1 : 0);
    } finally { release(); await work.catch(() => undefined); }
  });

  it.each(['none', 'reservation', 'writer'] as const)('closes an already started real slot write before native release (close failure: %s)', async closeFailure => {
    const f = await prepareMetadata();
    const base = createNodeWorkspaceBackupImportJournalFileSystem(f.paths);
    let entered!: () => void, release!: () => void, writerClosed = false;
    const began = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const cleanup = new Error('SYNTHETIC_METADATA_RESERVATION_CLOSE');
    const writerClose = new Error('SYNTHETIC_METADATA_WRITER_CLOSE');
    owner.close.mockImplementation(async () => {
      expect(writerClosed).toBe(true);
      if (closeFailure === 'reservation') throw cleanup;
    });
    const fileSystem: WorkspaceBackupImportJournalFileSystem = {
      readSlot: base.readSlot.bind(base), prepareDirectory: base.prepareDirectory.bind(base),
      moveSlot: base.moveSlot.bind(base), removeSlot: base.removeSlot.bind(base), syncDirectory: base.syncDirectory.bind(base),
      async createNextWriter(guard) {
        const writer = await base.createNextWriter(guard);
        return {
          async write(bytes) { const count = await writer.write(bytes); entered(); await held; return count; },
          sync: writer.sync.bind(writer), readIdentity: writer.readIdentity!.bind(writer),
          async close() {
            await writer.close(); writerClosed = true;
            // The caller cannot assume this acknowledgement means the handle closed.
            if (closeFailure === 'writer') throw writerClose;
          },
        };
      },
    };
    const work = prepareWorkspaceRecoveryDeletionFixture({ ...f.input, journalFileSystem: fileSystem });
    void work.catch(() => undefined);
    try {
      await Promise.race([began, work]);
      f.revoke('admission');
      expect(owner.close).not.toHaveBeenCalled(); expect(writerClosed).toBe(false);
      release();
      const result = await work.catch(error => error);
      if (closeFailure !== 'none') expect(result).toMatchObject({ cause: f.lost,
        errors: [f.lost, closeFailure === 'writer' ? writerClose : cleanup] });
      else expect(result).toBe(f.lost);
      expect(writerClosed).toBe(true);
      expect(owner.close).toHaveBeenCalledTimes(closeFailure === 'writer' ? 0 : 1);
      expect(await readFile(f.paths.currentPath).catch(() => undefined)).toBeUndefined();
      expect(await readFile(f.paths.backupPath).catch(() => undefined)).toBeUndefined();
      expect(JSON.parse((await readFile(f.paths.nextPath)).toString()).state).toBe('prepared');
    } finally { release(); await work.catch(() => undefined); }
  });

  it('retains the reservation when writer creation rejects without a returned close acknowledgement', async () => {
    const f = await prepareMetadata();
    const base = createNodeWorkspaceBackupImportJournalFileSystem(f.paths);
    const primary = new Error('SYNTHETIC_METADATA_WRITER_CREATION');
    const fileSystem: WorkspaceBackupImportJournalFileSystem = {
      readSlot: base.readSlot.bind(base), prepareDirectory: base.prepareDirectory.bind(base),
      moveSlot: base.moveSlot.bind(base), removeSlot: base.removeSlot.bind(base), syncDirectory: base.syncDirectory.bind(base),
      async createNextWriter(guard) {
        const writer = await base.createNextWriter(guard);
        // The fixture closes its handle; the caller receives no proof of that.
        await writer.close(); throw primary;
      },
    };
    await expect(prepareWorkspaceRecoveryDeletionFixture({ ...f.input, journalFileSystem: fileSystem })).rejects.toBe(primary);
    expect(owner.close).not.toHaveBeenCalled();
    expect(await readFile(f.paths.currentPath).catch(() => undefined)).toBeUndefined();
    expect((await readFile(f.paths.nextPath)).length).toBe(0);
  });
});

describe('candidate proof reservation scopes', () => {
  it.each([false, true])('retains published recovery first failure and reports secondary cleanup: %s', async cleanupFails => {
    const primary = new Error('SYNTHETIC_FIRST_FAILURE');
    hooks.candidateStart.mockRejectedValue(primary);
    if (cleanupFails) owner.close.mockRejectedValue(new Error('secondary cleanup'));
    const result = provePublishedWorkspaceColdRecovery({
      appVersion: '0.2.81', resourcesPath: root, userDataRoot: root,
    });
    if (cleanupFails) {
      await expect(result).rejects.toMatchObject({
        message: 'WORKSPACE_PUBLISHED_COLD_RECOVERY_CLEANUP_FAILED', cause: primary,
      });
    } else await expect(result).rejects.toBe(primary);
    expect(await retainedPrefixes()).toHaveLength(1);
    expect((await readdir(root)).includes('c')).toBe(true);
  });
  it('shares one real-owner port between both factories and closes before returning', async () => {
    const factories = await prepare();
    const events: string[] = [];
    owner.assertMainOwned.mockImplementation(async () => { events.push('absence'); });
    hooks.acquire.mockResolvedValue(owner);
    owner.close.mockImplementation(async () => { events.push('close'); });
    await factories.withWorkspaceReservation(root, async () => {
      events.push('use');
      expect(hooks.owners).toHaveLength(2);
      expect(hooks.owners[0]).toBe(hooks.owners[1]);
      hooks.owners[0]!.bindCandidate({ generationId: 'generation', operationId: 'operation' });
    });
    events.push('returned');
    expect(events).toEqual(['use', 'absence', 'close', 'returned']);
    expect(hooks.acquire).toHaveBeenCalledWith(expect.objectContaining({ userDataRoot: root }));
    expect(owner.bind).toHaveBeenCalledWith('generation', expect.any(Function));
    await factories.cleanup();
    expect(await retainedPrefixes()).toEqual([]);
    await expect(factories.withWorkspaceReservation(root, async () => {})).rejects.toThrow();
  });

  it('rejects overlap and cleanup while a scope is active without acquiring another owner', async () => {
    const factories = await prepare();
    await factories.withWorkspaceReservation(root, async () => {
      await expect(factories.withWorkspaceReservation(root, async () => {})).rejects.toThrow();
      await expect(factories.cleanup()).rejects.toThrow();
      expect(hooks.acquire).toHaveBeenCalledTimes(1);
      expect(await retainedPrefixes()).toHaveLength(1);
    });
    await factories.cleanup();
  });

  it('reacquires for the next root but rejects authority captured by the previous scope', async () => {
    const factories = await prepare();
    let previousScope: Readonly<WorkspaceFirstStartProofReservationScope>;
    await factories.withWorkspaceReservation(root, async scope => { previousScope = scope; });
    const previous = hooks.owners[0]!;
    await factories.withWorkspaceReservation(join(root, 'next'), async () => {
      const before = await readdir(root, { recursive: true });
      expect(() => previous.bindCandidate({ generationId: 'old', operationId: 'old' })).toThrow();
      await expect(previousScope!.createCurrentFixture()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(() => previousScope!.assertCurrent()).toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      await expect(previousScope!.assertMainOwned()).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
      expect(await readdir(root, { recursive: true })).toEqual(before);
      expect(hooks.acquire).toHaveBeenLastCalledWith(expect.objectContaining({ userDataRoot: join(root, 'next') }));
    });
    expect(owner.close).toHaveBeenCalledTimes(2);
  });

  it('rechecks the current proof scope after its physical ownership read completes', async () => {
    const factories = await prepare();
    let finish!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const began = new Promise<void>(resolve => { entered = resolve; });
    owner.assertMainOwned.mockImplementationOnce(async () => { entered(); await gate; });
    const work = factories.withWorkspaceReservation(root, async scope => {
      scope.assertCurrent();
      await scope.assertMainOwned();
      throw new Error('STALE_SCOPE_ACCEPTED');
    });
    const rejected = expect(work).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    try { await began; hooks.hasLock.mockReturnValue(false); }
    finally { finish(); }
    await rejected;
    expect(owner.close).not.toHaveBeenCalled();
    await expect(factories.cleanup()).rejects.toThrow();
  });

  it('uses the current Electron single-instance state for every grant', async () => {
    const factories = await prepare();
    await expect(factories.withWorkspaceReservation(root, async () => {
      hooks.hasLock.mockReturnValue(false);
      hooks.owners[0]!.bindCandidate({ generationId: 'generation', operationId: 'operation' });
    })).rejects.toThrow('WORKSPACE_PROCESS_RESERVATION_FAILED');
    expect(owner.close).not.toHaveBeenCalled();
    expect(await retainedPrefixes()).toHaveLength(1);
  });

  it('preserves the primary failure and the prefix even when reclaimed ownership can close', async () => {
    const factories = await prepare();
    const primary = new Error('synthetic first failure');
    await expect(factories.withWorkspaceReservation(root, async () => { throw primary; })).rejects.toBe(primary);
    expect(owner.assertMainOwned).toHaveBeenCalledTimes(1);
    expect(owner.close).toHaveBeenCalledTimes(1);
    expect(factories.reservationCleanupFailed).toBe(false);
    await expect(factories.cleanup()).rejects.toThrow();
    expect(await retainedPrefixes()).toHaveLength(1);
    await expect(factories.withWorkspaceReservation(root, async () => {})).rejects.toThrow();
    expect(hooks.acquire).toHaveBeenCalledTimes(1);
  });

  it.each(['absence', 'close'] as const)('fails success and retains evidence when %s cannot be proved', async (phase) => {
    const factories = await prepare();
    const failure = new Error(`synthetic ${phase} failure`);
    hooks.acquire.mockResolvedValue(owner);
    (phase === 'absence' ? owner.assertMainOwned : owner.close).mockRejectedValue(failure);
    await expect(factories.withWorkspaceReservation(root, async () => 'success')).rejects.toBe(failure);
    expect(factories.reservationCleanupFailed).toBe(true);
    if (phase === 'absence') expect(owner.close).not.toHaveBeenCalled();
    await expect(factories.cleanup()).rejects.toThrow();
    expect(await retainedPrefixes()).toHaveLength(1);
    await expect(factories.withWorkspaceReservation(root, async () => {})).rejects.toThrow();
  });

  it('does not replace a callback failure with a secondary cleanup failure', async () => {
    const factories = await prepare();
    const primary = new Error('primary');
    hooks.acquire.mockResolvedValue(owner);
    owner.assertMainOwned.mockRejectedValue(new Error('secondary'));
    await expect(factories.withWorkspaceReservation(root, async () => { throw primary; })).rejects.toBe(primary);
    expect(factories.reservationCleanupFailed).toBe(true);
    expect(owner.close).not.toHaveBeenCalled();
    expect(await retainedPrefixes()).toHaveLength(1);
  });

  it('does not construct factories or authorize cleanup after acquisition failure', async () => {
    const factories = await prepare();
    hooks.acquire.mockRejectedValue(new Error('acquisition failed'));
    const use = vi.fn();
    await expect(factories.withWorkspaceReservation(root, use)).rejects.toThrow('acquisition failed');
    expect(use).not.toHaveBeenCalled();
    expect(hooks.owners).toHaveLength(0);
    expect(owner.close).not.toHaveBeenCalled();
    await expect(factories.cleanup()).rejects.toThrow();
    expect(await retainedPrefixes()).toHaveLength(1);
  });
});

describe.each([
  ['first-start', runWorkspaceFirstStartMigrationProof, 'shutdownCleanupFailed'],
  ['activation', runWorkspaceActivationMigrationProof, 'cleanupFailed'],
] as const)('%s proof failure cleanup', (_name, run, checkpoint) => {
  it.each(['process-observation', 'protocol', 'both'])(
    'preserves the first failure and evidence when %s cleanup throws', async (failure) => {
      hooks.paths.mockRejectedValue(new Error('SYNTHETIC_FIRST_FAILURE'));
      if (failure !== 'protocol') {
        hooks.metrics.mockImplementationOnce(() => []).mockImplementation(() => {
          throw new Error('secondary process observation failure');
        });
      }
      if (failure !== 'process-observation') {
        hooks.protocolHandled.mockImplementation(() => { throw new Error('secondary protocol failure'); });
      }
      const startBackend = vi.fn();
      const observe = vi.fn();
      await expect(run({
        applicationPath: root, appVersion: '0.2.81', resourcesPath: root,
        runtimeSessionSecret: 'synthetic-test-secret', startBackend, userDataRoot: root,
        observe,
      })).rejects.toThrow('SYNTHETIC_FIRST_FAILURE');
      expect(startBackend).not.toHaveBeenCalled();
      expect(hooks.metrics).toHaveBeenCalledTimes(2);
      const proofRoots = (await readdir(root)).filter(name => /^(w6-|a3-)/u.test(name));
      expect(proofRoots).toHaveLength(1);
      const progress = await readFile(join(root, proofRoots[0]!, 'progress.jsonl'), 'utf8');
      expect(progress).toContain(checkpoint);
      expect(progress).not.toContain('secondary');
      if (_name === 'first-start') expect(observe).toHaveBeenLastCalledWith('proofFinallyReturned');
    },
  );
});

function prepare() {
  return createWorkspaceFirstStartProofFactories({
    appVersion: '0.2.81', buildRevision: 'a'.repeat(40), resourcesPath: root,
  });
}

function createOwner() {
  return {
    assertMainCurrent: vi.fn(() => {}),
    assertMainOwned: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    bind: vi.fn((generationId: string, assertAuthority: () => void) => {
      assertAuthority();
      return { generationId };
    }),
  };
}

async function retainedPrefixes() {
  return (await readdir(databaseDirectory)).filter(name => name.startsWith('e2e-workspace-first-start-prefix-'));
}
