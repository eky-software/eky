import { createHash, randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import { writeBackupContainer } from './container/backupContainerWriter.js';
import { inspectOwnedEncryptedProfileBackup, OwnedProfileBackupInspectionError } from './inspectOwnedEncryptedProfileBackup.js';
import type { runProfileSnapshotInspection } from './runProfileSnapshotInspection.js';

const inspection = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock('./runProfileSnapshotInspection.js', () => ({ runProfileSnapshotInspection: inspection.run }));

const roots: string[] = [];
const profileId = 'a'.repeat(64);
const migrationChainIdentity = 'b'.repeat(64);
const password = 'Synthetic owned backup inspection password!';

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  inspection.run.mockReset();
  await Promise.all(roots.splice(0).map(root => fileSystem.rm(root, { force: true, recursive: true })));
});

describe('owned encrypted backup inspect consumer', () => {
  it('keeps the actual extracted root owned until summary use and removal have finished', async () => {
    const f = await fixture();
    const events: string[] = [];
    inspection.run.mockImplementation(async (request: Parameters<typeof runProfileSnapshotInspection>[0]) => {
      expect(request.operationId).toBe(f.input.operationId);
      expect(request.kind).toBe('inspect');
      expect(request.migrationPolicy).toBe('restoreCompatible');
      expect(request.reservation).toBe(f.owner);
      await expect(fileSystem.readFile(join(f.operationRoot, 'profile.sqlite'), 'utf8')).resolves.toBe('synthetic sqlite');
      events.push('inspectExitedAndReclaimed');
      return result();
    });
    f.owner.assertMainOwned.mockImplementation(async () => { events.push('mainOwned'); });
    f.owner.close.mockImplementation(async () => {
      await expect(fileSystem.lstat(f.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      events.push('close');
    });
    const value = await inspectOwnedEncryptedProfileBackup(f.input);
    expect(value.summary).toEqual({ appVersion: '0.1.0-alpha.1', compatibilityStatus: 'compatible',
      createdAt: '2026-04-04T00:00:00.000Z', databaseHealth: 'healthy', documentCount: 0,
      formatVersion: 1, profileMatchStatus: 'same', totalBusinessByteSize: 0 });
    expect(Object.keys(value)).toEqual(['containerSha256', 'summary']);
    expect(JSON.stringify(value.summary)).not.toContain(profileId);
    expect(events).toEqual(['inspectExitedAndReclaimed', 'mainOwned', 'close']);
    expect(f.owner.invalidate).not.toHaveBeenCalled();
    await expect(fileSystem.readdir(f.input.quarantineRoot)).resolves.toEqual([]);
  });

  it('does not acquire a root or start an inspector for an unauthenticated container', async () => {
    const f = await fixture();
    await expect(inspectOwnedEncryptedProfileBackup({ ...f.input, password: 'Different synthetic password!' }))
      .rejects.toMatchObject({ code: 'BACKUP_AUTHENTICATION_FAILED' });
    expect(f.input.acquireReservation).not.toHaveBeenCalled();
    expect(inspection.run).not.toHaveBeenCalled();
    await expect(fileSystem.readdir(f.input.stagingRoot)).resolves.toEqual([]);
  });

  it('cleans a manifest mismatch only through a current reclaimed root owner', async () => {
    const f = await fixture();
    inspection.run.mockResolvedValue(result('c'.repeat(64)));
    const error = await rejected(inspectOwnedEncryptedProfileBackup(f.input));
    expect(error).toMatchObject({ code: 'BACKUP_CONTENT_INVALID', cleanupStatus: 'completed',
      cause: { cause: { message: 'BACKUP_MANIFEST_IDENTITY_INVALID' } } });
    expect(f.owner.assertMainOwned).toHaveBeenCalledOnce();
    expect(f.owner.close).toHaveBeenCalledOnce();
    await expect(fileSystem.lstat(f.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the first schema failure independently from proven safe cleanup', async () => {
    const f = await fixture();
    const first = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent: true, reservationReclaimed: true, forced: false });
    inspection.run.mockRejectedValue(first);
    const error = await rejected(inspectOwnedEncryptedProfileBackup(f.input));
    expect(error).toMatchObject({ code: 'BACKUP_CONTENT_INVALID', cleanupStatus: 'completed' });
    expect((error.cause as Error).cause).toBe(first);
    await expect(fileSystem.lstat(f.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { processAbsent: false, reservationReclaimed: false, forced: true },
    { processAbsent: true, reservationReclaimed: false, forced: true },
  ])('never deletes or releases staging without both exit and reclaim: %j', async cleanup => {
    const f = await fixture();
    const first = new ProfileInspectionProcessError('PROFILE_INSPECTION_TIMEOUT', cleanup);
    inspection.run.mockRejectedValue(first);
    const error = await rejected(inspectOwnedEncryptedProfileBackup(f.input));
    expect(error.cleanupStatus).toBe('unverified');
    expect((error.cause as Error).cause).toBe(first);
    expect(f.owner.assertMainOwned).not.toHaveBeenCalled();
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(f.owner.invalidate).toHaveBeenCalledOnce();
    await expect(fileSystem.readFile(join(f.operationRoot, 'profile.sqlite'), 'utf8')).resolves.toBe('synthetic sqlite');
  });

  it('preserves staging when a root could not be acquired; absence of a handle is not authority', async () => {
    const f = await fixture();
    f.input.acquireReservation.mockRejectedValue(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    expect(await rejected(inspectOwnedEncryptedProfileBackup(f.input))).toMatchObject({ cleanupStatus: 'unverified' });
    expect(inspection.run).not.toHaveBeenCalled();
    await expect(fileSystem.lstat(f.operationRoot)).resolves.toBeDefined();
  });

  it('does not delete a changed root after an otherwise successful inspection', async () => {
    const f = await fixture();
    f.owner.assertMainOwned.mockRejectedValue(new Error('rootChanged'));
    const error = await rejected(inspectOwnedEncryptedProfileBackup(f.input));
    expect(error).toMatchObject({ code: 'BACKUP_INSPECTION_UNAVAILABLE', cleanupStatus: 'unverified' });
    expect(f.owner.close).not.toHaveBeenCalled();
    await expect(fileSystem.lstat(f.operationRoot)).resolves.toBeDefined();
  });

  it('does not replace the first failure when cleanup and invalidation also fail', async () => {
    const f = await fixture();
    const first = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent: true, reservationReclaimed: true, forced: false });
    inspection.run.mockRejectedValue(first);
    f.owner.assertMainOwned.mockRejectedValue(new Error('rootChanged'));
    f.owner.invalidate.mockImplementation(() => { throw new Error('secondaryPrivateDetail'); });
    const error = await rejected(inspectOwnedEncryptedProfileBackup(f.input));
    expect((error.cause as Error).cause).toBe(first);
    expect(error.cleanupStatus).toBe('unverified');
    expect(String(error)).not.toContain('secondaryPrivateDetail');
    await expect(fileSystem.lstat(f.operationRoot)).resolves.toBeDefined();
  });

  it('reports a failed reservation release separately from inspection success', async () => {
    const f = await fixture();
    f.owner.close.mockRejectedValue(new Error('releaseFailed'));
    expect(await rejected(inspectOwnedEncryptedProfileBackup(f.input))).toMatchObject({
      code: 'BACKUP_INSPECTION_UNAVAILABLE', cleanupStatus: 'unverified',
    });
    expect(f.owner.invalidate).toHaveBeenCalledOnce();
  });

  it('shares the original inspection deadline with root acquisition', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['performance'] });
    const acquiredAt = performance.now();
    f.input.acquireReservation.mockImplementation(async () => {
      vi.setSystemTime(new Date());
      // Native acquisition consumed part of the work budget, not a separate budget.
      vi.spyOn(performance, 'now').mockReturnValue(acquiredAt + 12_000);
      return f.owner;
    });
    await inspectOwnedEncryptedProfileBackup(f.input);
    expect(inspection.run.mock.calls[0]![0].deadline).toBe(acquiredAt + 35_000);
  });

  it('does not grant work after cancellation during native acquisition', async () => {
    const f = await fixture();
    f.input.acquireReservation.mockImplementation(async () => {
      f.cancellation.abort();
      return f.owner;
    });
    expect(await rejected(inspectOwnedEncryptedProfileBackup(f.input))).toMatchObject({ cleanupStatus: 'unverified' });
    expect(inspection.run).not.toHaveBeenCalled();
    expect(f.owner.close).not.toHaveBeenCalled();
    await expect(fileSystem.lstat(f.operationRoot)).resolves.toBeDefined();
  });

  it('bounds a pending native acquisition and never uses its late ownership handle', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    let entered!: () => void;
    let release!: (owner: typeof f.owner) => void;
    const acquisitionEntered = new Promise<void>(resolve => { entered = resolve; });
    const acquisitionResult = new Promise<typeof f.owner>(resolve => { release = resolve; });
    f.input.acquireReservation.mockImplementation(() => {
      entered(); return acquisitionResult;
    });
    const outcome = rejected(inspectOwnedEncryptedProfileBackup(f.input));
    await acquisitionEntered;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await outcome).toMatchObject({ cleanupStatus: 'unverified',
      cause: { cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } } });
    release(f.owner);
    await vi.advanceTimersByTimeAsync(0);
    expect(inspection.run).not.toHaveBeenCalled();
    expect(f.owner.invalidate).toHaveBeenCalledOnce();
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await expect(fileSystem.lstat(f.operationRoot)).resolves.toBeDefined();
  });

  it('rejects ownership when the deadline passes between acquisition observation and await continuation', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    f.input.acquireReservation.mockImplementation(async () => {
      const beforeDeadline = performance.now();
      let observed = false;
      vi.spyOn(performance, 'now').mockImplementation(() => {
        if (!observed) { observed = true; return beforeDeadline; }
        return beforeDeadline + 35_000;
      });
      return f.owner;
    });
    const error = await rejected(inspectOwnedEncryptedProfileBackup(f.input));
    expect(error).toMatchObject({ cleanupStatus: 'unverified',
      cause: { cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } } });
    expect(inspection.run).not.toHaveBeenCalled();
    expect(f.owner.assertMainOwned).not.toHaveBeenCalled();
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(f.owner.invalidate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(fileSystem.lstat(f.operationRoot)).resolves.toBeDefined();
  });

  it('does not delete staging when an ownership assertion resolves after the cleanup cutoff', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    let entered!: () => void;
    let release!: () => void;
    const guardEntered = new Promise<void>(resolve => { entered = resolve; });
    const guardResult = new Promise<void>(resolve => { release = resolve; });
    f.owner.assertMainOwned.mockImplementation(() => { entered(); return guardResult; });
    const outcome = rejected(inspectOwnedEncryptedProfileBackup(f.input));
    await guardEntered;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await outcome).toMatchObject({ cleanupStatus: 'unverified' });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await expect(fileSystem.lstat(f.operationRoot)).resolves.toBeDefined();
  });
});

async function fixture() {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-owned-backup-inspect-'));
  roots.push(root);
  const stagingRoot = join(root, 'staging');
  const quarantineRoot = join(root, 'quarantine');
  await fileSystem.mkdir(stagingRoot, { mode: 0o700 });
  await fileSystem.mkdir(quarantineRoot, { mode: 0o700 });
  const operationId = randomUUID();
  const operationRoot = join(stagingRoot, operationId);
  const containerPath = join(root, 'synthetic.ekybackup');
  const contents = [
    ['profile.sqlite', 'synthetic sqlite', 'database'],
    ['snapshot-catalog-v1.json', '{"artifacts":[],"formatVersion":1}', 'artifactCatalog'],
  ] as const;
  const entries = [];
  for (const [logicalPath, content, type] of contents) {
    const sourcePath = join(root, logicalPath);
    await fileSystem.writeFile(sourcePath, content);
    entries.push({ logicalPath, type, sourcePath, contentLength: BigInt(Buffer.byteLength(content)),
      sha256: createHash('sha256').update(content).digest('hex') });
  }
  await writeBackupContainer({ destinationPath: containerPath, entries, password,
    manifest: { appVersion: '0.1.0-alpha.1', createdAtEpochMilliseconds: 1_775_260_800_000n,
      profileId, migrationChainIdentity } });
  const owner = {
    assertMainOwned: vi.fn(async () => {}), invalidate: vi.fn(() => {}), close: vi.fn(async () => {}),
    bind: vi.fn(() => { throw new Error('notUsedByConsumerUnitTest'); }),
  };
  const cancellation = new AbortController();
  inspection.run.mockResolvedValue(result());
  const input = { containerPath, operationId, password, stagingRoot, quarantineRoot,
    runnerPath: join(root, 'fixed-inspection-runner.js'),
    deployment: { backendRoot: join(root, 'backend'), migrationsDirectory: join(root, 'migrations'), nativeResourceRoot: join(root, 'native') },
    readActiveContext: async () => ({ activeProfileId: profileId, activeProfileIsEmpty: false }),
    assertAuthority: () => {}, signal: cancellation.signal,
    acquireReservation: vi.fn(async (_input: { operationRoot: string; signal: AbortSignal }) => owner) };
  return { input, owner, operationRoot, cancellation };
}

function result(inspectedProfileId = profileId) {
  return { validation: {
    type: 'profileSnapshotValidation' as const, activeProfileIsEmpty: false, artifactCount: 0,
    artifactTotalByteSize: 0, databaseHealth: 'healthy' as const, migrationChainIdentity,
    profileId: inspectedProfileId, profileMatchesActive: inspectedProfileId === profileId,
  } };
}

async function rejected(task: Promise<unknown>): Promise<OwnedProfileBackupInspectionError> {
  const error: unknown = await task.catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(OwnedProfileBackupInspectionError);
  return error as OwnedProfileBackupInspectionError;
}
