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
  it('starts secret drain alongside an active HTTP mutation and shares preparation', async () => {
    const fixture = createStopFixture();
    const gate = deferred();
    fixture.resources.sealAndDrainSecrets.mockImplementation(() => gate.promise);
    const mutation = fixture.admission.begin('POST');
    const first = fixture.lifecycle.quiesceWrites(workspaceId);
    const second = fixture.lifecycle.quiesceWrites(workspaceId);
    await Promise.resolve();
    expect(fixture.resources.sealAndDrainSecrets).toHaveBeenCalledOnce();
    expect(fixture.admission.begin('POST')).toBeUndefined();
    expect(fixture.resources.stopRecoveryPointScheduler).not.toHaveBeenCalled();
    mutation?.release();
    await Promise.resolve();
    expect(fixture.resources.stopRecoveryPointScheduler).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([first, second]);
    expect(fixture.resources.stopRecoveryPointScheduler).toHaveBeenCalledOnce();
    await fixture.lifecycle.stopAndProveHandlesClosed(workspaceId);
    expect(fixture.resources.markCleanShutdown).toHaveBeenCalledOnce();
  });

  it('does not turn a failed secret drain into safe profile mutation or restart', async () => {
    const fixture = createStopFixture();
    const entered = deferred();
    const gate = deferred();
    const mutation = fixture.admission.begin('POST');
    const resume = vi.spyOn(fixture.admission, 'resume');
    fixture.resources.stopBackend.mockImplementation(async () => {
      entered.resolve();
      await gate.promise;
      return 'exited';
    });
    fixture.resources.sealAndDrainSecrets.mockRejectedValue(new Error('synthetic drain uncertainty'));
    const quiescing = fixture.lifecycle.quiesceWrites(workspaceId);
    const failureResult = quiescing.catch(error => error);
    await entered.promise;
    expect(fixture.lifecycle.readState()).toBe('stopFailed');
    expect(fixture.admission.begin('GET')).toBeUndefined();
    await expect(fixture.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
    await expect(fixture.lifecycle.ensurePreviousWorkspaceRunning(workspaceId)).rejects.toThrow();
    expect(fixture.resources.closeBrokers).not.toHaveBeenCalled();
    const stopping = fixture.lifecycle.stopAndProveHandlesClosed(workspaceId);
    const stopFailure = stopping.catch(error => error);
    mutation?.release();
    gate.resolve();
    const failure = await failureResult;
    expect(failure).toMatchObject({
      firstFailure: { phase: 'secrets', reason: 'operationFailed' },
      cleanupFailures: [],
    });
    expect(await stopFailure).toBe(failure);
    fixture.resources.sealAndDrainSecrets.mockResolvedValue(undefined);
    await expect(fixture.lifecycle.quiesceWrites(workspaceId)).rejects.toBe(failure);
    await expect(fixture.lifecycle.stopAndProveHandlesClosed(workspaceId)).rejects.toBe(failure);
    await expect(fixture.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
    await expect(fixture.lifecycle.ensurePreviousWorkspaceRunning(workspaceId)).rejects.toThrow();
    expect(fixture.lifecycle.readState()).toBe('stopFailed');
    expect(fixture.admission.begin('GET')).toBeUndefined();
    expect(fixture.resources.sealAndDrainSecrets).toHaveBeenCalledOnce();
    expect(fixture.resources.stopRecoveryPointScheduler).toHaveBeenCalledOnce();
    expect(fixture.resources.disposeCapabilities).toHaveBeenCalledOnce();
    expect(fixture.resources.stopBackend).toHaveBeenCalledOnce();
    expect(fixture.resources.closeBrokers).toHaveBeenCalledOnce();
    expect(fixture.resources.stopBackendForUpdate).not.toHaveBeenCalled();
    expect(fixture.resources.markCleanShutdown).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('attempts every owned shutdown after failed quiescence and preserves its first cause', async () => {
    const fixture = createStopFixture();
    fixture.resources.sealAndDrainSecrets.mockRejectedValue(new Error('synthetic private drain'));
    fixture.resources.stopRecoveryPointScheduler.mockRejectedValue(new Error('synthetic private scheduler'));
    fixture.resources.disposeCapabilities.mockRejectedValue(new Error('synthetic private capabilities'));
    fixture.resources.stopBackend.mockRejectedValue(new BackendGracefulShutdownTimeoutError());
    fixture.resources.closeBrokers.mockRejectedValue(new Error('synthetic private brokers'));
    const result = fixture.lifecycle.quiesceWrites(workspaceId);
    await expect(result).rejects.toMatchObject({
      message: 'WORKSPACE_RUNTIME_QUIESCE_FAILED',
      firstFailure: { phase: 'secrets', reason: 'operationFailed' },
      cleanupFailures: [
        { phase: 'scheduler', reason: 'operationFailed' },
        { phase: 'capabilities', reason: 'operationFailed' },
        { phase: 'backend', reason: 'gracefulTimeout' },
        { phase: 'brokers', reason: 'operationFailed' },
      ],
    });
    const failure = await result.catch(error => error);
    expect(JSON.stringify(failure)).not.toContain('synthetic private');
    await expect(fixture.lifecycle.quiesceWrites(workspaceId)).rejects.toBe(failure);
    await expect(fixture.lifecycle.stopAndProveHandlesClosed(workspaceId)).rejects.toBe(failure);
    await expect(fixture.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
    await expect(fixture.lifecycle.ensurePreviousWorkspaceRunning(workspaceId)).rejects.toThrow();
    expect(fixture.lifecycle.readState()).toBe('stopFailed');
    expect(fixture.resources.stopRecoveryPointScheduler).toHaveBeenCalledOnce();
    expect(fixture.resources.disposeCapabilities).toHaveBeenCalledOnce();
    expect(fixture.resources.stopBackend).toHaveBeenCalledOnce();
    expect(fixture.resources.closeBrokers).toHaveBeenCalledOnce();
    expect(fixture.resources.markCleanShutdown).not.toHaveBeenCalled();
  });

  it('awaits final broker closure before reporting absence or a clean shutdown', async () => {
    const fixture = createStopFixture();
    const entered = deferred();
    const gate = deferred();
    fixture.resources.closeBrokers.mockImplementation(async () => {
      entered.resolve();
      await gate.promise;
    });
    await fixture.lifecycle.quiesceWrites(workspaceId);
    const stop = fixture.lifecycle.stopAndProveHandlesClosed(workspaceId);
    await entered.promise;
    await expect(fixture.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
    expect(fixture.resources.markCleanShutdown).not.toHaveBeenCalled();
    gate.resolve();
    await stop;
    await fixture.lifecycle.assertNoActiveWorkspaceRuntime();
    expect(fixture.resources.markCleanShutdown).toHaveBeenCalledOnce();
  });

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

  it('does not reopen a sealed generation after a bounded quiescence failure', async () => {
    vi.useFakeTimers();
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

    const result = expect(lifecycle.quiesceWrites(workspaceId)).rejects.toMatchObject({
      firstFailure: { phase: 'quiescence', reason: 'operationFailed' },
      cleanupFailures: [],
    });
    await vi.advanceTimersByTimeAsync(5);
    await result;

    expect(lifecycle.readState()).toBe('stopFailed');
    expect(requestQuiescence.readState()).toBe('stopped');
    expect(events).toEqual(['scheduler', 'capabilities', 'backend', 'brokers']);
    const admittedAfterFailure = requestQuiescence.begin('PATCH');
    expect(admittedAfterFailure).toBeUndefined();

    activeMutation?.release();
    admittedAfterFailure?.release();
    await expect(lifecycle.quiesceWrites(workspaceId)).rejects.toThrow('WORKSPACE_RUNTIME_QUIESCE_FAILED');
    await expect(lifecycle.stopAndProveHandlesClosed(workspaceId)).rejects.toThrow('WORKSPACE_RUNTIME_QUIESCE_FAILED');
    await expect(lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
    await expect(lifecycle.ensurePreviousWorkspaceRunning(workspaceId)).rejects.toThrow();
    expect(events).toEqual(['scheduler', 'capabilities', 'backend', 'brokers']);
  });

  it('keeps the sealed generation closed when stopping the recovery scheduler fails', async () => {
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

    expect(lifecycle.readState()).toBe('stopFailed');
    expect(requestQuiescence.readState()).toBe('stopped');
    expect(requestQuiescence.begin('POST')).toBeUndefined();
  });

  it('never calls general resume after starting secret shutdown', async () => {
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
      'WORKSPACE_RUNTIME_QUIESCE_FAILED',
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
        outcome === 'exited' ? ['fulfilled', 'rejected'] : ['rejected', 'rejected'],
      );
      await expect(fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111'))
        .rejects.toThrow('WORKSPACE_RUNTIME_STOP_FAILED');
      expect(fixture.resources.stopBackend).toHaveBeenCalledOnce();
      expect(fixture.resources.stopBackendForUpdate).not.toHaveBeenCalled();
      expect(fixture.resources.markCleanShutdown).toHaveBeenCalledTimes(outcome === 'exited' ? 1 : 0);
      if (outcome !== 'exited') {
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

  it.each(['quiescence', 'secrets', 'scheduler'] as const)(
    'attempts strict cleanup and keeps update admission closed after a preparation failure (%s)', async mode => {
      vi.useFakeTimers();
      const fixture = createStopFixture();
      const mutation = mode === 'quiescence' ? fixture.admission.begin('POST') : undefined;
      if (mode === 'secrets') fixture.resources.sealAndDrainSecrets
        .mockRejectedValue(new Error('synthetic private drain'));
      if (mode === 'scheduler') fixture.resources.stopRecoveryPointScheduler
        .mockRejectedValue(new Error('synthetic private scheduler'));
      const stopping = fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111');
      const result = expect(stopping).rejects.toMatchObject({
        firstFailure: { phase: mode, reason: 'operationFailed' },
        cleanupFailures: [],
      });
      await vi.runAllTimersAsync();
      await result;
      const failure = await stopping.catch(error => error);
      mutation?.release();
      expect(fixture.admission.begin('POST')).toBeUndefined();
      expect(fixture.admission.begin('GET')).toBeUndefined();
      expect(fixture.resources.stopBackend).not.toHaveBeenCalled();
      expect(fixture.resources.markCleanShutdown).not.toHaveBeenCalled();
      await expect(fixture.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
      await expect(fixture.lifecycle.ensurePreviousWorkspaceRunning(workspaceId)).rejects.toThrow();
      await expect(fixture.lifecycle.stopForUpdate(workspaceId, '11111111-1111-4111-8111-111111111111'))
        .rejects.toBe(failure);
      await expect(fixture.lifecycle.stopAndProveHandlesClosed(workspaceId)).rejects.toBe(failure);
      expect(fixture.lifecycle.readState()).toBe('stopFailed');
      expect(fixture.resources.sealAndDrainSecrets).toHaveBeenCalledOnce();
      expect(fixture.resources.stopRecoveryPointScheduler).toHaveBeenCalledOnce();
      expect(fixture.resources.disposeCapabilities).toHaveBeenCalledOnce();
      expect(fixture.resources.stopBackendForUpdate)
        .toHaveBeenCalledExactlyOnceWith('11111111-1111-4111-8111-111111111111');
      expect(fixture.resources.closeBrokers).toHaveBeenCalledOnce();
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

describe('named deletion lifecycle', () => {
  const operationId = '33333333-3333-4333-8333-333333333333';

  it('joins secret, HTTP and archive drains before one strict stop without automatic return', async () => {
    const f = createStopFixture(true);
    const secret = deferred(); const archive = deferred();
    const mutation = f.admission.begin('POST')!;
    f.resources.sealAndDrainSecrets.mockImplementation(() => secret.promise);
    f.deletion.sealAndDrainArchive.mockImplementation(() => archive.promise);
    const preparing = f.lifecycle.quiesceForDelete(workspaceId, operationId);
    try {
      await Promise.resolve();
      expect(f.resources.sealAndDrainSecrets).toHaveBeenCalledOnce();
      expect(f.deletion.sealAndDrainArchive).toHaveBeenCalledOnce();
      expect(f.admission.begin('POST')).toBeUndefined();
      expect(f.deletion.stopBackend).not.toHaveBeenCalled();
    } finally { secret.resolve(); archive.resolve(); mutation.release(); await preparing; }
    await Promise.all([
      f.lifecycle.stopForDelete(workspaceId, operationId),
      f.lifecycle.stopAndProveHandlesClosed(workspaceId),
    ]);
    await f.lifecycle.assertNoActiveWorkspaceRuntime();
    expect(f.deletion.stopBackend).toHaveBeenCalledExactlyOnceWith(operationId);
    expect(f.resources.stopBackend).not.toHaveBeenCalled();
    expect(f.resources.stopBackendForUpdate).not.toHaveBeenCalled();
    expect(f.resources.markCleanShutdown).toHaveBeenCalledOnce();
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
    await f.lifecycle.ensurePreviousWorkspaceRunning(workspaceId);
    expect(f.runtimeRelaunch.isRequested()).toBe(true);
  });

  it.each(['secrets', 'archive'] as const)('waits for the other owned drain after %s fails', async phase => {
    const f = createStopFixture(true); const pendingDrain = deferred();
    if (phase === 'secrets') {
      f.resources.sealAndDrainSecrets.mockRejectedValue(new Error('synthetic secret uncertainty'));
      f.deletion.sealAndDrainArchive.mockImplementation(() => pendingDrain.promise);
    } else {
      f.deletion.sealAndDrainArchive.mockRejectedValue(new Error('synthetic archive uncertainty'));
      f.resources.sealAndDrainSecrets.mockImplementation(() => pendingDrain.promise);
    }
    const outcome = f.lifecycle.stopForDelete(workspaceId, operationId).catch(error => error);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(f.resources.disposeCapabilities).not.toHaveBeenCalled();
      expect(f.deletion.stopBackend).not.toHaveBeenCalled();
      await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
    } finally { pendingDrain.resolve(); await outcome; }
    const failure = await outcome;
    expect(failure).toMatchObject({ firstFailure: { phase, reason: 'operationFailed' } });
    await expect(f.lifecycle.stopForDelete(workspaceId, operationId)).rejects.toBe(failure);
    expect(f.deletion.stopBackend).toHaveBeenCalledOnce();
    expect(f.resources.closeBrokers).toHaveBeenCalledOnce();
    expect(f.resources.markCleanShutdown).not.toHaveBeenCalled();
    await expect(f.lifecycle.ensurePreviousWorkspaceRunning(workspaceId)).rejects.toThrow();
  });

  it('keeps a failed strict stop distinct from later cleanup failure and cannot change its owner', async () => {
    const f = createStopFixture(true);
    f.deletion.stopBackend.mockRejectedValue(new BackendGracefulShutdownTimeoutError());
    f.resources.closeBrokers.mockRejectedValue(new Error('synthetic cleanup'));
    await expect(f.lifecycle.stopForDelete(workspaceId, operationId)).rejects.toMatchObject({
      firstFailure: { phase: 'backend', reason: 'gracefulTimeout' },
      cleanupFailures: [{ phase: 'brokers', reason: 'operationFailed' }],
    });
    await expect(f.lifecycle.stopForUpdate(workspaceId, operationId)).rejects.toThrow();
    await expect(f.lifecycle.stopForDelete(workspaceId, '44444444-4444-4444-8444-444444444444')).rejects.toThrow();
    expect(f.deletion.stopBackend).toHaveBeenCalledOnce();
    expect(f.resources.stopBackend).not.toHaveBeenCalled();
    expect(f.resources.markCleanShutdown).not.toHaveBeenCalled();
    await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
  });

  it.each([
    ['ordinary', false], ['ordinary', true], ['update', false], ['update', true],
  ] as const)('does not replace the first %s stop policy after failure=%s', async (kind, failed) => {
    const f = createStopFixture(true);
    if (failed) {
      if (kind === 'ordinary') f.resources.stopBackend.mockRejectedValue(new BackendGracefulShutdownTimeoutError());
      else f.resources.stopBackendForUpdate.mockRejectedValue(new BackendGracefulShutdownTimeoutError());
    }
    const first = kind === 'ordinary'
      ? f.lifecycle.quiesceWrites(workspaceId).then(() => f.lifecycle.stopAndProveHandlesClosed(workspaceId))
      : f.lifecycle.stopForUpdate(workspaceId, operationId);
    if (failed) await expect(first).rejects.toThrow();
    else await first;
    await expect(f.lifecycle.quiesceForDelete(workspaceId, operationId)).rejects.toThrow();
    await expect(f.lifecycle.stopForDelete(workspaceId, operationId)).rejects.toThrow();
    expect(f.deletion.sealAndDrainArchive).not.toHaveBeenCalled();
    expect(f.deletion.stopBackend).not.toHaveBeenCalled();
    expect(f.resources.stopBackend).toHaveBeenCalledTimes(kind === 'ordinary' ? 1 : 0);
    expect(f.resources.stopBackendForUpdate).toHaveBeenCalledTimes(kind === 'update' ? 1 : 0);
  });

  it('requires the named resource owner before closing any existing admission', async () => {
    const f = createStopFixture();
    await expect(f.lifecycle.quiesceForDelete(workspaceId, operationId)).rejects.toThrow();
    expect(f.resources.sealAndDrainSecrets).not.toHaveBeenCalled();
    const write = f.admission.begin('POST');
    expect(write).toBeDefined(); write?.release();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

function createStopFixture(withDeletion = false) {
  const deletion = {
    sealAndDrainArchive: vi.fn(async (): Promise<void> => undefined),
    stopBackend: vi.fn(async (_operationId: string): Promise<void> => undefined),
  };
  const resources = {
    ...(withDeletion ? { deletion } : {}),
    sealAndDrainSecrets: vi.fn(async (): Promise<void> => undefined),
    closeBrokers: vi.fn(async () => undefined),
    disposeCapabilities: vi.fn(async () => undefined),
    markCleanShutdown: vi.fn(async () => undefined),
    stopBackend: vi.fn(async (): Promise<'exited' | 'forced'> => 'exited'),
    stopBackendForUpdate: vi.fn(async () => undefined),
    stopRecoveryPointScheduler: vi.fn(async () => undefined),
  };
  const admission = new BackendRequestQuiescence();
  const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(() => undefined);
  const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
    workspaceId, admission, resources, runtimeRelaunch,
  );
  return { admission, lifecycle, resources, deletion, runtimeRelaunch };
}

function createResources(events: string[]) {
  return {
    async sealAndDrainSecrets() {},
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
