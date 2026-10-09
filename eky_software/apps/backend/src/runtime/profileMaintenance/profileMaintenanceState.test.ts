import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProfileMaintenanceBusyError,
  ProfileMaintenanceOperationMismatchError,
  ProfileMaintenanceState,
  ProfileMaintenanceTimeoutError,
} from './profileMaintenanceState.js';

describe('ProfileMaintenanceState', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('requires a drained update owner and rejects ordinary or mismatched releases', async () => {
    const state = new ProfileMaintenanceState();
    const release = state.tryBeginBusinessWrite()!;
    const begin = state.beginUpdate('update', 1_000, 10_000);
    expect(() => state.assertUpdate('update')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(() => state.endUpdate('update')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(state.isActiveOperation('update')).toBe(false);
    release();
    await begin;
    state.assertUpdate('update');
    expect(state.isActiveOperation('update')).toBe(true);
    expect(() => state.end('update')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(() => state.endUpdate('other')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(() => state.assertUpdate('other')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
    state.endUpdate('update');
    expect(state.getStatus()).toBe('normal');
  });

  it('keeps a timed-out update drain closed after the writer completes', async () => {
    vi.useFakeTimers();
    const state = new ProfileMaintenanceState();
    const release = state.tryBeginBusinessWrite()!;
    const expectation = expect(state.beginUpdate('update', 50, 10_000))
      .rejects.toBeInstanceOf(ProfileMaintenanceTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    release();
    state.forceEnd();
    expect(state.getStatus()).toBe('busy');
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
    expect(() => state.endUpdate('update')).toThrow(ProfileMaintenanceOperationMismatchError);
    await expect(state.begin('ordinary', 1_000)).rejects.toBeInstanceOf(ProfileMaintenanceBusyError);
    await expect(state.beginUpdate('new-update', 1_000, 10_000)).rejects.toBeInstanceOf(ProfileMaintenanceBusyError);
    expect(new ProfileMaintenanceState().getStatus()).toBe('normal');
  });

  it.each([true, false])('does not revive an update invalidated before begin completes (draining=%s)', async (draining) => {
    const state = new ProfileMaintenanceState();
    const release = draining ? state.tryBeginBusinessWrite() : undefined;
    const begin = state.beginUpdate('update', 1_000, 10_000);
    state.forceEnd();
    release?.();
    await expect(begin).rejects.toBeInstanceOf(ProfileMaintenanceOperationMismatchError);
    expect(state.isActiveOperation('update')).toBe(false);
    expect(state.getStatus()).toBe('busy');
  });

  it('checks elapsed monotonic time even without a timer callback and cannot revive after expiry', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
    const state = new ProfileMaintenanceState();
    await state.beginUpdate('update', 1_000, 10_000);
    clock.mockReturnValue(10_099);
    state.assertUpdate('update');
    clock.mockReturnValue(10_100);
    expect(state.isActiveOperation('update')).toBe(false);
    clock.mockReturnValue(100);
    expect(() => state.endUpdate('update')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
  });

  it('does not let the update API release an ordinary operation', async () => {
    const state = new ProfileMaintenanceState();
    await state.begin('ordinary', 1_000);
    expect(() => state.endUpdate('ordinary')).toThrow(ProfileMaintenanceOperationMismatchError);
    state.forceEnd();
    expect(state.getStatus()).toBe('normal');
  });

  it('waits for an active business write and blocks new writes', async () => {
    const state = new ProfileMaintenanceState();
    const release = state.tryBeginBusinessWrite();

    expect(release).toBeTypeOf('function');
    const begin = state.begin('operation-1', 1_000);

    expect(state.getStatus()).toBe('busy');
    expect(state.tryBeginBusinessWrite()).toBeUndefined();

    release?.();
    await expect(begin).resolves.toBeUndefined();
    state.end('operation-1');

    expect(state.getStatus()).toBe('normal');
  });

  it('allows only one maintenance operation at a time', async () => {
    const state = new ProfileMaintenanceState();

    await state.begin('operation-1', 1_000);
    await expect(state.begin('operation-2', 1_000)).rejects.toBeInstanceOf(
      ProfileMaintenanceBusyError,
    );
    expect(() => state.end('operation-2')).toThrow(
      ProfileMaintenanceOperationMismatchError,
    );
    state.end('operation-1');
  });

  it('returns to normal after a drain timeout', async () => {
    vi.useFakeTimers();
    const state = new ProfileMaintenanceState();
    const release = state.tryBeginBusinessWrite();
    const begin = state.begin('operation-1', 50);
    const expectation = expect(begin).rejects.toBeInstanceOf(
      ProfileMaintenanceTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    expect(state.getStatus()).toBe('normal');

    release?.();
    vi.useRealTimers();
  });

  it('makes release functions idempotent', () => {
    const state = new ProfileMaintenanceState();
    const firstRelease = state.tryBeginBusinessWrite();
    const secondRelease = state.tryBeginBusinessWrite();

    firstRelease?.();
    firstRelease?.();
    secondRelease?.();

    expect(state.getStatus()).toBe('normal');
  });
});
