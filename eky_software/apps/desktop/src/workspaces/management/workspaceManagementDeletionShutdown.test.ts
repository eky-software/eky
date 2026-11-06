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
  type WorkspaceDeletionWorkAuthority,
  type WorkspaceManagementServiceOptions,
} from './workspaceManagementService.js';
import type { WorkspaceDeletionPreparationOutcome } from './workspaceManagementTypes.js';

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

function fixture(options: {
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
    operationGuard: { async assertNoUnresolvedOperations() {}, async readRecoveryState() { return 'clear'; } },
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
    startDurable: () => service.deleteWorkspace(request, lifetime),
  };
}

function durableFixture(options: {
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
