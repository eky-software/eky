import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendRequestQuiescence } from '../../main/backendRequestQuiescence.js';
import { BackendGracefulShutdownTimeoutError } from '../../runtime/backendShutdown.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { DeferredWorkspaceRuntimeRelaunch } from './deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedActiveWorkspaceLifecycle } from './mainOwnedActiveWorkspaceLifecycle.js';

const workspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);

afterEach(() => vi.useRealTimers());

describe('MainOwnedActiveWorkspaceLifecycle', () => {
  it('quiesces writes and closes every workspace-owned resource in order', async () => {
    const events: string[] = [];
    const requestQuiescence = new BackendRequestQuiescence();
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      requestQuiescence,
      {
        ...createResources(events),
        async closeBrokers() {
          events.push('brokers');
        },
        async disposeCapabilities() {
          events.push('capabilities');
        },
        async stopBackend() {
          events.push('backend');
          return 'exited';
        },
        async stopRecoveryPointScheduler() {
          events.push('scheduler');
        },
      },
      new DeferredWorkspaceRuntimeRelaunch(() => events.push('relaunch')),
    );

    await lifecycle.quiesceWrites(workspaceId);
    expect(requestQuiescence.begin('POST')).toBeUndefined();
    expect(requestQuiescence.begin('GET')).toBeDefined();

    await expect(
      lifecycle.stopAndProveHandlesClosed(workspaceId),
    ).resolves.toEqual({ handlesClosed: true });
    await expect(
      lifecycle.assertNoActiveWorkspaceRuntime(),
    ).resolves.toBeUndefined();
    await lifecycle.ensurePreviousWorkspaceRunning(workspaceId);

    expect(events).toEqual([
      'scheduler',
      'capabilities',
      'backend',
      'brokers',
      'clean',
    ]);
    expect(requestQuiescence.readState()).toBe('stopped');
  });

  it('waits for an active mutation before stopping the scheduler', async () => {
    const events: string[] = [];
    const requestQuiescence = new BackendRequestQuiescence();
    const mutation = requestQuiescence.begin('PUT');
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      requestQuiescence,
      createResources(events),
      new DeferredWorkspaceRuntimeRelaunch(() => undefined),
    );

    const quiescing = lifecycle.quiesceWrites(workspaceId);
    await Promise.resolve();
    expect(events).toEqual([]);

    mutation?.release();
    await quiescing;
    expect(events).toEqual(['scheduler']);
  });

  it('resumes write admission after a bounded quiescence failure', async () => {
    const events: string[] = [];
    const requestQuiescence = new BackendRequestQuiescence({
      timeoutMilliseconds: 5,
    });
    const activeMutation = requestQuiescence.begin('POST');
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      requestQuiescence,
      createResources(events),
      new DeferredWorkspaceRuntimeRelaunch(() => events.push('relaunch')),
    );

    await expect(lifecycle.quiesceWrites(workspaceId)).rejects.toThrow(
      'WORKSPACE_RUNTIME_QUIESCE_FAILED',
    );

    expect(lifecycle.readState()).toBe('active');
    expect(requestQuiescence.readState()).toBe('active');
    expect(events).toEqual([]);
    const admittedAfterFailure = requestQuiescence.begin('PATCH');
    expect(admittedAfterFailure).toBeDefined();

    activeMutation?.release();
    admittedAfterFailure?.release();
    await expect(lifecycle.quiesceWrites(workspaceId)).resolves.toBeUndefined();
    expect(events).toEqual(['scheduler']);
  });

  it('resumes write admission when stopping the recovery scheduler fails', async () => {
    const requestQuiescence = new BackendRequestQuiescence();
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      requestQuiescence,
      {
        ...createResources([]),
        async stopRecoveryPointScheduler() {
          throw new Error('private scheduler failure');
        },
      },
      new DeferredWorkspaceRuntimeRelaunch(() => undefined),
    );

    await expect(lifecycle.quiesceWrites(workspaceId)).rejects.toThrow(
      'WORKSPACE_RUNTIME_QUIESCE_FAILED',
    );

    expect(lifecycle.readState()).toBe('active');
    expect(requestQuiescence.readState()).toBe('active');
    expect(requestQuiescence.begin('POST')).toBeDefined();
  });

  it('requires recovery when write admission cannot be resumed', async () => {
    class ResumeFailingRequestQuiescence extends BackendRequestQuiescence {
      override resume(): void {
        throw new Error('private resume failure');
      }
    }

    const requestQuiescence = new ResumeFailingRequestQuiescence({
      timeoutMilliseconds: 5,
    });
    const activeMutation = requestQuiescence.begin('POST');
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      requestQuiescence,
      createResources([]),
      new DeferredWorkspaceRuntimeRelaunch(() => undefined),
    );

    await expect(lifecycle.quiesceWrites(workspaceId)).rejects.toThrow(
      'WORKSPACE_RUNTIME_RECOVERY_REQUIRED',
    );
    activeMutation?.release();
  });

  it('is idempotent after resources have been proved closed', async () => {
    const resources = {
      ...createResources([]),
      closeBrokers: vi.fn(async () => undefined),
      disposeCapabilities: vi.fn(async () => undefined),
      stopBackend: vi.fn(async () => 'exited' as const),
      stopRecoveryPointScheduler: vi.fn(async () => undefined),
    };
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      new BackendRequestQuiescence(),
      resources,
      new DeferredWorkspaceRuntimeRelaunch(() => undefined),
    );

    await lifecycle.quiesceWrites(workspaceId);
    await lifecycle.quiesceWrites(workspaceId);
    await lifecycle.stopAndProveHandlesClosed(workspaceId);
    await lifecycle.stopAndProveHandlesClosed(workspaceId);

    expect(resources.stopRecoveryPointScheduler).toHaveBeenCalledTimes(1);
    expect(resources.disposeCapabilities).toHaveBeenCalledTimes(1);
    expect(resources.stopBackend).toHaveBeenCalledTimes(1);
    expect(resources.closeBrokers).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatching workspace without touching runtime resources', async () => {
    const resources = createResources([]);
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      new BackendRequestQuiescence(),
      resources,
      new DeferredWorkspaceRuntimeRelaunch(() => undefined),
    );

    await expect(
      lifecycle.quiesceWrites(
        validateWorkspaceId('22222222-2222-4222-8222-222222222222'),
      ),
    ).rejects.toThrow('WORKSPACE_RUNTIME_IDENTITY_MISMATCH');
  });

  it.each(['exited', 'forced', 'unknown'] as const)(
    'joins an ordinary stop without changing its outcome (%s)', async (outcome) => {
      const fixture = createStopFixture();
      const entered = deferred();
      const gate = deferred();
      fixture.resources.stopBackend.mockImplementation(async () => {
        entered.resolve();
        await gate.promise;
        if (outcome === 'unknown') throw new Error('synthetic private stop');
        return outcome;
      });
      await fixture.lifecycle.quiesceWrites(workspaceId);
      const ordinary = fixture.lifecycle.stopAndProveHandlesClosed(workspaceId);
      await entered.promise;
      const update = fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111');
      const results = Promise.allSettled([ordinary, update]);
      gate.resolve();
      expect((await results).map(result => result.status)).toEqual(
        outcome === 'unknown' ? ['rejected', 'rejected'] : ['fulfilled', 'rejected'],
      );
      await expect(fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111'))
        .rejects.toThrow('WORKSPACE_RUNTIME_STOP_FAILED');
      expect(fixture.resources.stopBackend).toHaveBeenCalledOnce();
      expect(fixture.resources.stopBackendForUpdate).not.toHaveBeenCalled();
      expect(fixture.resources.markCleanShutdown).toHaveBeenCalledTimes(outcome === 'exited' ? 1 : 0);
      if (outcome === 'unknown') {
        await expect(fixture.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
      } else {
        await fixture.lifecycle.assertNoActiveWorkspaceRuntime();
      }
    },
  );

  it.each([false, true])('shares a strict stop with ordinary/reentrant callers (failure: %s)', async failure => {
    const fixture = createStopFixture();
    const entered = deferred();
    const gate = deferred();
    let reentrant: Promise<void> | undefined;
    fixture.resources.stopBackendForUpdate.mockImplementation(async () => {
      reentrant = fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111');
      void reentrant.catch(() => undefined);
      entered.resolve();
      await gate.promise;
      if (failure) throw new Error('synthetic private timeout');
    });
    const update = fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111');
    await entered.promise;
    const ordinary = fixture.lifecycle.stopAndProveHandlesClosed(workspaceId);
    const results = Promise.allSettled([update, ordinary, reentrant]);
    gate.resolve();
    expect((await results).map(result => result.status)).toEqual(
      Array(3).fill(failure ? 'rejected' : 'fulfilled'),
    );
    expect(fixture.resources.stopBackendForUpdate).toHaveBeenCalledOnce();
    expect(fixture.resources.stopBackend).not.toHaveBeenCalled();
    expect(fixture.resources.closeBrokers).toHaveBeenCalledOnce();
    expect(fixture.resources.markCleanShutdown).toHaveBeenCalledTimes(failure ? 0 : 1);
    expect(fixture.admission.begin('POST')).toBeUndefined();
  });

  it('does not reuse another update operation even after a graceful stop', async () => {
    const fixture = createStopFixture();
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    const started = fixture.lifecycle.stopForUpdate(workspaceId, first);
    await expect(fixture.lifecycle.stopForUpdate(workspaceId, second)).rejects.toMatchObject({
      firstFailure: { phase: 'backend', reason: 'notGraceful' },
    });
    await started;
    await expect(fixture.lifecycle.stopForUpdate(workspaceId, second)).rejects.toThrow();
    await fixture.lifecycle.stopForUpdate(workspaceId, first);
    expect(fixture.resources.stopBackendForUpdate).toHaveBeenCalledExactlyOnceWith(first);
    expect(fixture.resources.stopBackend).not.toHaveBeenCalled();
  });

  it.each(['quiescence', 'scheduler'] as const)(
    'keeps update admission closed after a preparation failure (%s)', async mode => {
      vi.useFakeTimers();
      const fixture = createStopFixture();
      const mutation = mode === 'quiescence' ? fixture.admission.begin('POST') : undefined;
      if (mode === 'scheduler') fixture.resources.stopRecoveryPointScheduler
        .mockRejectedValue(new Error('synthetic private scheduler'));
      const result = expect(fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111'))
        .rejects.toThrow('WORKSPACE_RUNTIME_QUIESCE_FAILED');
      await vi.runAllTimersAsync();
      await result;
      mutation?.release();
      expect(fixture.admission.begin('POST')).toBeUndefined();
      expect(fixture.admission.begin('GET')).toBeUndefined();
      expect(fixture.resources.stopBackend).not.toHaveBeenCalled();
      expect(fixture.resources.stopBackendForUpdate).not.toHaveBeenCalled();
      expect(fixture.resources.markCleanShutdown).not.toHaveBeenCalled();
      await expect(fixture.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
      await expect(fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111')).rejects.toThrow();
    },
  );

  it('preserves the first safe shutdown cause separately from a later broker failure', async () => {
    const fixture = createStopFixture();
    fixture.resources.stopBackendForUpdate.mockRejectedValue(new BackendGracefulShutdownTimeoutError());
    fixture.resources.closeBrokers.mockRejectedValue(new Error('synthetic-private-broker-detail'));
    const result = fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111');
    await expect(result).rejects.toMatchObject({
      message: 'WORKSPACE_RUNTIME_STOP_FAILED',
      firstFailure: { phase: 'backend', reason: 'gracefulTimeout' },
      cleanupFailures: [{ phase: 'brokers', reason: 'operationFailed' }],
    });
    const failure = await result.catch(error => error);
    expect(JSON.stringify(failure)).not.toContain('synthetic-private-broker-detail');
    expect(Object.isFrozen(failure.firstFailure)).toBe(true);
    expect(Object.isFrozen(failure.cleanupFailures)).toBe(true);
    await expect(fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111')).rejects.toBe(failure);
    expect(fixture.resources.stopBackendForUpdate).toHaveBeenCalledOnce();
    expect(fixture.resources.stopBackend).not.toHaveBeenCalled();
  });

  it.each(['disposeCapabilities', 'closeBrokers', 'markCleanShutdown'] as const)(
    'retains a strict cleanup failure without a second backend stop (%s)', async resource => {
      const fixture = createStopFixture();
      fixture.resources[resource].mockRejectedValue(new Error('synthetic private cleanup'));
      await expect(fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111'))
        .rejects.toThrow('WORKSPACE_RUNTIME_STOP_FAILED');
      await expect(fixture.lifecycle.stopAndProveHandlesClosed(workspaceId))
        .rejects.toThrow('WORKSPACE_RUNTIME_STOP_FAILED');
      expect(fixture.resources.stopBackendForUpdate).toHaveBeenCalledOnce();
      expect(fixture.resources.closeBrokers).toHaveBeenCalledOnce();
      expect(fixture.resources.markCleanShutdown).toHaveBeenCalledTimes(resource === 'markCleanShutdown' ? 1 : 0);
      expect(fixture.resources.stopBackend).not.toHaveBeenCalled();
      await expect(fixture.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
    },
  );

  it('attempts every close step and fails closed when one resource fails', async () => {
    const events: string[] = [];
    const relaunch = vi.fn();
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      new BackendRequestQuiescence(),
      {
        ...createResources(events),
        async closeBrokers() {
          events.push('brokers');
        },
        async disposeCapabilities() {
          events.push('capabilities');
          throw new Error('sensitive internal failure');
        },
        async stopBackend() {
          events.push('backend');
          return 'exited';
        },
        async stopRecoveryPointScheduler() {
          events.push('scheduler');
        },
      },
      new DeferredWorkspaceRuntimeRelaunch(relaunch),
    );

    await lifecycle.quiesceWrites(workspaceId);
    await expect(
      lifecycle.stopAndProveHandlesClosed(workspaceId),
    ).rejects.toThrow('WORKSPACE_RUNTIME_STOP_FAILED');
    await expect(
      lifecycle.ensurePreviousWorkspaceRunning(workspaceId),
    ).rejects.toThrow('WORKSPACE_RUNTIME_RECOVERY_REQUIRED');

    expect(events).toEqual([
      'scheduler',
      'capabilities',
      'backend',
      'brokers',
    ]);
    expect(relaunch).not.toHaveBeenCalled();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

function createStopFixture() {
  const resources = {
    closeBrokers: vi.fn(async () => undefined),
    disposeCapabilities: vi.fn(async () => undefined),
    markCleanShutdown: vi.fn(async () => undefined),
    stopBackend: vi.fn(async (): Promise<'exited' | 'forced'> => 'exited'),
    stopBackendForUpdate: vi.fn(async () => undefined),
    stopRecoveryPointScheduler: vi.fn(async () => undefined),
  };
  const admission = new BackendRequestQuiescence();
  const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
    workspaceId, admission, resources, new DeferredWorkspaceRuntimeRelaunch(() => undefined),
  );
  return { admission, lifecycle, resources };
}

function createResources(events: string[]) {
  return {
    async closeBrokers() {
      events.push('brokers');
    },
    async disposeCapabilities() {
      events.push('capabilities');
    },
    async stopBackend() {
      events.push('backend');
      return 'exited' as const;
    },
    async stopBackendForUpdate() {
      events.push('strictBackend');
    },
    async markCleanShutdown() {
      events.push('clean');
    },
    async stopRecoveryPointScheduler() {
      events.push('scheduler');
    },
  };
}
