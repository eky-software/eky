import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceCandidateReservationOwner } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { createWorkspaceFirstStartProofFactories, type WorkspaceFirstStartProofReservationScope } from './workspaceFirstStartMigrationProofFixtures.js';
import { runWorkspaceFirstStartMigrationProof } from './workspaceFirstStartMigrationProof.js';
import { runWorkspaceActivationMigrationProof } from './workspaceActivationMigrationProof.js';
import { provePublishedWorkspaceColdRecovery } from './workspacePublishedColdRecoveryProof.js';

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

afterEach(async () => {
  // No processes or real reservations are created in this orchestration fixture.
  await rm(root, { recursive: true, force: true });
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
      expect(await readdir(root, { recursive: true })).toEqual(before);
      expect(hooks.acquire).toHaveBeenLastCalledWith(expect.objectContaining({ userDataRoot: join(root, 'next') }));
    });
    expect(owner.close).toHaveBeenCalledTimes(2);
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
