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

  it('burns a rejected authority before a later completion can retry', () => {
    const relaunch = vi.fn();
    const deferred = new DeferredWorkspaceRuntimeRelaunch(relaunch);
    const first = new Error('SYNTHETIC_AUTHORITY_REVOKED');
    deferred.request();
    expect(() => deferred.complete(() => { throw first; })).toThrow(first);
    deferred.request();
    deferred.complete();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('checks authority and returns synchronously without a re-entry window', () => {
    const events: string[] = [];
    const deferred = new DeferredWorkspaceRuntimeRelaunch(() => {
      events.push('return'); deferred.complete();
    });
    deferred.request();
    deferred.complete(() => { events.push('guard'); deferred.complete(); });
    events.push('completed');
    expect(events).toEqual(['guard', 'return', 'completed']);
  });

  it('rejects an asynchronous guard without relaunch or an unhandled rejection', async () => {
    const relaunch = vi.fn();
    const deferred = new DeferredWorkspaceRuntimeRelaunch(relaunch);
    deferred.request();
    expect(() => deferred.complete(async () => { throw new Error('SYNTHETIC_LATE_GUARD'); }))
      .toThrow('WORKSPACE_RELAUNCH_AUTHORITY_ASYNC');
    await Promise.resolve();
    deferred.complete();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('does not repeat a throwing relaunch callback', () => {
    const failure = new Error('SYNTHETIC_RETURN_FAILURE');
    const relaunch = vi.fn(() => { throw failure; });
    const deferred = new DeferredWorkspaceRuntimeRelaunch(relaunch);
    deferred.request();
    expect(() => deferred.complete()).toThrow(failure);
    deferred.complete();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});
