import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { RecoveryPointCleanShutdownMarker } from '../profileBackup/recoveryPoint/recoveryPointCleanShutdownMarker.js';
import { RecoveryPointScheduler } from '../profileBackup/recoveryPoint/recoveryPointScheduler.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { createWorkspaceDeletionMarkerBoundary } from './workspaceDeletionMarkerBoundary.js';

it('skips a queued actual marker write and never recreates the removed root', async context => {
  const f = await fixture(context);
  const queued = f.boundary.persistCleanShutdown();
  const draining = f.boundary.sealActiveMarker();
  await Promise.all([queued, draining]);
  expect(f.markClean).not.toHaveBeenCalled();
  await rm(f.profile, { recursive: true });
  f.boundary.recordActiveRemoved();
  await f.boundary.persistCleanShutdown();
  await f.assertAbsent();
});

it.for(['success', 'failure'] as const)('joins a begun real scheduler/marker write before publication (%s)', async (outcome, context) => {
  const f = await fixture(context);
  const entered = deferred();
  const finish = deferred();
  const mark = f.markClean.getMockImplementation()!;
  f.markClean.mockImplementationOnce(async completedAt => {
    await mark(completedAt); // Real marker bytes exist, but this owned write has not settled.
    entered.resolve(); await finish.promise;
    if (outcome === 'failure') throw new Error('SYNTHETIC_MARKER_COMPLETION_FAILED');
  });
  const writing = f.boundary.persistCleanShutdown();
  void writing.catch(() => undefined);
  let draining: Promise<void> | undefined;
  let published = false;
  try {
    await Promise.race([entered.promise, writing.then(() => { throw new Error('WRITER_NOT_ENTERED'); })]);
    await expect(readFile(f.markerPath, 'utf8')).resolves.toContain('"formatVersion":1');
    draining = f.boundary.sealActiveMarker().then(() => { published = true; });
    void draining.catch(() => undefined);
    expect(() => f.boundary.recordActiveRemoved()).toThrow();
    await Promise.resolve();
    expect(published).toBe(false);
    finish.resolve();
    if (outcome === 'failure') {
      await expect(writing).rejects.toMatchObject({ firstFailure: { phase: 'cleanMarker', reason: 'operationFailed' } });
      await expect(draining).rejects.toThrow();
      await expect(f.boundary.sealActiveMarker()).rejects.toThrow();
      await expect(f.boundary.persistCleanShutdown()).rejects.toThrow();
      expect(() => f.boundary.recordActiveRemoved()).toThrow();
      expect(published).toBe(false);
      expect(f.markClean).toHaveBeenCalledOnce();
      await expect(readFile(f.markerPath)).resolves.toBeInstanceOf(Buffer);
    } else {
      await writing; await draining;
      expect(published).toBe(true);
      await rm(f.profile, { recursive: true });
      await expect(f.boundary.persistCleanShutdown()).rejects.toThrow();
      await f.assertAbsent();
      f.boundary.recordActiveRemoved();
      await f.boundary.persistCleanShutdown();
      await f.assertAbsent();
    }
  } finally {
    finish.resolve();
    await Promise.allSettled([writing, ...(draining === undefined ? [] : [draining])]);
  }
});

it('preserves one ordinary clean write without a deletion seal', async context => {
  const f = await fixture(context);
  const first = f.boundary.persistCleanShutdown();
  expect(f.boundary.persistCleanShutdown()).toBe(first);
  await first;
  await f.boundary.persistCleanShutdown();
  expect(f.markClean).toHaveBeenCalledOnce();
  await expect(f.marker.consume()).resolves.toBe('clean');
  expect(() => f.boundary.recordActiveRemoved()).toThrow();
});

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-deletion-marker-'));
  const profile = join(root, 'workspace');
  await mkdir(profile);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true });
  });
  const markerPath = join(profile, 'runtime', 'recovery-point-state', 'clean-shutdown-v1.json');
  const marker = new RecoveryPointCleanShutdownMarker(markerPath);
  const markClean = vi.fn(marker.markClean.bind(marker));
  const scheduler = new RecoveryPointScheduler({
    cleanShutdownMarker: { consume: () => marker.consume(), markClean: completedAt => markClean(completedAt) },
    maintenanceLease: new InMemoryWorkspaceMaintenanceLease(),
    recoveryPointService: { async checkAutomatic() {} },
  });
  const boundary = createWorkspaceDeletionMarkerBoundary(scheduler);
  return { marker, markerPath, profile, markClean, boundary, async assertAbsent() {
    await expect(readdir(profile)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const slot of [markerPath, `${markerPath}.next`, `${markerPath}.backup`]) {
      await expect(readFile(slot)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
