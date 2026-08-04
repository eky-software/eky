import { describe, expect, it, vi } from 'vitest';

import {
  ProfileMaintenanceBusyError,
  ProfileMaintenanceOperationMismatchError,
  ProfileMaintenanceState,
  ProfileMaintenanceTimeoutError,
} from './profileMaintenanceState.js';

describe('ProfileMaintenanceState', () => {
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
