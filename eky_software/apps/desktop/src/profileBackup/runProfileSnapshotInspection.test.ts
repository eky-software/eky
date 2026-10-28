import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
  type ProfileInspectionActiveContext, type ProfileInspectionReceipt,
} from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import { runProfileSnapshotInspection } from './runProfileSnapshotInspection.js';

const boundary = vi.hoisted(() => ({ run: vi.fn() }));
const copy = vi.hoisted(() => ({ prepare: vi.fn(), discard: vi.fn(), roots: [] as string[] }));
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock('../runtime/profileInspectionProcess.js', async importOriginal => ({
  ...await importOriginal<typeof import('../runtime/profileInspectionProcess.js')>(),
  async runProfileInspectionProcess(options: Parameters<typeof import('../runtime/profileInspectionProcess.js')['runProfileInspectionProcess']>[0]) {
    await options.reservationTransfer.prepare(options.signal);
    return boundary.run(options);
  },
}));
vi.mock('../workspaces/runtime/workspaceCandidateInspectionCopy.js', () => ({
  WorkspaceCandidateInspectionCopy: class {
    constructor(readonly root: string) { copy.roots.push(root); }
    prepare(signal: AbortSignal) { return copy.prepare(signal); }
    discardAfterExit(assertMainOwned: () => Promise<void>, signal: AbortSignal) {
      return copy.discard(assertMainOwned, signal);
    }
  },
}));

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const updateOperationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const context: ProfileInspectionActiveContext = { activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  boundary.run.mockReset().mockResolvedValue(receipt());
  copy.prepare.mockReset().mockResolvedValue(undefined);
  copy.discard.mockReset().mockResolvedValue(undefined);
  copy.roots.length = 0;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('snapshot inspection with trusted active context', () => {
  it('prepares a generation-bound copy before transfer and discards only after proven exit and reclaim', async () => {
    const pending = deferred<ProfileInspectionReceipt>();
    const f = fixture();
    boundary.run.mockImplementationOnce(async options => {
      return pending.promise;
    });
    const task = f.start();
    await flush();
    expect(copy.prepare).toHaveBeenCalledOnce();
    expect(copy.discard).not.toHaveBeenCalled();
    const generation = boundary.run.mock.calls[0]![0].identity.generationId;
    expect(copy.roots).toEqual([resolve('private-staging', `profile-inspection-${generation}`)]);
    pending.resolve(receipt());
    await task;
    expect(copy.discard).toHaveBeenCalledOnce();
    expect(copy.discard.mock.invocationCallOrder[0]).toBeLessThan(f.readActiveContext.mock.invocationCallOrder[1]!);
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the first process cause when copy cleanup fails after a confirmed exit', async () => {
    const f = fixture();
    boundary.run.mockImplementationOnce(async options => {
      throw new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
        { processAbsent: true, reservationReclaimed: true, forced: false });
    });
    copy.discard.mockRejectedValue(new Error('synthetic cleanup detail'));
    const error = await failure(f.start());
    expect(error).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent: true, reservationReclaimed: false, forced: false } });
    expect(copy.discard).toHaveBeenCalledOnce();
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(f.readActiveContext).toHaveBeenCalledOnce();
    expect(String(error)).not.toContain('synthetic');
  });

  it('never discards the copy while process absence or reservation reclaim is uncertain', async () => {
    const f = fixture();
    boundary.run.mockImplementationOnce(async options => {
      throw new ProfileInspectionProcessError('PROFILE_INSPECTION_TIMEOUT',
        { processAbsent: false, reservationReclaimed: false, forced: true });
    });
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT',
      cleanup: { processAbsent: false, reservationReclaimed: false, forced: true } });
    expect(copy.discard).not.toHaveBeenCalled();
    expect(f.invalidate).toHaveBeenCalledOnce();
  });

  it('bounds copy cleanup and cannot accept its late completion or retry it', async () => {
    const pending = deferred<void>();
    const f = fixture();
    boundary.run.mockImplementationOnce(async options => {
      return receipt();
    });
    copy.discard.mockReturnValueOnce(pending.promise);
    const outcome = failure(f.start());
    await flush();
    expect(copy.discard).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(profileInspectionShutdownMilliseconds);
    expect(await outcome).toMatchObject({ causeCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(copy.discard.mock.calls[0]![1].aborted).toBe(true);
    expect(f.invalidate).toHaveBeenCalledOnce();
    pending.resolve();
    await flush();
    expect(copy.discard).toHaveBeenCalledOnce();
    expect(f.readActiveContext).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot accept a receipt from a reservation implementation that omitted owned preparation', async () => {
    const f = fixture();
    const bind = f.bind.getMockImplementation()!;
    f.bind.mockImplementationOnce((...args) => ({ ...bind(...args), prepare: async () => {} }));
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(copy.prepare).not.toHaveBeenCalled();
    expect(copy.discard).not.toHaveBeenCalled();
    expect(f.readActiveContext).toHaveBeenCalledOnce();
  });

  it('uses the remaining caller deadline instead of restarting the work budget', async () => {
    const deadline = performance.now() + profileInspectionWorkMilliseconds;
    await vi.advanceTimersByTimeAsync(12_000);
    const f = fixture();
    await f.start({ deadline });
    expect(boundary.run.mock.calls[0]![0].deadline).toBe(deadline);
    expect(f.readActiveContext.mock.calls[0]![0].deadline).toBe(deadline);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, profileInspectionWorkMilliseconds + 1])(
    'rejects an invalid or extended caller deadline before granting work: %s', async deadline => {
      const f = fixture();
      expect(await failure(f.start({ deadline }))).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
      expect(f.bind).not.toHaveBeenCalled();
      expect(boundary.run).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not start work after the caller deadline has already expired', async () => {
    const f = fixture();
    expect(await failure(f.start({ deadline: performance.now() })))
      .toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(f.bind).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not transfer or start the inspector before the trusted context is admitted', async () => {
    const pending = deferred<ProfileInspectionActiveContext>();
    const f = fixture();
    f.readActiveContext.mockImplementationOnce(() => pending.promise);
    const task = f.start();
    await flush();
    expect(f.readActiveContext).toHaveBeenCalledOnce();
    expect(f.bind).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
    pending.resolve(context);
    const result = await task;
    expect(result.validation).toEqual({
      type: 'profileSnapshotValidation', activeProfileIsEmpty: true,
      artifactCount: 1, artifactTotalByteSize: 123, databaseHealth: 'healthy',
      migrationChainIdentity: 'b'.repeat(64), profileId: context.activeProfileId, profileMatchesActive: true,
    });
    expect(f.assertMainOwned).toHaveBeenCalledTimes(5);
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.validation)).toBe(true);
    expect(Object.isFrozen(result.receipt.database)).toBe(true);
    expect(JSON.stringify(result.validation)).not.toContain('sha256');
  });

  it('rechecks context only after the process port has proven exit and reservation reclaim', async () => {
    const process = deferred<ProfileInspectionReceipt>();
    boundary.run.mockReturnValue(process.promise);
    const f = fixture();
    const task = f.start();
    await flush();
    expect(boundary.run).toHaveBeenCalledOnce();
    expect(f.readActiveContext).toHaveBeenCalledOnce();
    process.resolve(receipt());
    await task;
    expect(f.readActiveContext).toHaveBeenCalledTimes(2);
  });

  it('keeps context lookup, process work and the final fence under the original deadline', async () => {
    const pending = deferred<ProfileInspectionActiveContext>();
    const f = fixture();
    f.readActiveContext.mockImplementationOnce(() => pending.promise);
    const task = f.start({ updateMaintenanceOperationId: updateOperationId });
    await flush();
    const first = f.readActiveContext.mock.calls[0]![0];
    await vi.advanceTimersByTimeAsync(10_000);
    pending.resolve(context);
    await task;
    const last = f.readActiveContext.mock.calls[1]![0];
    expect(first.deadline).toBe(profileInspectionWorkMilliseconds);
    expect(last.deadline).toBe(first.deadline);
    expect(boundary.run.mock.calls[0]![0].deadline).toBe(first.deadline);
    expect(last.updateMaintenanceOperationId).toBe(updateOperationId);
    expect(first.updateMaintenanceOperationId).toBe(updateOperationId);
    expect(last.signal).toBe(first.signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('binds fresh private generations and sessions instead of reusing a business session', async () => {
    const f = fixture();
    const firstResult = await f.start();
    const lastResult = await f.start();
    const first = boundary.run.mock.calls[0]![0].identity;
    const last = boundary.run.mock.calls[1]![0].identity;
    expect(first.operationId).toBe(operationId);
    expect(first.generationId).not.toBe(last.generationId);
    expect(first.runtimeSession).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.runtimeSession).not.toBe(last.runtimeSession);
    expect(f.bind.mock.calls[0]![0]).toBe(first.generationId);
    expect(boundary.run.mock.calls[0]![0].reservationTransfer.descriptor.generationId).toBe(first.generationId);
    expect(firstResult.identity).toBe(first);
    expect(lastResult.identity).toBe(last);
    expect(Object.isFrozen(firstResult.identity)).toBe(true);
    expect(Object.isFrozen(lastResult.identity)).toBe(true);
    expect(firstResult.validation).not.toHaveProperty('identity');
    expect(JSON.stringify(firstResult.validation)).not.toContain(first.runtimeSession);
  });

  it.each(['cleanup', 'finalContext'] as const)('exposes no identity before %s settles', async phase => {
    const f = fixture();
    const entered = deferred<void>();
    const gate = deferred<void>();
    if (phase === 'cleanup') copy.discard.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    else f.readActiveContext.mockResolvedValueOnce(context).mockImplementationOnce(async () => {
      entered.resolve(); await gate.promise; return context;
    });
    const published = vi.fn();
    const task = f.start().then(value => { published(value); return value; });
    try {
      await entered.promise;
      await flush();
      expect(published).not.toHaveBeenCalled();
    } finally { gate.resolve(); await Promise.allSettled([task]); }
    const accepted = await task;
    expect(accepted.identity).toBe(boundary.run.mock.calls[0]![0].identity);
    expect(published).toHaveBeenCalledOnce();
  });

  it.each(['cleanup', 'finalContext'] as const)('publishes neither receipt nor identity after failed %s', async phase => {
    const f = fixture();
    if (phase === 'cleanup') copy.discard.mockRejectedValueOnce(new Error('synthetic close failed'));
    else f.readActiveContext.mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, activeProfileId: 'f'.repeat(64) });
    const published = vi.fn();
    await expect(f.start().then(published)).rejects.toBeInstanceOf(ProfileInspectionProcessError);
    expect(published).not.toHaveBeenCalled();
    expect(boundary.run).toHaveBeenCalledOnce();
  });

  it('forwards the delete owner in both context reads under the same inspection budget', async () => {
    const f = fixture();
    await f.start({ deleteMaintenanceOperationId: updateOperationId });
    expect(f.readActiveContext).toHaveBeenCalledTimes(2);
    for (const [request] of f.readActiveContext.mock.calls) {
      expect(request).toMatchObject({ operationId, kind: 'inspect', deleteMaintenanceOperationId: updateOperationId });
      expect(request).not.toHaveProperty('updateMaintenanceOperationId');
    }
    expect(f.readActiveContext.mock.calls[1]![0].deadline).toBe(f.readActiveContext.mock.calls[0]![0].deadline);
  });

  it.each([
    { deleteMaintenanceOperationId: '' },
    { deleteMaintenanceOperationId: updateOperationId, updateMaintenanceOperationId: updateOperationId },
    { deleteMaintenanceOperationId: updateOperationId, kind: 'prepareRestoreActivation' as const },
  ])('rejects invalid or conflicting delete authority before context reads: %j', async overrides => {
    const f = fixture();
    expect(await failure(f.start(overrides))).toHaveProperty('causeCode', 'PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(f.readActiveContext).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
  });

  it('uses the latest admitted emptiness without exposing the active profile id in the validation fields', async () => {
    const f = fixture();
    f.readActiveContext.mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ ...context, activeProfileIsEmpty: false });
    expect((await f.start()).validation.activeProfileIsEmpty).toBe(false);
    expect(Object.keys((await f.start()).validation)).not.toContain('activeProfileId');
  });

  it('preserves the foreign-lineage inspection result without admitting activation itself', async () => {
    boundary.run.mockResolvedValue(receipt('c'.repeat(64)));
    const f = fixture();
    const result = await f.start();
    expect(result.validation.profileMatchesActive).toBe(false);
    expect(result.validation.profileId).toBe('c'.repeat(64));
    expect(f.invalidate).not.toHaveBeenCalled();
  });

  it('rejects a changed active profile after inspection', async () => {
    const f = fixture();
    f.readActiveContext.mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ ...context, activeProfileId: 'c'.repeat(64) });
    const error = await failure(f.start());
    expect(error).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(f.invalidate).not.toHaveBeenCalled();
  });

  it('rejects an expired authority instead of publishing a receipt from a previous runtime', async () => {
    const f = fixture();
    boundary.run.mockImplementationOnce(async () => {
      f.assertAuthority.mockImplementation(() => { throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); });
      return receipt();
    });
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(f.readActiveContext).toHaveBeenCalledOnce();
  });

  it('times out a missing initial context and never starts late work when it finally arrives', async () => {
    const pending = deferred<ProfileInspectionActiveContext>();
    const f = fixture();
    f.readActiveContext.mockReturnValue(pending.promise);
    const outcome = failure(f.start());
    await flush();
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(await outcome).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    pending.resolve(context);
    await flush();
    expect(f.bind).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('invalidates an unverified main reservation, even if a delayed assertion later succeeds', async () => {
    const pending = deferred<void>();
    const f = fixture();
    f.assertMainOwned.mockReturnValueOnce(pending.promise);
    const outcome = failure(f.start());
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(await outcome).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    pending.resolve();
    await flush();
    expect(f.readActiveContext).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
    expect(f.invalidate).toHaveBeenCalledOnce();
  });

  it.each(['initial', 'final'])('does not certify ownership lost during the %s context read', async phase => {
    const pending = deferred<ProfileInspectionActiveContext>();
    const f = fixture();
    if (phase === 'final') f.readActiveContext.mockResolvedValueOnce(context);
    f.readActiveContext.mockReturnValueOnce(pending.promise);
    const outcome = failure(f.start());
    await flush();
    expect(f.readActiveContext).toHaveBeenCalledTimes(phase === 'initial' ? 1 : 2);
    f.assertMainOwned.mockRejectedValue(new Error('synthetic-root-identity-changed'));
    pending.reject(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
    expect(await outcome).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false, forced: false } });
    expect(boundary.run).toHaveBeenCalledTimes(phase === 'initial' ? 0 : 1);
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds cleanup ownership rechecking and does not accept a late ownership result', async () => {
    const cleanup = deferred<void>();
    const f = fixture();
    f.assertMainOwned.mockResolvedValueOnce(undefined).mockReturnValueOnce(cleanup.promise);
    f.readActiveContext.mockRejectedValue(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
    const outcome = failure(f.start());
    await flush();
    await vi.advanceTimersByTimeAsync(profileInspectionShutdownMilliseconds);
    expect(await outcome).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false, forced: false } });
    expect(f.invalidate).toHaveBeenCalledOnce();
    cleanup.resolve();
    await flush();
    expect(boundary.run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not conceal the first process failure if reservation invalidation throws', async () => {
    const primary = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent: false, reservationReclaimed: false, forced: true });
    boundary.run.mockRejectedValue(primary);
    const f = fixture();
    f.invalidate.mockImplementation(() => { throw new Error('synthetic-invalidation-failure'); });
    expect(await failure(f.start())).toBe(primary);
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects ownership resolved beyond cleanup time even before the overdue timer is dispatched', async () => {
    const cleanup = deferred<void>();
    const f = fixture();
    f.assertMainOwned.mockResolvedValueOnce(undefined).mockReturnValueOnce(cleanup.promise);
    f.readActiveContext.mockRejectedValue(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
    const outcome = failure(f.start());
    await flush();
    vi.spyOn(performance, 'now').mockReturnValue(profileInspectionShutdownMilliseconds + 1);
    cleanup.resolve();
    expect(await outcome).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false, forced: false } });
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(boundary.run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the context failure when both ownership verification and invalidation fail', async () => {
    const f = fixture();
    f.assertMainOwned.mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('synthetic-ownership-failure'));
    f.readActiveContext.mockRejectedValue(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
    f.invalidate.mockImplementation(() => { throw new Error('synthetic-invalidation-failure'); });
    const error = await failure(f.start());
    expect(error).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false, forced: false } });
    expect(String(error)).not.toContain('synthetic-');
    expect(boundary.run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains a process failure and its separate cleanup facts without a final context request', async () => {
    const primary = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent: true, reservationReclaimed: true, forced: false });
    boundary.run.mockRejectedValue(primary);
    const f = fixture();
    expect(await failure(f.start())).toBe(primary);
    expect(f.readActiveContext).toHaveBeenCalledOnce();
    expect(f.invalidate).not.toHaveBeenCalled();
  });

  it.each([
    { processAbsent: false, reservationReclaimed: false, forced: true },
    { processAbsent: true, reservationReclaimed: false, forced: false },
  ])('blocks cleanup when the process port reports uncertain ownership: %j', async cleanup => {
    const primary = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED', cleanup);
    boundary.run.mockRejectedValue(primary);
    const f = fixture();
    expect(await failure(f.start())).toBe(primary);
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(f.readActiveContext).toHaveBeenCalledOnce();
  });

  it('cancels a pending context request without binding or starting an inspector', async () => {
    const f = fixture();
    const pending = deferred<ProfileInspectionActiveContext>();
    f.readActiveContext.mockReturnValue(pending.promise);
    const outcome = failure(f.start());
    await flush();
    f.cancellation.abort();
    expect(await outcome).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(f.readActiveContext.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(boundary.run).not.toHaveBeenCalled();
    pending.resolve(context);
    await flush();
    expect(boundary.run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a malformed context before transfer or file work', async () => {
    const f = fixture();
    f.readActiveContext.mockResolvedValue({ ...context, companyId: 'synthetic-forbidden' } as ProfileInspectionActiveContext);
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
    expect(f.bind).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
  });

  it('rejects a malformed receipt without exposing extra fields', async () => {
    boundary.run.mockResolvedValue({ ...receipt(), sql: 'private-synthetic-query' });
    const f = fixture();
    const error = await failure(f.start());
    expect(error).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
    expect(String(error)).not.toContain('private-synthetic-query');
    expect(f.readActiveContext).toHaveBeenCalledOnce();
  });

  it('does not extend the deadline for the final context check', async () => {
    const f = fixture();
    const pending = deferred<ProfileInspectionActiveContext>();
    f.readActiveContext.mockResolvedValueOnce(context).mockReturnValueOnce(pending.promise);
    const outcome = failure(f.start());
    await flush();
    expect(f.readActiveContext).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(await outcome).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    pending.resolve(context);
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps activation preparation on the same bound process and context path', async () => {
    const f = fixture();
    await f.start({ kind: 'prepareRestoreActivation' });
    expect(boundary.run.mock.calls[0]![0].kind).toBe('prepareRestoreActivation');
    for (const [request] of f.readActiveContext.mock.calls) {
      expect(request.kind).toBe('prepareRestoreActivation');
      expect(request.operationId).toBe(operationId);
    }
  });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix'] as const)
    ('rejects a weaker receipt after a %s request without renewing the budget', async migrationPolicy => {
      const f = fixture();
      expect(await failure(f.start({ migrationPolicy }))).toHaveProperty('causeCode', 'PROFILE_INSPECTION_PROTOCOL_INVALID');
      expect(boundary.run.mock.calls[0]?.[0]).toHaveProperty('migrationPolicy', migrationPolicy);
      expect(f.readActiveContext).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

  it('keeps unknown context failures unknown without copying their raw details', async () => {
    const f = fixture();
    f.readActiveContext.mockRejectedValue(new Error('synthetic-private-detail'));
    const error = await failure(f.start());
    expect(error).toMatchObject({ causeCode: 'unknown', cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(String(error)).not.toContain('synthetic-private-detail');
    expect(error.cause).toBeUndefined();
    expect(boundary.run).not.toHaveBeenCalled();
  });

  it.each(['../escape', 'not-a-uuid'])('rejects an invalid operation %s before invoking dependencies', async invalid => {
    const f = fixture();
    expect(await failure(f.start({ operationId: invalid }))).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
    expect(f.assertMainOwned).not.toHaveBeenCalled();
    expect(f.readActiveContext).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
  });
});

function fixture() {
  const cancellation = new AbortController();
  const assertMainOwned = vi.fn(async () => {});
  const assertAuthority = vi.fn(() => {});
  const invalidate = vi.fn(() => {});
  const bind = vi.fn((generationId: string, _assertAuthority: () => void,
    prepareMainOwned: (signal: AbortSignal) => Promise<void>) => ({
    descriptor: { generationId, identity: 'd'.repeat(64), userDataRoot: resolve('private-staging', operationId) },
    prepare: async (signal: AbortSignal) => prepareMainOwned(signal), assertGrant: async () => {}, assertCurrent: () => {},
    reclaimAfterExit: async () => {}, invalidate,
  }));
  const readActiveContext = vi.fn(async (_request: Parameters<Parameters<typeof runProfileSnapshotInspection>[0]['readActiveContext']>[0]) => context);
  const options: Parameters<typeof runProfileSnapshotInspection>[0] = {
    operationId, kind: 'inspect', runnerPath: resolve('private-runtime', 'profileInspectionRunner.js'),
    migrationPolicy: 'restoreCompatible',
    deployment: { backendRoot: resolve('private-backend'), migrationsDirectory: resolve('private-migrations'), nativeResourceRoot: resolve('private-native') },
    reservation: { assertMainOwned, bind, invalidate }, readActiveContext, assertAuthority, signal: cancellation.signal,
  };
  return { cancellation, assertMainOwned, bind, invalidate, readActiveContext, assertAuthority,
    start: (overrides: Partial<typeof options> = {}) => runProfileSnapshotInspection({ ...options, ...overrides }) };
}

function receipt(profileId = context.activeProfileId): ProfileInspectionReceipt {
  return { artifactCount: 1, artifactIdentity: 'c'.repeat(64), artifactTotalByteSize: 123, databaseHealth: 'healthy', migrationChainIdentity: 'b'.repeat(64),
    profileId, migrationPolicy: 'restoreCompatible', database: { byteSize: 8192, sha256: 'e'.repeat(64) },
    artifactCatalog: { byteSize: 64, sha256: 'f'.repeat(64) } };
}

function deferred<T>() {
  let resolveTask!: (value: T | PromiseLike<T>) => void;
  let rejectTask!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { resolveTask = resolve; rejectTask = reject; });
  return { promise, resolve: resolveTask, reject: rejectTask };
}

async function flush(): Promise<void> { await vi.advanceTimersByTimeAsync(0); }
async function failure(task: Promise<unknown>): Promise<ProfileInspectionProcessError> {
  try { await task; throw new Error('EXPECTED_INSPECTION_FAILURE'); }
  catch (error) { expect(error).toBeInstanceOf(ProfileInspectionProcessError); return error as ProfileInspectionProcessError; }
}
