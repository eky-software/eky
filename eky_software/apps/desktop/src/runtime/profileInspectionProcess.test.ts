import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProfileInspectionStatus, profileInspectionProtocolVersion, profileInspectionShutdownMilliseconds,
  profileInspectionWorkMilliseconds, type ColdProfileInspectionReceipt, type ProfileInspectionColdSources,
  type ProfileInspectionMigrationPolicy, type ProfileInspectionReceipt, type ProfileInspectionRequestIdentity,
  type OriginalProfileInspectionReceipt, type ProfileInspectionOriginalSources,
} from './profileInspectionMessages.js';
import { ProfileInspectionProcessError, runColdOriginalProfileInspectionProcess, runColdProfileInspectionProcess, runProfileInspectionProcess } from './profileInspectionProcess.js';
import type { WorkspaceProcessReservationTransfer } from './workspaceProcessReservation.js';

const boundary = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: boundary.fork } }));

const identity: ProfileInspectionRequestIdentity = { protocolVersion: profileInspectionProtocolVersion,
  generationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  runtimeSession: 'c'.repeat(43) };
const reservation = { generationId: identity.generationId, identity: 'd'.repeat(64),
  userDataRoot: resolve('private-inspection-staging', identity.operationId) };

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('main-owned fixed profile inspection process', () => {
  it.each(['active', 'rollback', 'absent'] as const)('retains original %s identity envelope until native exit and reclaim', async databaseSlot => {
    const sources = { workspaceRoot: resolve('private-workspace'), layout: 'profileRestore', databaseSlot, documentsSlot: 'absent' } as const;
    const reclaimed = deferred<void>();
    const fixture = createFixture({ originalSources: sources, reclaim: () => reclaimed.promise });
    await grant(fixture);
    const status = originalCompleted(sources);
    fixture.child.emit('message', status);
    expect(fixture.outcome).not.toHaveBeenCalled();
    expect(fixture.reclaim).not.toHaveBeenCalled();
    fixture.child.emit('exit', 0);
    await flushTasks();
    expect(fixture.outcome).not.toHaveBeenCalled();
    reclaimed.resolve();
    await expect(fixture.result).resolves.toEqual(status);
    expect(fixture.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['forward', 'portable', 'layout', 'databaseSlot', 'documentsSlot', 'operationId', 'generationId', 'runtimeSession'] as const)
    ('rejects wrong original terminal %s after clean exit', async variant => {
      const sources = { workspaceRoot: resolve('private-workspace'), layout: 'profileRestore', databaseSlot: 'rollback', documentsSlot: 'active' } as const;
      const fixture = createFixture({ originalSources: sources });
      await grant(fixture);
      const status = originalCompleted(sources);
      const wrong = variant === 'portable' ? completed() : variant === 'forward'
        ? coldCompleted({ databaseSlot: 'active', documentsSlot: 'active' })
        : ['operationId', 'generationId', 'runtimeSession'].includes(variant)
          ? { ...status, [variant]: variant === 'runtimeSession' ? 'x'.repeat(43) : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }
          : originalCompleted({ ...sources, [variant]: variant === 'layout' ? 'workspaceReplacement' : variant === 'databaseSlot' ? 'active' : 'rollback' });
      fixture.child.emit('message', wrong);
      fixture.child.emit('exit', 0);
      expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
        cleanup: { processAbsent: true, reservationReclaimed: true } });
    });

  it.each(['portable', 'forward'] as const)('cannot use an original result for %s work', async kind => {
    const fixture = createFixture(kind === 'portable' ? {} : {
      coldSources: { workspaceRoot: resolve('private-workspace'), databaseSlot: 'active', documentsSlot: 'active' },
    });
    await grant(fixture);
    fixture.child.emit('message', originalCompleted({ workspaceRoot: resolve('private-workspace'),
      layout: 'profileRestore', databaseSlot: 'active', documentsSlot: 'active' }));
    fixture.child.emit('exit', 0);
    expect(await failure(fixture)).toHaveProperty('causeCode', 'PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it.each([
    ['active', 'active'], ['active', 'staged'], ['staged', 'active'], ['staged', 'staged'],
  ] as const)('accepts cold %s/%s content only after native exit and reclaimed ownership', async (databaseSlot, documentsSlot) => {
    const reclaimed = deferred<void>();
    const sources = { workspaceRoot: resolve('private-workspace'), databaseSlot, documentsSlot };
    const fixture = createFixture({ coldSources: sources, reclaim: () => reclaimed.promise });
    await grant(fixture);
    expect(fixture.postMessage.mock.calls.find(([value]) => value.type === 'prepare')?.[0]).toMatchObject({
      kind: 'inspectColdRestoreContent', sources,
    });
    fixture.child.emit('message', coldCompleted(sources));
    expect(fixture.reclaim).not.toHaveBeenCalled();
    expect(fixture.outcome).not.toHaveBeenCalled();
    fixture.child.emit('exit', 0);
    await flushTasks();
    expect(fixture.outcome).not.toHaveBeenCalled();
    reclaimed.resolve();
    await expect(fixture.result).resolves.toEqual(coldReceipt(sources));
    expect(fixture.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['portable', 'databaseSlot', 'documentsSlot', 'beforeGrant'] as const)
    ('rejects the wrong cold terminal even with a clean process exit: %s', async variant => {
      const sources = { workspaceRoot: resolve('private-workspace'), databaseSlot: 'active', documentsSlot: 'staged' } as const;
      const fixture = createFixture({ coldSources: sources });
      if (variant !== 'beforeGrant') await grant(fixture);
      fixture.child.emit('message', variant === 'portable' ? completed() : coldCompleted({ ...sources,
        ...(variant === 'databaseSlot' ? { databaseSlot: 'staged' } : variant === 'documentsSlot' ? { documentsSlot: 'active' } : {}) }));
      fixture.child.emit('exit', 0);
      expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
        cleanup: { processAbsent: true, reservationReclaimed: true } });
    });

  it('never accepts a cold terminal for the unchanged portable API', async () => {
    const fixture = createFixture();
    await grant(fixture);
    fixture.child.emit('message', coldCompleted({ databaseSlot: 'active', documentsSlot: 'staged' }));
    fixture.child.emit('exit', 0);
    expect(await failure(fixture)).toHaveProperty('causeCode', 'PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it('freezes cold selection at admission instead of following later caller mutation', async () => {
    const sources: { workspaceRoot: string; databaseSlot: 'active' | 'staged'; documentsSlot: 'active' | 'staged' } = {
      workspaceRoot: resolve('private-workspace'), databaseSlot: 'active', documentsSlot: 'staged',
    };
    const admitted = { ...sources };
    const fixture = createFixture({ coldSources: sources });
    sources.databaseSlot = 'staged';
    sources.workspaceRoot = resolve('different-workspace');
    await grant(fixture);
    expect(fixture.postMessage.mock.calls.find(([value]) => value.type === 'prepare')?.[0]).toHaveProperty('sources', admitted);
    fixture.child.emit('message', coldCompleted(admitted));
    fixture.child.emit('exit', 0);
    await expect(fixture.result).resolves.toEqual(coldReceipt(admitted));
  });

  it('rejects a wider cold capability before fork and preserves the untouched reservation', async () => {
    const fixture = createFixture({ coldSources: { workspaceRoot: '../workspace', databaseSlot: 'active', documentsSlot: 'staged' } });
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(boundary.fork).not.toHaveBeenCalled();
  });

  it('keeps the cold primary failure distinct from a missing native exit', async () => {
    const fixture = createFixture({ coldSources: { workspaceRoot: resolve('private-workspace'), databaseSlot: 'active', documentsSlot: 'staged' } });
    await grant(fixture);
    fixture.child.emit('message', createProfileInspectionStatus({ ...identity, type: 'failed', causeCode: 'PROFILE_SCHEMA_UNSUPPORTED' }));
    await vi.advanceTimersByTimeAsync(2 * profileInspectionShutdownMilliseconds);
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent: false, reservationReclaimed: false, forced: true } });
    expect(fixture.reclaim).not.toHaveBeenCalled();
    expect(fixture.invalidate).toHaveBeenCalledOnce();
  });

  it('launches with the fixed V8 bound and accepts only after exit and a reclaimed reservation', async () => {
    const reclaimed = deferred<void>();
    const fixture = createFixture({ reclaim: () => reclaimed.promise });
    expect(boundary.fork).toHaveBeenCalledWith(resolve('private-desktop', 'profileInspectionRunner.js'), [], {
      env: expect.not.objectContaining({ NODE_OPTIONS: expect.anything(), EKY_RUNTIME_SESSION: expect.anything() }),
      stdio: 'ignore', serviceName: 'Eky Profile Inspection', execArgv: ['--max-old-space-size=512'],
    });
    const environment = boundary.fork.mock.calls[0]![2].env as Record<string, string>;
    expect(Object.keys(environment).every(key => ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'WINDIR', 'NODE_ENV'].includes(key))).toBe(true);
    expect(Object.values(environment).includes(identity.runtimeSession)).toBe(false);
    await grant(fixture);
    fixture.child.emit('message', completed());
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ ...identity, type: 'shutdown' });
    expect(fixture.reclaim).not.toHaveBeenCalled();
    expect(fixture.outcome).not.toHaveBeenCalled();
    fixture.child.emit('exit', 0);
    await flushTasks();
    expect(fixture.reclaim).toHaveBeenCalledOnce();
    expect(fixture.outcome).not.toHaveBeenCalled();
    reclaimed.resolve();
    await expect(fixture.result).resolves.toEqual(receipt());
    expect(fixture.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not promote an exit without a terminal to a successful inspection', async () => {
    const fixture = createFixture();
    await grant(fixture);
    fixture.child.emit('exit', 0);
    const error = await failure(fixture);
    expect(error).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: true, forced: false } });
  });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix', 'restoreCompatible'] as const)
    ('binds the requested %s policy to preparation and completion', async migrationPolicy => {
      const fixture = createFixture({ migrationPolicy });
      await grant(fixture);
      expect(fixture.postMessage.mock.calls.find(([value]) => value.type === 'prepare')?.[0])
        .toHaveProperty('migrationPolicy', migrationPolicy);
      fixture.child.emit('message', createProfileInspectionStatus({ ...identity, type: 'completed',
        result: { ...receipt(), migrationPolicy } }));
      fixture.child.emit('exit', 0);
      await expect(fixture.result).resolves.toHaveProperty('migrationPolicy', migrationPolicy);
      expect(vi.getTimerCount()).toBe(0);
    });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix'] as const)
    ('rejects a restore-compatible receipt for a stricter %s request even with clean exit', async migrationPolicy => {
      const fixture = createFixture({ migrationPolicy });
      await grant(fixture);
      fixture.child.emit('message', completed());
      fixture.child.emit('exit', 0);
      expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
        cleanup: { processAbsent: true, reservationReclaimed: true } });
    });

  it.each([0, 1])('keeps the primary failed terminal even when exit is %s', async code => {
    const fixture = createFixture();
    await grant(fixture);
    fixture.child.emit('message', createProfileInspectionStatus({ ...identity, type: 'failed', causeCode: 'PROFILE_SCHEMA_UNSUPPORTED' }));
    fixture.child.emit('exit', code);
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
  });

  it('reports failed reclaim separately without replacing the primary schema cause', async () => {
    const fixture = createFixture({ reclaim: async () => { throw new Error('private reclaim detail'); } });
    await grant(fixture);
    fixture.child.emit('message', createProfileInspectionStatus({ ...identity, type: 'failed', causeCode: 'PROFILE_SCHEMA_UNSUPPORTED' }));
    fixture.child.emit('exit', 1);
    const error = await failure(fixture);
    expect(error).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED', cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(String(error)).not.toContain('private reclaim detail');
    expect(fixture.invalidate).toHaveBeenCalledOnce();
  });

  it('classifies reclaim-only failure as unverified cleanup, not a protocol failure', async () => {
    const fixture = createFixture({ reclaim: async () => { throw new Error('private reclaim detail'); } });
    await grant(fixture);
    fixture.child.emit('message', completed());
    fixture.child.emit('exit', 0);
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
      cleanup: { processAbsent: true, reservationReclaimed: false, forced: false } });
    expect(fixture.invalidate).toHaveBeenCalledOnce();
    expect(fixture.outcome).toHaveBeenCalledOnce();
  });

  it.each(['waitingReservation', 'authorizing'] as const)('retains a bound preparation failure in %s without granting work', async phase => {
    const pending = deferred<void>();
    const fixture = createFixture();
    fixture.child.emit('message', { type: 'ready', protocolVersion: profileInspectionProtocolVersion });
    await flushTasks();
    if (phase === 'authorizing') {
      fixture.authorize.mockImplementation(() => pending.promise);
      fixture.child.emit('message', reservationReady());
      await flushTasks();
    }
    fixture.child.emit('message', createProfileInspectionStatus({ ...identity, type: 'failed', causeCode: 'PROFILE_INSPECTION_LIMIT_EXCEEDED' }));
    fixture.child.emit('exit', 1);
    pending.resolve();
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_LIMIT_EXCEEDED',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(fixture.postMessage.mock.calls.some(([value]) => value.type === 'grant')).toBe(false);
  });

  it.each(['failedBeforePrepare', 'completedBeforeGrant', 'staleFailure'] as const)('rejects a %s preparation terminal', async variant => {
    const fixture = createFixture();
    if (variant !== 'failedBeforePrepare') {
      fixture.child.emit('message', { type: 'ready', protocolVersion: profileInspectionProtocolVersion });
      await flushTasks();
    }
    fixture.child.emit('message', variant === 'completedBeforeGrant' ? completed()
      : createProfileInspectionStatus({ ...identity, type: 'failed', causeCode: 'PROFILE_INSPECTION_LIMIT_EXCEEDED',
        ...(variant === 'staleFailure' ? { generationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } : {}) }));
    fixture.child.emit('exit', 1);
    expect(await failure(fixture)).toHaveProperty('causeCode', 'PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(fixture.postMessage.mock.calls.some(([value]) => value.type === 'grant')).toBe(false);
  });

  it.each(['generationId', 'operationId', 'runtimeSession'] as const)('rejects a terminal from a different %s', async field => {
    const fixture = createFixture();
    await grant(fixture);
    fixture.child.emit('message', { ...completed(), [field]: field === 'runtimeSession'
      ? 'z'.repeat(43) : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    fixture.child.emit('exit', 0);
    expect(await failure(fixture)).toHaveProperty('causeCode', 'PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it.each(['duplicate', 'extraProperty', 'wrongPolicy'] as const)('rejects the %s terminal without another successful result', async variant => {
    const fixture = createFixture();
    await grant(fixture);
    if (variant === 'duplicate') {
      fixture.child.emit('message', completed());
      fixture.child.emit('message', completed());
    } else fixture.child.emit('message', variant === 'extraProperty'
      ? { ...completed(), rawError: 'private work detail' }
      : { ...completed(), result: { ...receipt(), migrationPolicy: 'untrustedOverride' } });
    fixture.child.emit('exit', 0);
    expect(await failure(fixture)).toHaveProperty('causeCode', 'PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it('rejects the wrong root identity before granting any database work', async () => {
    const fixture = createFixture();
    fixture.child.emit('message', { type: 'ready', protocolVersion: profileInspectionProtocolVersion });
    await flushTasks();
    fixture.child.emit('message', createProfileInspectionStatus({ ...identity, type: 'reservationReady',
      reservation: { ...reservation, identity: 'f'.repeat(64) } }));
    fixture.child.emit('exit', 1);
    expect(await failure(fixture)).toHaveProperty('causeCode', 'PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(fixture.postMessage.mock.calls.some(([value]) => value.type === 'grant')).toBe(false);
  });

  it.each(['preparation', 'authorization'] as const)('does not reset the deadline or allow a late %s after exit', async phase => {
    const pending = deferred<void>();
    const fixture = createFixture();
    const callback = phase === 'preparation' ? fixture.prepare : fixture.authorize;
    callback.mockImplementation(() => pending.promise);
    fixture.child.emit('message', { type: 'ready', protocolVersion: profileInspectionProtocolVersion });
    await flushTasks();
    if (phase === 'authorization') {
      fixture.child.emit('message', reservationReady());
      await flushTasks();
    }
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    fixture.child.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(profileInspectionShutdownMilliseconds);
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(fixture.reclaim).not.toHaveBeenCalled();
    expect(fixture.invalidate).toHaveBeenCalledOnce();
    pending.resolve();
    await flushTasks();
    expect(fixture.postMessage.mock.calls.some(([value]) => value.type === 'grant')).toBe(false);
    if (phase === 'preparation') expect(fixture.postMessage.mock.calls.some(([value]) => value.type === 'prepare')).toBe(false);
  });

  it('uses only the remaining request budget after a trusted context lookup', async () => {
    const fixture = createFixture({ remaining: 125 });
    await grant(fixture);
    await vi.advanceTimersByTimeAsync(124);
    expect(fixture.postMessage.mock.calls.some(([value]) => value.type === 'shutdown')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    fixture.child.emit('exit', 1);
    expect(await failure(fixture)).toHaveProperty('causeCode', 'PROFILE_INSPECTION_TIMEOUT');
  });

  it.each(['exitObserved', 'exitMissing'] as const)('does not confuse successful kill with process absence: %s', async absence => {
    const fixture = createFixture();
    await grant(fixture);
    fixture.cancellation.abort();
    if (absence === 'exitObserved') fixture.kill.mockImplementation(() => { fixture.child.emit('exit', 0); return true; });
    await vi.advanceTimersByTimeAsync(profileInspectionShutdownMilliseconds);
    expect(fixture.kill).toHaveBeenCalledOnce();
    if (absence === 'exitMissing') await vi.advanceTimersByTimeAsync(profileInspectionShutdownMilliseconds);
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT', cleanup: {
      forced: true, processAbsent: absence === 'exitObserved', reservationReclaimed: absence === 'exitObserved',
    } });
    expect(fixture.reclaim).toHaveBeenCalledTimes(absence === 'exitObserved' ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot accept a completed receipt after forced shutdown', async () => {
    const fixture = createFixture();
    await grant(fixture);
    fixture.child.emit('message', completed());
    fixture.kill.mockImplementation(() => { fixture.child.emit('exit', 0); return true; });
    await vi.advanceTimersByTimeAsync(profileInspectionShutdownMilliseconds);
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
      cleanup: { processAbsent: true, reservationReclaimed: true, forced: true } });
  });

  it('rejects a receipt when authority disappears during final reclaim', async () => {
    const reclaimed = deferred<void>();
    const fixture = createFixture({ reclaim: () => reclaimed.promise });
    await grant(fixture);
    fixture.child.emit('message', completed());
    fixture.child.emit('exit', 0);
    await flushTasks();
    fixture.assertAuthority.mockImplementation(() => { throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); });
    reclaimed.resolve();
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID', cleanup: { reservationReclaimed: true } });
  });

  it.each(['preparation', 'finalAcceptance'] as const)('does not proceed after synchronous cancellation inside %s authority assertion', async phase => {
    const fixture = createFixture();
    if (phase === 'finalAcceptance') {
      await grant(fixture);
      fixture.child.emit('message', completed());
    }
    fixture.assertAuthority.mockImplementation(() => { fixture.cancellation.abort(); });
    if (phase === 'preparation') fixture.child.emit('message', { type: 'ready', protocolVersion: profileInspectionProtocolVersion });
    fixture.child.emit('exit', 0);
    expect(await failure(fixture)).toHaveProperty('causeCode', 'PROFILE_INSPECTION_TIMEOUT');
    if (phase === 'preparation') expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it('aborts a stalled reclaim within cleanup and cannot later acknowledge success', async () => {
    const reclaimed = deferred<void>();
    let signal: AbortSignal | undefined;
    const fixture = createFixture({ reclaim: input => { signal = input; return reclaimed.promise; } });
    await grant(fixture);
    fixture.child.emit('message', completed());
    fixture.child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(profileInspectionShutdownMilliseconds);
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(signal?.aborted).toBe(true);
    reclaimed.resolve();
    await flushTasks();
    expect(fixture.outcome).toHaveBeenCalledOnce();
  });

  it.each(['cancelled', 'expired'] as const)('never launches after %s admission and reclaims the untouched root', async admission => {
    const fixture = createFixture({ aborted: admission === 'cancelled', ...(admission === 'expired' ? { remaining: 0 } : {}) });
    expect(await failure(fixture)).toMatchObject({ causeCode: 'PROFILE_INSPECTION_TIMEOUT',
      cleanup: { processAbsent: true, reservationReclaimed: true } });
    expect(boundary.fork).not.toHaveBeenCalled();
  });

  it('retains uncertainty when fork throws after an attempted launch', async () => {
    boundary.fork.mockImplementationOnce(() => { throw new Error('private native fork detail'); });
    const fixture = createFixture();
    expect(await failure(fixture)).toMatchObject({ causeCode: 'unknown', cleanup: { processAbsent: false, reservationReclaimed: false } });
    expect(fixture.reclaim).not.toHaveBeenCalled();
    expect(fixture.invalidate).toHaveBeenCalledOnce();
  });
});

function createFixture(input: { reclaim?: (signal: AbortSignal) => Promise<void>; remaining?: number; aborted?: boolean;
  migrationPolicy?: ProfileInspectionMigrationPolicy; coldSources?: ProfileInspectionColdSources;
  originalSources?: ProfileInspectionOriginalSources } = {}) {
  const child = new EventEmitter();
  const postMessage = vi.fn<(value: { type: string }) => void>();
  const kill = vi.fn(() => true);
  Object.assign(child, { postMessage, kill });
  boundary.fork.mockReturnValue(child);
  const prepare = vi.fn(async (_signal: AbortSignal) => {});
  const authorize = vi.fn(async (_signal: AbortSignal) => {});
  const reclaim = vi.fn(input.reclaim ?? (async (_signal: AbortSignal) => {}));
  const invalidate = vi.fn();
  const transfer: WorkspaceProcessReservationTransfer = { descriptor: reservation, prepare,
    assertGrant: authorize, assertCurrent: vi.fn(), reclaimAfterExit: reclaim, invalidate };
  const cancellation = new AbortController();
  if (input.aborted) cancellation.abort();
  const assertAuthority = vi.fn(() => {});
  const outcome = vi.fn();
  const common = { runnerPath: resolve('private-desktop', 'profileInspectionRunner.js'), identity,
    deployment: { backendRoot: resolve('private-backend'), migrationsDirectory: resolve('private-backend', 'migrations'),
      nativeResourceRoot: resolve('private-native') }, reservationTransfer: transfer,
    deadline: performance.now() + (input.remaining ?? profileInspectionWorkMilliseconds), assertAuthority, signal: cancellation.signal };
  const result = input.originalSources !== undefined ? runColdOriginalProfileInspectionProcess({ ...common, sources: input.originalSources })
    : input.coldSources === undefined ? runProfileInspectionProcess({ ...common, kind: 'inspect',
    migrationPolicy: input.migrationPolicy ?? 'restoreCompatible' }) : runColdProfileInspectionProcess({ ...common, sources: input.coldSources });
  void result.then(outcome, outcome);
  return { result, outcome, child, postMessage, kill, prepare, authorize, reclaim, invalidate, assertAuthority, cancellation };
}

async function grant(fixture: ReturnType<typeof createFixture>): Promise<void> {
  fixture.child.emit('message', { type: 'ready', protocolVersion: profileInspectionProtocolVersion });
  await flushTasks();
  expect(fixture.prepare).toHaveBeenCalledOnce();
  expect(fixture.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'prepare' }));
  fixture.child.emit('message', reservationReady());
  await flushTasks();
  expect(fixture.authorize).toHaveBeenCalledOnce();
  expect(fixture.postMessage).toHaveBeenLastCalledWith({ ...identity, type: 'grant' });
}

function reservationReady() { return createProfileInspectionStatus({ ...identity, type: 'reservationReady', reservation }); }
function completed() { return createProfileInspectionStatus({ ...identity, type: 'completed', result: receipt() }); }
function coldCompleted(sources: Pick<ProfileInspectionColdSources, 'databaseSlot' | 'documentsSlot'>) {
  return createProfileInspectionStatus({ ...identity, type: 'coldCompleted', result: coldReceipt(sources) });
}
function originalCompleted(sources: ProfileInspectionOriginalSources) {
  return createProfileInspectionStatus({ ...identity, type: 'originalCompleted', result: originalReceipt(sources) });
}
function originalReceipt(sources: ProfileInspectionOriginalSources): OriginalProfileInspectionReceipt {
  const original = { sourceRole: 'original' as const, layout: sources.layout, documentsSlot: sources.documentsSlot };
  if (sources.databaseSlot === 'absent') return { ...original, databaseSlot: 'absent' };
  const { artifactCatalog: _catalog, ...content } = receipt();
  return { ...original, ...content, migrationPolicy: 'restoreCompatible', databaseSlot: sources.databaseSlot,
    documentBindings: { byteSize: 34, sha256: 'b'.repeat(64) } };
}
function coldReceipt(sources: Pick<ProfileInspectionColdSources, 'databaseSlot' | 'documentsSlot'>): ColdProfileInspectionReceipt {
  const { artifactCatalog: _catalog, ...content } = receipt();
  return { ...content, documentBindings: { byteSize: 34, sha256: 'b'.repeat(64) },
    migrationPolicy: 'restoreCompatible', databaseSlot: sources.databaseSlot, documentsSlot: sources.documentsSlot };
}
function receipt(): ProfileInspectionReceipt {
  return { artifactCount: 0, artifactIdentity: 'c'.repeat(64), artifactTotalByteSize: 0, databaseHealth: 'healthy', migrationChainIdentity: 'e'.repeat(64),
    profileId: 'f'.repeat(64), migrationPolicy: 'restoreCompatible',
    database: { byteSize: 4096, sha256: 'a'.repeat(64) }, artifactCatalog: { byteSize: 34, sha256: 'b'.repeat(64) } };
}
async function failure(fixture: ReturnType<typeof createFixture>): Promise<ProfileInspectionProcessError> {
  const error: unknown = await fixture.result.catch(value => value as unknown);
  expect(error).toBeInstanceOf(ProfileInspectionProcessError);
  return error as ProfileInspectionProcessError;
}
function deferred<T>() {
  let complete!: (value: T) => void;
  return { promise: new Promise<T>(resolveTask => { complete = resolveTask; }), resolve: (value?: T) => complete(value as T) };
}
async function flushTasks(): Promise<void> { for (let index = 0; index < 32; index += 1) await Promise.resolve(); }
