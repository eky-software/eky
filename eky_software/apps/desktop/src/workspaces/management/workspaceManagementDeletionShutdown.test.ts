import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryWorkspaceMaintenanceLease,
  type WorkspaceMaintenanceLeaseHandle,
} from '../maintenance/workspaceMaintenanceLease.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { WorkspaceManagementService } from './workspaceManagementService.js';
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

function fixture(options: {
  prepare?(): Promise<WorkspaceDeletionPreparationOutcome>;
  complete?(): void;
  release?(): void | Promise<void>;
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
