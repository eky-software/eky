import { describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceManagementCapability,
  WorkspaceManagementStatus,
} from '../../app/desktopWorkspaceManagement.js';
import { WorkspaceStatusLoadController } from './workspaceStatusLoadController.js';

const idleStatus: WorkspaceManagementStatus = {
  activeWorkspaceId: null,
  formatVersion: 1,
  operationState: 'idle',
  workspaces: [],
};

describe('WorkspaceStatusLoadController', () => {
  it('deduplicates concurrent status refreshes and publishes the latest status', async () => {
    const status = createDeferred<WorkspaceManagementStatus>();
    const getStatus = vi.fn(() => status.promise);
    const callbacks = createCallbacks();
    const controller = new WorkspaceStatusLoadController();

    const first = controller.load(createCapability(getStatus), callbacks);
    const second = controller.load(createCapability(getStatus), callbacks);
    status.resolve({ ...idleStatus, operationState: 'busy' });
    await Promise.all([first, second]);

    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(callbacks.started).toHaveBeenCalledTimes(1);
    expect(callbacks.succeeded).toHaveBeenCalledWith({
      ...idleStatus,
      operationState: 'busy',
    });
    expect(callbacks.failed).not.toHaveBeenCalled();
  });

  it('reports a safe failure and permits an explicit retry', async () => {
    const getStatus = vi
      .fn<() => Promise<WorkspaceManagementStatus>>()
      .mockRejectedValueOnce(new Error('private path'))
      .mockResolvedValueOnce(idleStatus);
    const callbacks = createCallbacks();
    const controller = new WorkspaceStatusLoadController();

    await controller.load(createCapability(getStatus), callbacks);
    await controller.load(createCapability(getStatus), callbacks);

    expect(callbacks.failed).toHaveBeenCalledTimes(1);
    expect(callbacks.succeeded).toHaveBeenCalledWith(idleStatus);
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('does not publish a stale result after the capability is invalidated', async () => {
    const status = createDeferred<WorkspaceManagementStatus>();
    const callbacks = createCallbacks();
    const controller = new WorkspaceStatusLoadController();

    const loading = controller.load(
      createCapability(() => status.promise),
      callbacks,
    );
    controller.invalidate();
    status.resolve(idleStatus);
    await loading;

    expect(callbacks.succeeded).not.toHaveBeenCalled();
    expect(callbacks.failed).not.toHaveBeenCalled();
  });
});

function createCapability(
  getStatus: () => Promise<WorkspaceManagementStatus>,
): WorkspaceManagementCapability {
  return {
    createEmpty: async () => 'completed',
    getStatus,
    importBackupAsNew: async () => 'cancelled',
    rename: async () => 'completed',
    switchTo: async () => 'completed',
  };
}

function createCallbacks() {
  return {
    failed: vi.fn(),
    started: vi.fn(),
    succeeded: vi.fn(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
