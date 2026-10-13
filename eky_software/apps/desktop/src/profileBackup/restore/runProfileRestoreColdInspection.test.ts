import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  profileInspectionWorkMilliseconds, type ColdProfileInspectionReceipt, type ProfileInspectionColdSources,
} from '../../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../../runtime/profileInspectionProcess.js';
import type { WorkspaceProcessReservationTransfer } from '../../runtime/workspaceProcessReservation.js';
import { runProfileRestoreColdInspection } from './runProfileRestoreColdInspection.js';

const boundary = vi.hoisted(() => ({ run: vi.fn() }));
const bindings = vi.hoisted(() => ({ read: vi.fn() }));
const copy = vi.hoisted(() => ({ prepare: vi.fn(), discard: vi.fn(), roots: [] as string[] }));
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock('../../runtime/profileInspectionDocumentBindingsFile.js', () => ({ readProfileInspectionDocumentBindings: bindings.read }));
vi.mock('../../runtime/profileInspectionProcess.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../runtime/profileInspectionProcess.js')>(),
  async runColdProfileInspectionProcess(options: Parameters<typeof import('../../runtime/profileInspectionProcess.js')['runColdProfileInspectionProcess']>[0]) {
    await options.reservationTransfer.prepare(options.signal);
    return boundary.run(options);
  },
  runProfileInspectionProcess: vi.fn(() => { throw new Error('portable operation forbidden'); }),
}));
vi.mock('../../workspaces/runtime/workspaceCandidateInspectionCopy.js', () => ({
  WorkspaceCandidateInspectionCopy: class {
    constructor(readonly root: string) { copy.roots.push(root); }
    prepare(signal: AbortSignal) { return copy.prepare(signal); }
    discardAfterExit(assertMainOwned: () => Promise<void>, signal: AbortSignal) {
      return copy.discard(assertMainOwned, signal);
    }
  },
}));

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profileId = 'a'.repeat(64);
const sources: ProfileInspectionColdSources = {
  workspaceRoot: resolve('synthetic-workspace'), databaseSlot: 'staged', documentsSlot: 'active',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  boundary.run.mockReset().mockResolvedValue(receipt());
  bindings.read.mockReset().mockResolvedValue(Object.freeze([]));
  copy.prepare.mockReset().mockResolvedValue(undefined);
  copy.discard.mockReset().mockResolvedValue(undefined);
  copy.roots.length = 0;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('owned cold inspection caller', () => {
  it('prepares its own copy, waits for exit/reclaim, then checks fresh sources and trusted lineage', async () => {
    const pending = deferred<ColdProfileInspectionReceipt>();
    const f = fixture();
    boundary.run.mockImplementationOnce(() => pending.promise);
    const task = f.start();
    await flush();
    expect(copy.prepare).toHaveBeenCalledOnce();
    expect(copy.discard).not.toHaveBeenCalled();
    expect(bindings.read).not.toHaveBeenCalled();
    expect(f.readSources).toHaveBeenCalledOnce();
    expect(f.assertLineage).not.toHaveBeenCalled();
    const options = boundary.run.mock.calls[0]![0];
    expect(options.sources).toEqual(sources);
    expect(Object.isFrozen(options.sources)).toBe(true);
    expect(copy.roots).toEqual([resolve('synthetic-staging', `profile-inspection-${options.identity.generationId}`)]);
    pending.resolve(receipt());
    const result = await task;
    expect(result).toEqual({ receipt: receipt(), documents: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(copy.discard).toHaveBeenCalledOnce();
    expect(bindings.read).toHaveBeenCalledOnce();
    expect(bindings.read.mock.invocationCallOrder[0]).toBeLessThan(copy.discard.mock.invocationCallOrder[0]!);
    expect(bindings.read.mock.calls[0]![0]).toBe(copy.roots[0]);
    expect(copy.discard.mock.invocationCallOrder[0]).toBeLessThan(f.readSources.mock.invocationCallOrder[1]!);
    expect(f.readSources).toHaveBeenCalledTimes(2);
    expect(f.assertLineage).toHaveBeenCalledTimes(2);
    expect(f.assertLineage.mock.calls).toEqual([[profileId], [profileId]]);
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['workspaceRoot', 'databaseSlot', 'documentsSlot'] as const)('rejects a changed %s after native work', async key => {
    const f = fixture();
    const changed = { ...sources, [key]: key === 'workspaceRoot' ? resolve('foreign-workspace')
      : sources[key] === 'active' ? 'staged' : 'active' };
    f.readSources.mockResolvedValueOnce(sources).mockResolvedValueOnce(changed as ProfileInspectionColdSources);
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(f.assertLineage).not.toHaveBeenCalled();
    expect(copy.discard).toHaveBeenCalledOnce();
    expect(f.invalidate).not.toHaveBeenCalled();
  });

  it('does not keep a mutable source object as native admission', async () => {
    const f = fixture();
    const mutable = { ...sources };
    f.readSources.mockResolvedValue(mutable);
    boundary.run.mockImplementationOnce(async options => {
      mutable.databaseSlot = 'active';
      expect(options.sources.databaseSlot).toBe('staged');
      return receipt();
    });
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
  });

  it.each(['databaseSlot', 'documentsSlot', 'migrationPolicy', 'artifactCatalog'] as const)(
    'rejects a receipt with incompatible %s', async key => {
      const f = fixture();
      const invalid = { ...receipt(), [key]: key === 'artifactCatalog' ? { byteSize: 1, sha256: 'd'.repeat(64) }
        : key === 'migrationPolicy' ? 'current' : receipt()[key] === 'active' ? 'staged' : 'active' };
      boundary.run.mockResolvedValue(invalid);
      expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
      expect(f.assertLineage).not.toHaveBeenCalled();
    },
  );

  it('rejects a wrong lineage before returning the content receipt', async () => {
    const f = fixture();
    f.assertLineage.mockImplementation(() => { throw new Error('PROFILE_SNAPSHOT_PROFILE_MISMATCH'); });
    expect(await failure(f.start())).toMatchObject({ cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(f.assertLineage).toHaveBeenCalledOnce();
    expect(copy.discard).toHaveBeenCalledOnce();
  });

  it('checks lineage again after the final ownership callback', async () => {
    const f = fixture();
    f.assertLineage.mockImplementationOnce(() => {}).mockImplementationOnce(() => {
      throw new Error('PROFILE_SNAPSHOT_PROFILE_MISMATCH');
    });
    await expect(f.start()).rejects.toBeInstanceOf(ProfileInspectionProcessError);
    expect(f.assertLineage).toHaveBeenCalledTimes(2);
  });

  it.each(['workspaceRoot', 'databaseSlot', 'extra'] as const)('rejects malformed %s without starting the inspector', async key => {
    const f = fixture();
    f.readSources.mockResolvedValue({ ...sources, [key]: key === 'workspaceRoot' ? 'relative' : key === 'databaseSlot' ? 'rollback' : true } as ProfileInspectionColdSources);
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
    expect(boundary.run).not.toHaveBeenCalled();
    expect(copy.prepare).not.toHaveBeenCalled();
  });

  it('does not run getters in a source admission record', async () => {
    const f = fixture();
    const getter = vi.fn(() => sources.workspaceRoot);
    f.readSources.mockResolvedValue({ ...sources, get workspaceRoot() { return getter(); } });
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
    expect(getter).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
  });

  it('uses the same work deadline for initial source lookup and native execution', async () => {
    const f = fixture();
    f.readSources.mockImplementationOnce(async () => { await vi.advanceTimersByTimeAsync(21); return sources; });
    await f.start();
    expect(f.readSources.mock.calls[0]![0].deadline).toBe(profileInspectionWorkMilliseconds);
    expect(boundary.run.mock.calls[0]![0].deadline).toBe(profileInspectionWorkMilliseconds);
    expect(f.readSources.mock.calls[1]![0].deadline).toBe(profileInspectionWorkMilliseconds);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stuck source lookup and does not fork after a late answer', async () => {
    const f = fixture();
    const pending = deferred<ProfileInspectionColdSources>();
    f.readSources.mockReturnValueOnce(pending.promise);
    const result = failure(f.start());
    await flush();
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(await result).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    pending.resolve(sources);
    await flush();
    expect(boundary.run).not.toHaveBeenCalled();
    expect(copy.prepare).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains copy and first cause when reclaim is uncertain (absence %s)', async processAbsent => {
    const f = fixture();
    boundary.run.mockRejectedValue(new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent, reservationReclaimed: false, forced: !processAbsent }));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent, reservationReclaimed: false } });
    expect(copy.discard).not.toHaveBeenCalled();
    expect(bindings.read).not.toHaveBeenCalled();
    expect(f.readSources).toHaveBeenCalledOnce();
    expect(f.assertLineage).not.toHaveBeenCalled();
    expect(f.invalidate).toHaveBeenCalledOnce();
  });

  it('preserves the first native cause separately when copy cleanup fails', async () => {
    const f = fixture();
    boundary.run.mockRejectedValue(new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent: true, reservationReclaimed: true, forced: false }));
    copy.discard.mockRejectedValue(new Error('synthetic private cleanup detail'));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(f.invalidate).toHaveBeenCalledOnce();
  });

  it('does not return a successful receipt if copy cleanup fails', async () => {
    const f = fixture();
    copy.discard.mockRejectedValue(new Error('synthetic private cleanup detail'));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' });
    expect(f.readSources).toHaveBeenCalledOnce();
    expect(f.assertLineage).not.toHaveBeenCalled();
    expect(f.invalidate).toHaveBeenCalledOnce();
  });

  it('rejects a missing or changed binding file before returning any content', async () => {
    const f = fixture();
    bindings.read.mockRejectedValue(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(copy.discard).not.toHaveBeenCalled();
    expect(f.assertLineage).not.toHaveBeenCalled();
  });

  it('retains a binding read cause and its unverified inspection copy', async () => {
    const f = fixture();
    bindings.read.mockRejectedValue(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
    copy.discard.mockRejectedValue(new Error('synthetic cleanup'));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(copy.discard).not.toHaveBeenCalled();
  });

  it('does not admit a late binding read after its original work deadline', async () => {
    const f = fixture();
    const pending = deferred<readonly never[]>();
    bindings.read.mockReturnValue(pending.promise);
    const result = failure(f.start());
    await flush();
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(await result).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(copy.discard).not.toHaveBeenCalled();
    expect(f.invalidate).toHaveBeenCalledOnce();
    pending.resolve([]);
    await flush();
    expect(f.assertLineage).not.toHaveBeenCalled();
    expect(copy.discard).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors cancellation before source lookup without native work', async () => {
    const f = fixture();
    f.cancellation.abort();
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(f.readSources).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
  });
});

function fixture() {
  const cancellation = new AbortController();
  const assertAuthority = vi.fn(() => {});
  const assertMainOwned = vi.fn(async () => {});
  const invalidate = vi.fn();
  const readSources = vi.fn(async (_input: { deadline: number; signal: AbortSignal }) => sources);
  const assertLineage = vi.fn((_profileId: string) => {});
  const reservation = {
    assertMainOwned, invalidate,
    bind(generationId: string, authority: () => void, prepare: (signal: AbortSignal) => Promise<void>): WorkspaceProcessReservationTransfer {
      authority();
      return {
        descriptor: { generationId, identity: 'b'.repeat(64), userDataRoot: resolve('synthetic-staging', operationId) },
        prepare, assertGrant: async () => {}, assertCurrent: () => {}, reclaimAfterExit: async () => {}, invalidate,
      };
    },
  };
  const start = () => runProfileRestoreColdInspection({ operationId, reservation, assertAuthority, readSources, assertLineage,
    signal: cancellation.signal, runnerPath: resolve('synthetic-runner.js'),
    deployment: { backendRoot: resolve('synthetic-backend'), migrationsDirectory: resolve('synthetic-backend', 'migrations'),
      nativeResourceRoot: resolve('synthetic-native') },
  });
  return { start, cancellation, assertAuthority, assertMainOwned, invalidate, readSources, assertLineage };
}

function receipt(): ColdProfileInspectionReceipt {
  return { artifactCount: 0, artifactTotalByteSize: 0, artifactIdentity: 'c'.repeat(64), databaseHealth: 'healthy',
    profileId, migrationChainIdentity: 'd'.repeat(64), migrationPolicy: 'restoreCompatible',
    databaseSlot: sources.databaseSlot, documentsSlot: sources.documentsSlot,
    documentBindings: { byteSize: 34, sha256: 'f'.repeat(64) },
    database: { byteSize: 512, sha256: 'e'.repeat(64) } };
}

async function failure(task: Promise<unknown>) {
  try { await task; throw new Error('unexpected successful inspection'); }
  catch (error) { expect(error).toBeInstanceOf(ProfileInspectionProcessError); return error; }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function flush() { for (let i = 0; i < 30; i += 1) await Promise.resolve(); }
