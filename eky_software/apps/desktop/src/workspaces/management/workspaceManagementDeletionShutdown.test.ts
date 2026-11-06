import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryWorkspaceMaintenanceLease,
  type WorkspaceMaintenanceLeaseHandle,
} from '../maintenance/workspaceMaintenanceLease.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import {
  WorkspaceManagementService,
  type WorkspaceDeletionCompletion,
  type WorkspaceDeletionFailureOutcomeHandler,
  type WorkspaceDeletionWorkAuthority,
  type WorkspaceManagementServiceOptions,
} from './workspaceManagementService.js';
import type { WorkspaceDeletionPreparationOutcome } from './workspaceManagementTypes.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';

describe('workspace deletion service-owned shutdown settlement', () => {
  it.each(['completion', 'release'] as const)(
    'retains a %s failure raised before shutdown and rejects repeated shutdown', async stage => {
      const failure = new Error(`SYNTHETIC_${stage.toUpperCase()}_FAILURE`);
      const fail = () => { throw failure; };
      const f = fixture(stage === 'completion' ? { complete: fail } : { release: fail });

      await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: failure });
      expect(f.lease.readState()).toBe('idle');

      const shutdownError: unknown = await f.service.shutdown().catch((cause: unknown) => cause);
      expectCompletionFailure(shutdownError, [failure]);
      await expect(f.service.shutdown()).rejects.toBe(shutdownError);
      expect(f.complete).toHaveBeenCalledOnce();
      expect(f.release).toHaveBeenCalledOnce();
      expect(f.acquire).toHaveBeenCalledOnce();
      expect(f.relaunch).not.toHaveBeenCalled();
    },
  );

  it.each(['completion', 'release'] as const)(
    'drains delayed release before rejecting an already waiting shutdown for %s failure', async stage => {
      const failure = new Error(`SYNTHETIC_${stage.toUpperCase()}_FAILURE`);
      const releaseFinish = deferred();
      const f = fixture({
        complete() { if (stage === 'completion') throw failure; },
        async release() {
          await releaseFinish.promise;
          if (stage === 'release') throw failure;
        },
      });
      const work = observe(f.start());
      let closing: ReturnType<typeof observe<void>> | undefined;
      try {
        await waitForRelease(f, work.result);
        closing = observe(f.service.shutdown());
        await Promise.resolve();
        expect(closing.isSettled()).toBe(false);
        expect(work.isSettled()).toBe(false);
        expect(f.lease.readState()).toBe('busy');

        releaseFinish.resolve();
        await expect(work.result).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: failure });
        const shutdownError: unknown = await closing.result.catch((cause: unknown) => cause);
        expectCompletionFailure(shutdownError, [failure]);
        await expect(f.service.shutdown()).rejects.toBe(shutdownError);
        expect(f.lease.readState()).toBe('idle');
        expect(f.complete).toHaveBeenCalledOnce();
        expect(f.release).toHaveBeenCalledOnce();
        expect(f.acquire).toHaveBeenCalledOnce();
        expect(f.relaunch).not.toHaveBeenCalled();
      } finally {
        releaseFinish.resolve();
        await Promise.allSettled([work.result, ...(closing ? [closing.result] : [])]);
      }
    },
  );

  it.each(['release', 'completionAndRelease'] as const)(
    'keeps the first request error separate from later %s shutdown failures', async stage => {
      const requestFailure = new Error('SYNTHETIC_REQUEST_FAILURE');
      const completionFailure = new Error('SYNTHETIC_COMPLETION_FAILURE');
      const releaseFailure = new Error('SYNTHETIC_RELEASE_FAILURE');
      const releaseFinish = deferred();
      const f = fixture({
        async prepare() { throw requestFailure; },
        complete() { if (stage === 'completionAndRelease') throw completionFailure; },
        async release() { await releaseFinish.promise; throw releaseFailure; },
      });
      const work = observe(f.start());
      let closing: ReturnType<typeof observe<void>> | undefined;
      try {
        await waitForRelease(f, work.result);
        closing = observe(f.service.shutdown());
        await Promise.resolve();
        expect(closing.isSettled()).toBe(false);
        expect(work.isSettled()).toBe(false);
        expect(f.lease.readState()).toBe('busy');

        releaseFinish.resolve();
        const requestError: unknown = await work.result.catch((cause: unknown) => cause);
        expect(requestError).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED' });
        const completionFailures = stage === 'completionAndRelease'
          ? [completionFailure, releaseFailure] : [releaseFailure];
        expectCompletionFailure((requestError as Error).cause, [requestFailure, ...completionFailures]);

        const shutdownError: unknown = await closing.result.catch((cause: unknown) => cause);
        expectCompletionFailure(shutdownError, completionFailures);
        await expect(f.service.shutdown()).rejects.toBe(shutdownError);
        expect(f.lease.readState()).toBe('idle');
        expect(f.complete).toHaveBeenCalledOnce();
        expect(f.release).toHaveBeenCalledOnce();
        expect(f.acquire).toHaveBeenCalledOnce();
        expect(f.relaunch).not.toHaveBeenCalled();
      } finally {
        releaseFinish.resolve();
        await Promise.allSettled([work.result, ...(closing ? [closing.result] : [])]);
      }
    },
  );

  it.each(['cancelled', 'revoked', 'requestFailed'] as const)(
    'does not poison shutdown for %s when completion and delayed release succeed', async outcome => {
      const requestFailure = new Error('SYNTHETIC_REQUEST_FAILURE');
      const releaseFinish = deferred();
      const f = fixture({
        async prepare() {
          if (outcome === 'requestFailed') throw requestFailure;
          if (outcome === 'revoked') f.revokeRequest();
          return outcome === 'cancelled' ? 'cancelled' : 'prepared';
        },
        async release() { await releaseFinish.promise; },
      });
      const work = observe(f.start());
      let closing: ReturnType<typeof observe<void>> | undefined;
      try {
        await waitForRelease(f, work.result);
        closing = observe(f.service.shutdown());
        await Promise.resolve();
        expect(closing.isSettled()).toBe(false);
        expect(work.isSettled()).toBe(false);
        expect(f.lease.readState()).toBe('busy');

        releaseFinish.resolve();
        if (outcome === 'cancelled') {
          await expect(work.result).resolves.toBe('cancelled');
        } else {
          await expect(work.result).rejects.toMatchObject({
            code: 'WORKSPACE_DELETE_FAILED',
            cause: outcome === 'revoked' ? f.revocationFailure : requestFailure,
          });
        }
        await expect(closing.result).resolves.toBeUndefined();
        await expect(f.service.shutdown()).resolves.toBeUndefined();
        expect(f.lease.readState()).toBe('idle');
        expect(f.complete).toHaveBeenCalledOnce();
        expect(f.release).toHaveBeenCalledOnce();
        expect(f.acquire).toHaveBeenCalledOnce();
        expect(f.relaunch).not.toHaveBeenCalled();
      } finally {
        releaseFinish.resolve();
        await Promise.allSettled([work.result, ...(closing ? [closing.result] : [])]);
      }
    },
  );
});

describe('workspace deletion durable result lifetime', () => {
  it('continues under the captured owner after the requester disappears', async () => {
    const entered = deferred();
    const finish = deferred();
    const f = durableFixture({
      async resume(_operationId, authority) {
        entered.resolve();
        await finish.promise;
        await authority.assertOwned();
        authority.recordRemoved(f.receipt);
        return f.completion;
      },
    });
    const work = observe(f.startDurable());
    try {
      await entered.promise;
      f.revokeRequest();
      f.service.closeAdmission();
      await expectStillPending(work);
      expect(f.lease.readState()).toBe('busy');
      await expect(f.service.createEmpty('Other company'))
        .rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      finish.resolve();
      await expect(work.result).resolves.toEqual(f.completion);
      expect(f.captureAuthority).toHaveBeenCalledOnce();
      expect(f.recordRemoved).toHaveBeenCalledExactlyOnceWith(f.receipt);
      expect(f.release).toHaveBeenCalledOnce();
      expect(f.lease.readState()).toBe('idle');
      expect(f.relaunch).not.toHaveBeenCalled();
    } finally {
      finish.resolve();
      await Promise.allSettled([work.result, f.service.shutdown()]);
    }
  });

  it('does not capture a durable owner if the requester expires before handoff', async () => {
    const f = durableFixture({
      async prepare() { f.revokeRequest(); return 'prepared'; },
    });
    try {
      await expect(f.startDurable()).rejects.toMatchObject({
        code: 'WORKSPACE_DELETE_FAILED', cause: f.revocationFailure,
      });
      expect(f.captureAuthority).not.toHaveBeenCalled();
      expect(f.resume).not.toHaveBeenCalled();
      expect(f.recordRemoved).not.toHaveBeenCalled();
      expect(f.release).toHaveBeenCalledOnce();
    } finally { await f.service.shutdown(); }
  });

  it('waits for terminal work and lease release after the removal receipt', async () => {
    const removed = deferred();
    const finishTerminal = deferred();
    const finishRelease = deferred();
    const f = durableFixture({
      async resume(_operationId, authority) {
        authority.recordRemoved(f.receipt);
        removed.resolve();
        await finishTerminal.promise;
        return f.completion;
      },
      async release() { await finishRelease.promise; },
    });
    const work = observe(f.startDurable());
    try {
      await removed.promise;
      expect(f.recordRemoved).toHaveBeenCalledOnce();
      await expectStillPending(work);
      expect(f.release).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('busy');
      finishTerminal.resolve();
      await f.releaseEntered.promise;
      await expectStillPending(work);
      expect(f.lease.readState()).toBe('busy');
      finishRelease.resolve();
      await expect(work.result).resolves.toEqual(f.completion);
      expect(f.lease.readState()).toBe('idle');
      expect(() => f.workAuthority().assertCurrent())
        .toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
      expect(f.relaunch).not.toHaveBeenCalled();
    } finally {
      finishTerminal.resolve(); finishRelease.resolve();
      await Promise.allSettled([work.result, f.service.shutdown()]);
    }
  });

  it('does not report completed deletion when lease release fails', async () => {
    const failure = new Error('SYNTHETIC_DURABLE_RELEASE_FAILURE');
    const f = durableFixture({ release() { throw failure; } });
    await expect(f.startDurable()).rejects.toMatchObject({
      code: 'WORKSPACE_DELETE_FAILED', cause: failure,
    });
    expect(f.recordRemoved).toHaveBeenCalledOnce();
    expect(f.relaunch).not.toHaveBeenCalled();
    const shutdownError: unknown = await f.service.shutdown().catch((cause: unknown) => cause);
    expectCompletionFailure(shutdownError, [failure]);
    await expect(f.service.shutdown()).rejects.toBe(shutdownError);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('preserves a terminal acknowledgement failure before a release failure', async () => {
    const first = new Error('SYNTHETIC_DURABLE_TERMINAL_ACK_LOST');
    const cleanup = new Error('SYNTHETIC_DURABLE_RELEASE_FAILURE');
    const f = durableFixture({
      async resume(_operationId, authority) {
        authority.recordRemoved(f.receipt);
        throw first;
      },
      release() { throw cleanup; },
    });
    const error: unknown = await f.startDurable().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED' });
    expectCompletionFailure((error as Error).cause, [first, cleanup]);
    expect(f.recordRemoved).toHaveBeenCalledOnce();
    expect(f.relaunch).not.toHaveBeenCalled();
    const shutdownError: unknown = await f.service.shutdown().catch((cause: unknown) => cause);
    expectCompletionFailure(shutdownError, [cleanup]);
  });

  it.each(['missingReceipt', 'differentNavigation'] as const)(
    'rejects %s instead of deriving success from the command result', async variant => {
      const f = durableFixture({
        async resume(_operationId, authority) {
          if (variant !== 'missingReceipt') authority.recordRemoved(f.receipt);
          return { ...f.completion, navigation: 'reopenPrevious' };
        },
      });
      try {
        await expect(f.startDurable()).rejects.toMatchObject({
          code: 'WORKSPACE_DELETE_FAILED',
          cause: { message: 'WORKSPACE_DELETION_RESULT_INVALID' },
        });
        expect(f.recordRemoved).toHaveBeenCalledTimes(variant === 'missingReceipt' ? 0 : 1);
        expect(f.release).toHaveBeenCalledOnce();
        expect(f.relaunch).not.toHaveBeenCalled();
      } finally { await f.service.shutdown(); }
    },
  );

  it('drains an interrupted durable command before external shutdown settles', async () => {
    const entered = deferred();
    const finish = deferred();
    const f = durableFixture({
      async resume(_operationId, authority) {
        entered.resolve();
        await finish.promise;
        await authority.assertOwned();
        authority.recordRemoved(f.receipt);
        return f.completion;
      },
    });
    const work = observe(f.startDurable());
    let closing: ReturnType<typeof observe<void>> | undefined;
    try {
      await entered.promise;
      closing = observe(f.service.shutdown());
      await expectStillPending(closing);
      expect(f.lease.readState()).toBe('busy');
      expect(() => f.workAuthority().assertCurrent())
        .toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
      finish.resolve();
      await expect(work.result).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
      await expect(closing.result).resolves.toBeUndefined();
      expect(f.recordRemoved).not.toHaveBeenCalled();
      expect(f.release).toHaveBeenCalledOnce();
      expect(f.relaunch).not.toHaveBeenCalled();
    } finally {
      finish.resolve();
      await Promise.allSettled([work.result, ...(closing ? [closing.result] : []), f.service.shutdown()]);
    }
  });

  it('detects a shutdown which returns before its still-held durable command', async () => {
    const entered = deferred();
    const finish = deferred();
    const f = durableFixture({
      async resume(_operationId, authority) {
        entered.resolve();
        await finish.promise;
        authority.recordRemoved(f.receipt);
        return f.completion;
      },
    });
    const realShutdown = f.service.shutdown.bind(f.service);
    const brokenShutdown = vi.spyOn(f.service, 'shutdown')
      .mockImplementation(() => Promise.all([]).then(() => undefined));
    const work = observe(f.startDurable());
    try {
      await entered.promise;
      const closing = observe(f.service.shutdown());
      await expect(expectStillPending(closing)).rejects.toThrow();
      expect(closing.isSettled()).toBe(true);
      expect(work.isSettled()).toBe(false);
      expect(f.lease.readState()).toBe('busy');
      expect(f.release).not.toHaveBeenCalled();
      finish.resolve();
      await expect(work.result).resolves.toEqual(f.completion);
    } finally {
      brokenShutdown.mockRestore();
      finish.resolve();
      await Promise.allSettled([work.result, realShutdown()]);
    }
  });

  it('keeps a pre-publication cancellation separate from completed deletion', async () => {
    const f = durableFixture({ async prepare() { return 'cancelled'; } });
    try {
      await expect(f.startDurable()).resolves.toEqual({ formatVersion: 1, status: 'cancelled' });
      expect(f.captureAuthority).not.toHaveBeenCalled();
      expect(f.resume).not.toHaveBeenCalled();
      expect(f.recordRemoved).not.toHaveBeenCalled();
      expect(f.release).toHaveBeenCalledOnce();
      expect(f.relaunch).not.toHaveBeenCalled();
    } finally { await f.service.shutdown(); }
  });
});

describe('main-only deletion failure outcome', () => {
  it('reports malformed input without entering the admitted command and preserves the exact rejection', async () => {
    const f = durableFixture();
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    try {
      const failure = await f.startDurable(report, {}).catch(error => error);
      expect(failure).toMatchObject({ code: 'WORKSPACE_MANAGEMENT_INVALID' });
      expect(report).toHaveBeenCalledExactlyOnceWith({ cause: failure, sideEffectState: 'none' });
      expect(report.mock.calls[0]![0].cause).toBe(failure);
      expect(Object.isFrozen(report.mock.calls[0]![0])).toBe(true);
      expect(Object.keys(report.mock.calls[0]![0])).toEqual(['cause', 'sideEffectState']);
      expect(f.acquire).not.toHaveBeenCalled();
      expect(f.resume).not.toHaveBeenCalled();
    } finally { await f.service.shutdown(); }
  });

  it.each(['admission', 'preparation'] as const)('classifies the actual %s boundary rather than the same error code', async phase => {
    const first = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_BUSY', 'delete');
    const fail = async (): Promise<never> => { throw first; };
    const f = durableFixture(phase === 'admission' ? { admission: fail } : { prepare: fail });
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    try {
      const failure = await f.startDurable(report).catch(error => error);
      expect(failure).toBe(first);
      expect(report).toHaveBeenCalledExactlyOnceWith({ cause: failure,
        sideEffectState: phase === 'admission' ? 'none' : 'unknown' });
      expect(f.acquire).toHaveBeenCalledTimes(phase === 'admission' ? 0 : 1);
      expect(f.resume).not.toHaveBeenCalled();
    } finally { await f.service.shutdown(); }
  });

  it('does not turn recordRemoved or released ownership into a successful outcome after acknowledgement loss', async () => {
    const first = new Error('SYNTHETIC_ACKNOWLEDGEMENT_LOST');
    const f = durableFixture({ async resume(_id, authority) {
      authority.recordRemoved(f.receipt); throw first;
    } });
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    try {
      const failure = await f.startDurable(report).catch(error => error);
      expect(failure).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: first });
      expect(report).toHaveBeenCalledExactlyOnceWith({ cause: failure, sideEffectState: 'unknown' });
      expect(f.recordRemoved).toHaveBeenCalledOnce();
      expect(f.lease.readState()).toBe('idle');
    } finally { await f.service.shutdown(); }
  });

  it.each([false, true])('reports final release failure without losing the first cause (earlier failure: %s)', async earlier => {
    const first = new Error('SYNTHETIC_INITIAL_DELETE_FAILURE');
    const cleanup = new Error('SYNTHETIC_OUTCOME_RELEASE_FAILURE');
    const f = durableFixture({ ...(earlier ? { async prepare(): Promise<never> { throw first; } } : {}),
      release() { throw cleanup; } });
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    try {
      const failure = await f.startDurable(report).catch(error => error);
      expect(failure).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED' });
      expect(report).toHaveBeenCalledExactlyOnceWith({ cause: failure, sideEffectState: 'unknown' });
      expect(report.mock.calls[0]![0].cause).toBe(failure);
      if (earlier) expectCompletionFailure(failure.cause, [first, cleanup]);
      else expect(failure.cause).toBe(cleanup);
      expect(f.lease.readState()).toBe('idle');
    } finally {
      await f.service.shutdown().then(() => { throw new Error('MISSING_CLOSE_FAILURE'); },
        error => expectCompletionFailure(error, [cleanup]));
    }
  });

  it('keeps a late completion failure uncertain even when admission prevented command entry', async () => {
    const first = new Error('SYNTHETIC_ADMISSION_FAILURE');
    const cleanup = new Error('SYNTHETIC_LATE_COMPLETION_FAILURE');
    const events: unknown[] = [];
    const f = durableFixture({ async admission() { throw first; }, complete() { throw cleanup; },
      observer: { record(event) { events.push(event); } } });
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    try {
      const failure = await f.startDurable(report).catch(error => error);
      expectCompletionFailure(failure.cause, [first, cleanup]);
      expect(report).toHaveBeenCalledExactlyOnceWith({ cause: failure, sideEffectState: 'unknown' });
      expect(events).toEqual([expect.objectContaining({ sideEffectState: 'unknown', stage: 'admission' })]);
      expect(f.acquire).not.toHaveBeenCalled();
    } finally {
      await f.service.shutdown().then(() => { throw new Error('MISSING_CLOSE_FAILURE'); },
        error => expectCompletionFailure(error, [cleanup]));
    }
  });

  it('does not report a settled outcome while the original release is still held', async () => {
    const first = new Error('SYNTHETIC_PREPARATION_FAILURE');
    const finish = deferred();
    const f = durableFixture({ async prepare() { throw first; }, async release() { await finish.promise; } });
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    const work = observe(f.startDurable(report));
    try {
      await waitForRelease(f, work.result);
      await expectStillPending(work);
      expect(report).not.toHaveBeenCalled();
      finish.resolve();
      const failure = await work.result.catch(error => error);
      expect(failure).toMatchObject({ cause: first });
      expect(report).toHaveBeenCalledExactlyOnceWith({ cause: failure, sideEffectState: 'unknown' });
      expect(f.lease.readState()).toBe('idle');
    } finally { finish.resolve(); await Promise.allSettled([work.result, f.service.shutdown()]); }
  });

  it('binds a concurrent busy rejection only to the unstarted second request', async () => {
    const entered = deferred();
    const finish = deferred();
    const f = durableFixture({ async prepare() { entered.resolve(); await finish.promise; return 'cancelled'; } });
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    const first = f.startDurable();
    try {
      await entered.promise;
      const second = await f.startDurable(report).catch(error => error);
      expect(second).toMatchObject({ code: 'WORKSPACE_MANAGEMENT_BUSY' });
      expect(report).toHaveBeenCalledExactlyOnceWith({ cause: second, sideEffectState: 'none' });
      expect(f.acquire).toHaveBeenCalledOnce();
      expect(f.lease.readState()).toBe('busy');
      finish.resolve();
      await expect(first).resolves.toMatchObject({ status: 'cancelled' });
      expect(report).toHaveBeenCalledOnce();
    } finally { finish.resolve(); await Promise.allSettled([first, f.service.shutdown()]); }
  });

  it.each(['throw', 'reject'] as const)('retains the original rejection when the outcome receiver can %s', async mode => {
    const first = new Error('SYNTHETIC_ORIGINAL_FAILURE');
    const receiverFailure = new Error('SYNTHETIC_RECEIVER_FAILURE');
    const f = durableFixture({ async prepare() { throw first; },
      observer: { record() { throw new Error('SYNTHETIC_LOGGING_FAILURE'); } } });
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>(mode === 'throw'
      ? () => { throw receiverFailure; } : async () => { throw receiverFailure; });
    try {
      await expect(f.startDurable(report)).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: first });
      await setImmediate();
      expect(report).toHaveBeenCalledOnce();
      expect(f.lease.readState()).toBe('idle');
    } finally { await f.service.shutdown(); }
  });

  it.each(['completed', 'cancelled'] as const)('does not invent a failure report for %s', async outcome => {
    const f = durableFixture(outcome === 'cancelled' ? { async prepare() { return 'cancelled'; } } : {});
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    try {
      await expect(f.startDurable(report)).resolves.toMatchObject({ status: outcome });
      expect(report).not.toHaveBeenCalled();
    } finally { await f.service.shutdown(); }
  });

  it('leaves the proof unavailable when this runtime was already closed before admission', async () => {
    const f = durableFixture();
    const report = vi.fn<WorkspaceDeletionFailureOutcomeHandler>();
    f.service.closeAdmission();
    try {
      await expect(f.startDurable(report)).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
      expect(report).not.toHaveBeenCalled();
      expect(f.acquire).not.toHaveBeenCalled();
    } finally { await f.service.shutdown(); }
  });
});

function fixture(options: {
  admission?(): Promise<void>;
  observer?: WorkspaceManagementServiceOptions['observer'];
  prepare?(): Promise<WorkspaceDeletionPreparationOutcome>;
  complete?(): void;
  release?(): void | Promise<void>;
  continuation?: WorkspaceManagementServiceOptions['deletionContinuation'];
} = {}) {
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const handles = new WeakMap<WorkspaceMaintenanceLeaseHandle, WorkspaceMaintenanceLeaseHandle>();
  const releaseEntered = deferred();
  const relaunch = vi.fn();
  const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(relaunch);
  const complete = vi.fn((assertCurrent?: () => void) => {
    options.complete?.();
    runtimeRelaunch.complete(assertCurrent);
  });
  const release = vi.fn(async () => { await options.release?.(); });
  const acquire = vi.fn(async (purpose: Parameters<typeof lease.acquire>[0]) => {
    const handle = await lease.acquire(purpose);
    const wrapped = { async release() {
      releaseEntered.resolve();
      try { await release(); } finally { await handle.release(); }
    } };
    handles.set(wrapped, handle);
    return wrapped;
  });
  const unexpected = async (): Promise<never> => { throw new Error('UNEXPECTED_FIXTURE_COMMAND'); };
  const service = new WorkspaceManagementService({
    createEmpty: { create: unexpected }, importBackup: { import: unexpected },
    renameWorkspace: { rename: unexpected }, switchWorkspace: { switchTo: unexpected },
    maintenanceState: lease,
    registry: { async read() { return { formatVersion: 2, activeWorkspaceId: null, workspaces: [] }; } },
    operationGuard: { assertNoUnresolvedOperations: options.admission ?? (async () => {}), async readRecoveryState() { return 'clear'; } },
    ...(options.observer === undefined ? {} : { observer: options.observer }),
    runtimeRelaunchCompletion: { complete },
    ...(options.continuation === undefined ? {} : { deletionContinuation: options.continuation }),
    deletionPreparation: {
      maintenanceLease: {
        acquire,
        captureCurrentOwner(purposes, expected) {
          return lease.captureCurrentOwner(purposes,
            expected === undefined ? undefined : handles.get(expected) ?? expected);
        },
      },
      async prepare(_request, _lifetime, assertLease) {
        assertLease();
        return options.prepare ? options.prepare() : 'prepared';
      },
    },
  });
  let current = true;
  const revocationFailure = new Error('SYNTHETIC_REQUEST_REVOKED');
  const lifetime = {
    assertCurrent() { if (!current) throw revocationFailure; },
    closeAdmissionForOwnStop() { service.closeAdmission(); },
  };
  const request = {
    formatVersion: 1, workspaceId: '11111111-1111-4111-8111-111111111111',
    typedLabel: 'Synthetic company', backupChoice: 'explicitDataLoss',
  };
  return {
    service, lease, acquire, complete, release, releaseEntered, relaunch, revocationFailure,
    revokeRequest() { current = false; },
    start: () => service.prepareDeletion(request, lifetime),
    startDurable: (onFailureOutcome?: WorkspaceDeletionFailureOutcomeHandler, input: unknown = request) =>
      service.deleteWorkspace(input, lifetime, onFailureOutcome),
  };
}

function durableFixture(options: {
  admission?(): Promise<void>;
  observer?: WorkspaceManagementServiceOptions['observer'];
  complete?(): void;
  prepare?(): Promise<WorkspaceDeletionPreparationOutcome>;
  release?(): void | Promise<void>;
  resume?: NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume'];
} = {}) {
  const completion: WorkspaceDeletionCompletion = Object.freeze({
    formatVersion: 1, status: 'completed', navigation: 'selector',
  });
  const receipt = Object.freeze({ synthetic: 'removalReceipt' });
  let authority: WorkspaceDeletionWorkAuthority | undefined;
  const recordRemoved = vi.fn((value: unknown) => {
    expect(value).toBe(receipt);
    return completion;
  });
  const captureAuthority = vi.fn((_operationId: string, assertLease: () => void) => ({
    assertCurrent: assertLease,
    async assertOwned() { assertLease(); },
    recordRemoved,
  }));
  const resume = vi.fn(async (operationId: string, captured: WorkspaceDeletionWorkAuthority) => {
    authority = captured;
    if (options.resume !== undefined) return options.resume(operationId, captured);
    await captured.assertOwned();
    captured.recordRemoved(receipt);
    return completion;
  });
  const f = fixture({ ...options, continuation: { captureAuthority, resume } });
  return { ...f, captureAuthority, resume, recordRemoved, receipt, completion,
    workAuthority() {
      if (authority === undefined) throw new Error('SYNTHETIC_WORK_AUTHORITY_NOT_CAPTURED');
      return authority;
    },
  };
}

function expectCompletionFailure(error: unknown, failures: readonly Error[]) {
  expect(error).toBeInstanceOf(AggregateError);
  const aggregate = error as AggregateError;
  expect(aggregate.message).toBe('WORKSPACE_MANAGEMENT_COMPLETION_FAILED');
  expect(aggregate.cause).toBe(failures[0]);
  expect(aggregate.errors).toHaveLength(failures.length);
  for (const [index, failure] of failures.entries()) expect(aggregate.errors[index]).toBe(failure);
}

async function waitForRelease(f: ReturnType<typeof fixture>, work: Promise<unknown>) {
  await Promise.race([f.releaseEntered.promise, work.then(() => {
    throw new Error('SYNTHETIC_RELEASE_NOT_ENTERED');
  })]);
}

function observe<T>(promise: Promise<T>) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  return { result: promise, isSettled: () => settled };
}

async function expectStillPending(work: { isSettled(): boolean }) {
  // Let already-fulfilled promises publish settlement while the real work stays held.
  await setImmediate();
  expect(work.isSettled()).toBe(false);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
