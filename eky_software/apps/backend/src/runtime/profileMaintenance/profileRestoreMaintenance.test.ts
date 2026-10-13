import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProfileMaintenanceBusyError,
  ProfileMaintenanceOperationMismatchError,
  ProfileMaintenanceState,
  ProfileMaintenanceTimeoutError,
} from './profileMaintenanceState.js';

describe('protected profile restore maintenance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('requires the exact drained restore owner for a safe release', async () => {
    const state = new ProfileMaintenanceState();
    const releaseWrite = state.tryBeginBusinessWrite()!;
    const begin = state.beginRestore('restore', 1_000, 10_000);
    expect(() => state.assertRestore('restore')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(() => state.endRestore('restore')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(state.isActiveOperation('restore')).toBe(false);
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
    releaseWrite();
    await begin;
    state.assertRestore('restore');
    expect(state.isActiveOperation('restore')).toBe(true);
    expect(() => state.end('restore')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(() => state.endUpdate('restore')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(() => state.endRestore('other')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(() => state.invalidateRestore('other')).toThrow(ProfileMaintenanceOperationMismatchError);
    state.assertRestore('restore');
    state.endRestore('restore');
    expect(state.getStatus()).toBe('normal');
    state.tryBeginBusinessWrite()!();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    'rejects an invalid duration before acquiring ownership (%s)', async duration => {
      const state = new ProfileMaintenanceState();
      await expect(state.beginRestore('restore', 1_000, duration))
        .rejects.toBeInstanceOf(ProfileMaintenanceOperationMismatchError);
      expect(state.getStatus()).toBe('normal');
    },
  );

  it('keeps a failed drain closed after the original writer completes', async () => {
    vi.useFakeTimers();
    const state = new ProfileMaintenanceState();
    const releaseWrite = state.tryBeginBusinessWrite()!;
    const result = expect(state.beginRestore('restore', 50, 10_000))
      .rejects.toBeInstanceOf(ProfileMaintenanceTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await result;
    releaseWrite();
    state.forceEnd();
    expect(state.getStatus()).toBe('busy');
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
    expect(() => state.endRestore('restore')).toThrow(ProfileMaintenanceOperationMismatchError);
    await expect(state.begin('backup', 1_000)).rejects.toBeInstanceOf(ProfileMaintenanceBusyError);
    await expect(state.beginRestore('new-restore', 1_000, 10_000))
      .rejects.toBeInstanceOf(ProfileMaintenanceBusyError);
  });

  it.each([true, false])(
    'does not revive ownership invalidated during acquisition (draining=%s)', async draining => {
      const state = new ProfileMaintenanceState();
      const releaseWrite = draining ? state.tryBeginBusinessWrite() : undefined;
      const begin = state.beginRestore('restore', 1_000, 10_000);
      state.forceEnd();
      releaseWrite?.();
      await expect(begin).rejects.toBeInstanceOf(ProfileMaintenanceOperationMismatchError);
      expect(state.getStatus()).toBe('busy');
      expect(state.isActiveOperation('restore')).toBe(false);
    },
  );

  it('checks monotonic expiry before a delayed timer and never revives the owner', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
    const state = new ProfileMaintenanceState();
    await state.beginRestore('restore', 1_000, 10_000);
    clock.mockReturnValue(10_099);
    state.assertRestore('restore');
    clock.mockReturnValue(10_100);
    expect(() => state.assertRestore('restore')).toThrow(ProfileMaintenanceOperationMismatchError);
    clock.mockReturnValue(100);
    state.forceEnd();
    expect(() => state.endRestore('restore')).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(state.getStatus()).toBe('busy');
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
  });

  it('latches journal uncertainty and rejects every release on that runtime', async () => {
    const state = new ProfileMaintenanceState();
    await state.beginRestore('restore', 1_000, 10_000);
    state.invalidateRestore('restore');
    state.invalidateRestore('restore');
    state.forceEnd();
    for (const release of [
      () => state.end('restore'), () => state.endUpdate('restore'),
      () => state.endRestore('restore'),
    ]) expect(release).toThrow(ProfileMaintenanceOperationMismatchError);
    expect(state.isActiveOperation('restore')).toBe(false);
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
    expect(state.getStatus()).toBe('busy');
    expect(new ProfileMaintenanceState().getStatus()).toBe('normal');
  });

  it.each(['ordinary', 'update'] as const)(
    'cannot change or release a different maintenance kind (%s)', async kind => {
      const state = new ProfileMaintenanceState();
      if (kind === 'ordinary') await state.begin('operation', 1_000);
      else await state.beginUpdate('operation', 1_000, 10_000);
      expect(() => state.assertRestore('operation')).toThrow(ProfileMaintenanceOperationMismatchError);
      expect(() => state.endRestore('operation')).toThrow(ProfileMaintenanceOperationMismatchError);
      expect(() => state.invalidateRestore('operation')).toThrow(ProfileMaintenanceOperationMismatchError);
      if (kind === 'ordinary') state.end('operation');
      else state.endUpdate('operation');
      expect(state.getStatus()).toBe('normal');
    },
  );
});
