import { describe, expect, it, vi } from 'vitest';

import { DeferredWorkspaceRuntimeRelaunch } from './deferredWorkspaceRuntimeRelaunch.js';

describe('deferred workspace runtime relaunch', () => {
  it('relaunches once only after completion', () => {
    const relaunch = vi.fn();
    const deferred = new DeferredWorkspaceRuntimeRelaunch(relaunch);

    deferred.request();
    expect(relaunch).not.toHaveBeenCalled();

    deferred.complete();
    deferred.complete();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('does not relaunch without a request', () => {
    const relaunch = vi.fn();
    const deferred = new DeferredWorkspaceRuntimeRelaunch(relaunch);

    deferred.complete();

    expect(relaunch).not.toHaveBeenCalled();
    expect(deferred.isRequested()).toBe(false);
  });
});
