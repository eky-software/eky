import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  profileInspectionWorkMilliseconds, type OriginalProfileInspectionReceipt, type ProfileInspectionOriginalSources,
} from '../../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError, type OriginalProfileInspectionResult } from '../../runtime/profileInspectionProcess.js';
import type { WorkspaceProcessReservationTransfer } from '../../runtime/workspaceProcessReservation.js';
import { runProfileRestoreOriginalInspection } from './runProfileRestoreOriginalInspection.js';

type ProcessOptions = Parameters<typeof import('../../runtime/profileInspectionProcess.js')['runColdOriginalProfileInspectionProcess']>[0];
const boundary = vi.hoisted(() => ({ run: vi.fn() }));
const bindings = vi.hoisted(() => ({ read: vi.fn() }));
const copy = vi.hoisted(() => ({ prepare: vi.fn(), discard: vi.fn(), roots: [] as string[] }));
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock('../../runtime/profileInspectionDocumentBindingsFile.js', () => ({ readProfileInspectionDocumentBindings: bindings.read }));
vi.mock('../../runtime/profileInspectionProcess.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../runtime/profileInspectionProcess.js')>(),
  async runColdOriginalProfileInspectionProcess(options: ProcessOptions) {
    await options.reservationTransfer.prepare(options.signal);
    return boundary.run(options);
  },
  runColdProfileInspectionProcess: vi.fn(() => { throw new Error('target operation forbidden'); }),
  runProfileInspectionProcess: vi.fn(() => { throw new Error('portable operation forbidden'); }),
}));
vi.mock('../../workspaces/runtime/workspaceCandidateInspectionCopy.js', () => ({
  WorkspaceCandidateInspectionCopy: class {
    constructor(readonly root: string) { copy.roots.push(root); }
    prepare(signal: AbortSignal) { return copy.prepare(signal); }
    discardAfterExit(assertMainOwned: () => Promise<void>, signal: AbortSignal, requireEmpty?: boolean) {
      return copy.discard(assertMainOwned, signal, requireEmpty);
    }
  },
}));
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profileId = 'a'.repeat(64);
const sources: ProfileInspectionOriginalSources = { workspaceRoot: resolve('synthetic-workspace'),
  layout: 'profileRestore', databaseSlot: 'rollback', documentsSlot: 'active' };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  boundary.run.mockReset().mockImplementation((options: ProcessOptions) => terminal(options));
  bindings.read.mockReset().mockResolvedValue(Object.freeze([]));
  copy.prepare.mockReset().mockResolvedValue(undefined);
  copy.discard.mockReset().mockResolvedValue(undefined);
  copy.roots.length = 0;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('owned original-content inspection caller', () => {
  it('captures bindings after exit/reclaim, cleans its copy, then verifies fresh selection and lineage', async () => {
    const f = fixture();
    const pending = deferred<OriginalProfileInspectionResult>();
    boundary.run.mockImplementationOnce(() => pending.promise);
    const task = f.start();
    await flush();
    expect(copy.prepare).toHaveBeenCalledOnce();
    expect(copy.discard).not.toHaveBeenCalled();
    expect(bindings.read).not.toHaveBeenCalled();
    const options = boundary.run.mock.calls[0]![0] as ProcessOptions;
    expect(options.sources).toEqual(sources);
    expect(Object.isFrozen(options.sources)).toBe(true);
    pending.resolve(terminal(options));
    const result = await task;
    expect(result).toEqual({ status: terminal(options), documents: [] });
    expect(Object.isFrozen(result.status)).toBe(true);
    expect(Object.isFrozen(result.status.result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(f.readSources).toHaveBeenCalledTimes(2);
    expect(f.assertLineage.mock.calls).toEqual([[profileId], [profileId]]);
    expect(bindings.read.mock.invocationCallOrder[0]).toBeLessThan(copy.discard.mock.invocationCallOrder[0]!);
    expect(copy.discard.mock.invocationCallOrder[0]).toBeLessThan(f.readSources.mock.invocationCallOrder[1]!);
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['active', 'rollback', 'absent'] as const)('does not invent a catalog/lineage for absent original DB and %s documents', async documentsSlot => {
    const f = fixture();
    f.readSources.mockResolvedValue({ ...sources, databaseSlot: 'absent', documentsSlot });
    const result = await f.start();
    expect(result.status.result).toEqual({ sourceRole: 'original', layout: sources.layout, databaseSlot: 'absent', documentsSlot });
    expect(Object.keys(result)).toEqual(['status']);
    expect(bindings.read).not.toHaveBeenCalled();
    expect(f.assertLineage).not.toHaveBeenCalled();
    expect(copy.discard).toHaveBeenCalledOnce();
    expect(copy.discard.mock.calls[0]![2]).toBe(true);
    expect(f.readSources).toHaveBeenCalledTimes(2);
  });

  it.each(['workspaceRoot', 'layout', 'databaseSlot', 'documentsSlot'] as const)('rejects changed %s after native exit', async key => {
    const f = fixture();
    const value = key === 'workspaceRoot' ? resolve('foreign') : key === 'layout' ? 'workspaceReplacement'
      : key === 'databaseSlot' ? 'active' : 'rollback';
    f.readSources.mockResolvedValueOnce(sources).mockResolvedValueOnce({ ...sources, [key]: value } as ProfileInspectionOriginalSources);
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
    expect(f.assertLineage).not.toHaveBeenCalled();
    expect(copy.discard).toHaveBeenCalledOnce();
  });

  it.each(['operationId', 'generationId', 'runtimeSession', 'protocolVersion', 'type', 'sourceRole', 'layout', 'databaseSlot', 'documentsSlot'] as const)(
    'rejects a mismatched terminal %s', async key => {
      const f = fixture();
      boundary.run.mockImplementationOnce((options: ProcessOptions) => {
        const status = terminal(options);
        if (key === 'sourceRole' || key === 'layout' || key === 'databaseSlot' || key === 'documentsSlot') {
          return { ...status, result: { ...status.result, [key]: key === 'sourceRole' ? 'target' : key === 'layout'
            ? 'workspaceReplacement' : key === 'databaseSlot' ? 'active' : 'rollback' } };
        }
        return { ...status, [key]: key === 'type' ? 'coldCompleted' : key === 'protocolVersion' ? 99
          : key === 'runtimeSession' ? 'z'.repeat(43) : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
      });
      expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
      expect(f.assertLineage).not.toHaveBeenCalled();
    });

  it('checks lineage twice without fabricating it from a missing DB', async () => {
    const f = fixture();
    f.assertLineage.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('PROFILE_SNAPSHOT_PROFILE_MISMATCH'); });
    expect(await failure(f.start())).toMatchObject({ cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(f.assertLineage).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('retains native first cause and uncertain copy (process absence %s)', async processAbsent => {
    const f = fixture();
    boundary.run.mockRejectedValue(new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent, reservationReclaimed: false, forced: !processAbsent }));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent, reservationReclaimed: false } });
    expect(copy.discard).not.toHaveBeenCalled();
    expect(bindings.read).not.toHaveBeenCalled();
    expect(f.invalidate).toHaveBeenCalledOnce();
  });

  it('preserves a schema cause when later copy cleanup fails', async () => {
    const f = fixture();
    boundary.run.mockRejectedValue(new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent: true, reservationReclaimed: true, forced: false }));
    copy.discard.mockRejectedValue(new Error('synthetic cleanup'));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
  });

  it('rejects a missing binding before copy deletion or lineage', async () => {
    const f = fixture();
    bindings.read.mockRejectedValue(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(copy.discard).not.toHaveBeenCalled();
    expect(f.assertLineage).not.toHaveBeenCalled();
  });

  it('retains an unsettled binding read without extending its deadline', async () => {
    const f = fixture();
    const pending = deferred<readonly never[]>();
    bindings.read.mockReturnValue(pending.promise);
    const task = failure(f.start());
    await flush();
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(await task).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(copy.discard).not.toHaveBeenCalled();
    expect(f.invalidate).toHaveBeenCalledOnce();
    pending.resolve([]);
    await flush();
    expect(copy.discard).not.toHaveBeenCalled();
    expect(f.assertLineage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('invalidates its owner if initial census outlives cancellation', async () => {
    const f = fixture();
    const pending = deferred<ProfileInspectionOriginalSources>();
    f.readSources.mockReturnValue(pending.promise);
    const task = failure(f.start());
    await flush();
    f.cancellation.abort();
    expect(await task).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(f.invalidate).toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
    pending.resolve(sources);
    await flush();
    expect(boundary.run).not.toHaveBeenCalled();
  });

  it('honors cancellation before native work', async () => {
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
  const readSources = vi.fn(async (_input: { deadline: number; signal: AbortSignal }): Promise<ProfileInspectionOriginalSources> => sources);
  const assertLineage = vi.fn((_profileId: string) => {});
  const reservation = { assertMainOwned, invalidate,
    bind(generationId: string, authority: () => void, prepare: (signal: AbortSignal) => Promise<void>): WorkspaceProcessReservationTransfer {
      authority();
      return { descriptor: { generationId, identity: 'b'.repeat(64), userDataRoot: resolve('synthetic-failed', operationId) },
        prepare, assertGrant: async () => {}, assertCurrent: () => {}, reclaimAfterExit: async () => {}, invalidate };
    } };
  const start = () => runProfileRestoreOriginalInspection({ operationId, reservation, assertAuthority, readSources, assertLineage,
    signal: cancellation.signal, runnerPath: resolve('synthetic-runner.js'), deployment: { backendRoot: resolve('backend'),
      migrationsDirectory: resolve('backend/migrations'), nativeResourceRoot: resolve('native') } });
  return { start, cancellation, assertAuthority, assertMainOwned, invalidate, readSources, assertLineage };
}

function terminal(options: ProcessOptions): OriginalProfileInspectionResult {
  const result: OriginalProfileInspectionReceipt = options.sources.databaseSlot === 'absent'
    ? { sourceRole: 'original', layout: options.sources.layout, databaseSlot: 'absent', documentsSlot: options.sources.documentsSlot }
    : { sourceRole: 'original', layout: options.sources.layout, databaseSlot: options.sources.databaseSlot,
      documentsSlot: options.sources.documentsSlot, artifactCount: 0, artifactTotalByteSize: 0, artifactIdentity: 'c'.repeat(64),
      databaseHealth: 'healthy', profileId, migrationChainIdentity: 'd'.repeat(64), migrationPolicy: 'restoreCompatible',
      database: { byteSize: 512, sha256: 'e'.repeat(64) }, documentBindings: { byteSize: 34, sha256: 'f'.repeat(64) } };
  return { ...options.identity, type: 'originalCompleted', result };
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
async function flush() { for (let i = 0; i < 40; i += 1) await Promise.resolve(); }
