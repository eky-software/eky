import { describe, expect, it, vi } from 'vitest';

import { BackendRequestQuiescence } from '../../main/backendRequestQuiescence.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { DeferredWorkspaceRuntimeRelaunch } from './deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedActiveWorkspaceLifecycle } from './mainOwnedActiveWorkspaceLifecycle.js';

const workspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);

describe('MainOwnedActiveWorkspaceLifecycle', () => {
  it('quiesces writes and closes every workspace-owned resource in order', async () => {
    const events: string[] = [];
    const requestQuiescence = new BackendRequestQuiescence();
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      requestQuiescence,
      {
        async closeBrokers() {
          events.push('brokers');
        },
        async disposeCapabilities() {
          events.push('capabilities');
        },
        async stopBackend() {
          events.push('backend');
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
      closeBrokers: vi.fn(async () => undefined),
      disposeCapabilities: vi.fn(async () => undefined),
      stopBackend: vi.fn(async () => undefined),
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

  it('attempts every close step and fails closed when one resource fails', async () => {
    const events: string[] = [];
    const relaunch = vi.fn();
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(
      workspaceId,
      new BackendRequestQuiescence(),
      {
        async closeBrokers() {
          events.push('brokers');
        },
        async disposeCapabilities() {
          events.push('capabilities');
          throw new Error('sensitive internal failure');
        },
        async stopBackend() {
          events.push('backend');
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
    },
    async stopRecoveryPointScheduler() {
      events.push('scheduler');
    },
  };
}
