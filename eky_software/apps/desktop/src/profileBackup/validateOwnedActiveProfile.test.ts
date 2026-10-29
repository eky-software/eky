import { afterEach, describe, expect, it, vi } from 'vitest';

import { profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
  type ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { validateOwnedActiveProfile, type OwnedActiveProfileContinuation } from './validateOwnedActiveProfile.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('owned active profile validation', () => {
  it('runs the captured continuation inside the same snapshot and closes its authority', async () => {
    const f = fixture();
    let captured: OwnedActiveProfileContinuation | undefined;
    const use = vi.fn(async (authority: OwnedActiveProfileContinuation) => {
      captured = authority;
      expect(f.isSnapshotActive()).toBe(true); expect(Object.isFrozen(authority)).toBe(true);
      expect(authority.validation).toEqual(f.metadata);
      expect(f.client.endRestoreMaintenance).not.toHaveBeenCalled();
      await authority.assertCurrent(); authority.assertMutationCurrent();
      f.events.push('continuation');
    });
    const input = { ...f.input, useValidatedProfile: use };
    const result = validateOwnedActiveProfile(input);
    input.useValidatedProfile = vi.fn(async () => { throw new Error('LATE_CALLBACK'); });
    await expect(result).resolves.toEqual(f.metadata);
    expect(use).toHaveBeenCalledOnce(); expect(input.useValidatedProfile).not.toHaveBeenCalled();
    expect(f.client.withInspectionOperation).toHaveBeenCalledOnce();
    expect(f.client.withProfileSnapshot).toHaveBeenCalledOnce();
    expect(f.client.validateProfileSnapshot).toHaveBeenCalledOnce();
    expect(f.events.indexOf('continuation')).toBeLessThan(f.events.indexOf('remove'));
    expect(f.lease.readState()).toBe('idle');
    expect(() => captured!.assertMutationCurrent()).toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
    await expect(captured!.assertCurrent()).rejects.toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
    expect(() => captured!.reportFirstFailure(new Error('LATE_FAILURE'))).not.toThrow();
  });

  it.each(['owner', 'lineage', 'borrowed'] as const)('rejects an asynchronous %s guard for a continuation', async kind => {
    const f = fixture();
    const use = vi.fn(async () => {});
    const held = kind === 'borrowed' ? await f.lease.acquire('restore') : undefined;
    try {
      const asynchronous = () => Promise.reject(new Error('SYNTHETIC_ASYNC_GUARD'));
      await expect(validateOwnedActiveProfile({ ...f.input, useValidatedProfile: use,
        ...(kind === 'owner' ? { assertAuthority: asynchronous } : kind === 'lineage'
          ? { assertLineage: asynchronous } : { assertBorrowedRestoreOwner: asynchronous }),
      })).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      expect(use).not.toHaveBeenCalled(); expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
    } finally { await held?.release(); }
  });

  it.each(['mismatch', 'lineage', 'inspection'] as const)('does not enter continuation on %s rejection', async failure => {
    const f = fixture(); const use = vi.fn(async () => {});
    if (failure === 'mismatch') f.receipt.profileId = 'b'.repeat(64);
    if (failure === 'lineage') f.input.assertLineage.mockImplementation(() => { throw new Error('SYNTHETIC_LINEAGE'); });
    if (failure === 'inspection') f.hooks.inspect = async () => { throw new Error('SYNTHETIC_INSPECTION'); };
    await expect(validateOwnedActiveProfile({ ...f.input, useValidatedProfile: use })).rejects.toThrow();
    expect(use).not.toHaveBeenCalled(); expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
  });

  it.each(['throw', 'report', 'lostOwner', 'lostFence'] as const)('preserves continuation failure from %s', async kind => {
    const f = fixture(); const first = new Error('SYNTHETIC_FIRST_CONTINUATION_FAILURE');
    const secondary = new Error('SYNTHETIC_INVALIDATION_FAILURE');
    f.client.invalidateRestoreMaintenance.mockRejectedValueOnce(secondary);
    let captured: OwnedActiveProfileContinuation | undefined;
    await expect(validateOwnedActiveProfile({ ...f.input, useValidatedProfile: async authority => {
      captured = authority;
      if (kind === 'throw') throw first;
      if (kind === 'report') { authority.reportFirstFailure(first); return; }
      if (kind === 'lostOwner') f.input.assertAuthority.mockImplementation(() => { throw first; });
      else f.client.assertRestoreMaintenance.mockRejectedValueOnce(first);
      await authority.assertCurrent();
    } })).rejects.toMatchObject({ errors: [first, secondary] });
    expect(() => captured!.assertMutationCurrent()).toThrow();
    expect(f.client.endRestoreMaintenance).not.toHaveBeenCalled();
    expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy');
  });

  it.each([false, true])('retains first cause and ownership through late continuation work (early report: %s)', async reportEarly => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture(); const entered = deferred(); const finish = deferred(); const settled = deferred();
    const first = new Error('SYNTHETIC_REPORTED_BEFORE_JOIN');
    let captured: OwnedActiveProfileContinuation | undefined; let mutations = 0;
    const result = validateOwnedActiveProfile({ ...f.input, useValidatedProfile: async authority => {
      captured = authority; entered.resolve();
      if (reportEarly) authority.reportFirstFailure(first);
      try { await finish.promise; authority.assertMutationCurrent(); mutations++; }
      finally { settled.resolve(); }
    } });
    const outcome = result.catch(error => error);
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync((reportEarly ? 0 : profileInspectionWorkMilliseconds) + 2 * profileInspectionShutdownMilliseconds);
      const error = await outcome;
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors[0]).toMatchObject({ message: reportEarly ? first.message : 'PROFILE_INSPECTION_TIMEOUT' });
      if (reportEarly) expect(error.errors[0]).toBe(first);
      expect(f.client.invalidateRestoreMaintenance).toHaveBeenCalledOnce();
      expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('busy');
      expect(() => captured!.assertMutationCurrent()).toThrow();
      finish.resolve(); await settled.promise; await vi.advanceTimersByTimeAsync(0);
      captured!.reportFirstFailure(new Error('SYNTHETIC_LATE_REPORT'));
      expect(await outcome).toBe(error); expect(mutations).toBe(0); expect(f.lease.readState()).toBe('busy');
    } finally { finish.resolve(); await settled.promise; await vi.runAllTimersAsync(); await outcome; }
  });

  it('does not reset the work budget after inspection and ignores a late report during cancellation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture(); const entered = deferred(); const finish = deferred(); const settled = deferred();
    f.hooks.inspect = async () => { await vi.advanceTimersByTimeAsync(10_000); };
    const original = validateOwnedActiveProfile({ ...f.input, useValidatedProfile: async authority => {
      entered.resolve();
      try {
        await finish.promise;
        authority.reportFirstFailure(new Error('SYNTHETIC_LATE_FAILURE'));
        authority.assertMutationCurrent();
      } finally { settled.resolve(); }
    } });
    const outcome = original.catch(error => error);
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds - 10_000);
      expect(f.client.invalidateRestoreMaintenance).toHaveBeenCalledOnce();
      finish.resolve(); await settled.promise;
      await vi.advanceTimersByTimeAsync(0);
      await expect(outcome).resolves.toMatchObject({ message: 'PROFILE_INSPECTION_TIMEOUT' });
      expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('busy');
    } finally { finish.resolve(); await settled.promise; await vi.runAllTimersAsync(); await outcome; }
  });

  it('rejects early continuation return while its original grant is still pending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture(); const entered = deferred(); const finish = deferred(); const settled = deferred();
    let grant: Promise<unknown> | undefined;
    const original = validateOwnedActiveProfile({ ...f.input, useValidatedProfile: async authority => {
      f.client.assertRestoreMaintenance.mockImplementationOnce(async () => {
        entered.resolve();
        try { await finish.promise; return 'busy' as const; }
        finally { settled.resolve(); }
      });
      grant = authority.assertCurrent().catch(error => error);
    } });
    const outcome = original.catch(error => error);
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(2 * profileInspectionShutdownMilliseconds);
      const error = await outcome;
      expect(error.errors[0]).toMatchObject({ message: 'ACTIVE_PROFILE_VALIDATION_FAILED' });
      expect(f.client.invalidateRestoreMaintenance).toHaveBeenCalledOnce();
      expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('busy');
    } finally { finish.resolve(); await settled.promise; await vi.runAllTimersAsync(); await grant; await outcome; }
  });

  it('does not let a completed continuation poison a later validation', async () => {
    const f = fixture(); let previous: OwnedActiveProfileContinuation | undefined;
    await validateOwnedActiveProfile({ ...f.input, useValidatedProfile: async authority => { previous = authority; } });
    await expect(validateOwnedActiveProfile({ ...f.input, useValidatedProfile: async authority => {
      previous!.reportFirstFailure(new Error('OLD_GENERATION_FAILURE'));
      expect(() => previous!.assertMutationCurrent()).toThrow();
      await authority.assertCurrent(); authority.assertMutationCurrent();
    } })).resolves.toEqual(f.metadata);
    expect(f.lease.readState()).toBe('idle');
  });

  it.each(['pendingMutation', 'discardedGrant'] as const)('fails closed for %s without an unhandled rejection', async kind => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture(); const entered = deferred(); const finish = deferred(); const settled = deferred();
    const unhandled: unknown[] = [];
    const observeUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on('unhandledRejection', observeUnhandled);
    let mutations = 0;
    const original = validateOwnedActiveProfile({ ...f.input, useValidatedProfile: async authority => {
      f.client.assertRestoreMaintenance.mockImplementationOnce(async () => {
        entered.resolve();
        try { await finish.promise; return 'busy' as const; }
        finally { settled.resolve(); }
      });
      void authority.assertCurrent();
      if (kind === 'pendingMutation') {
        await entered.promise;
        expect(() => { authority.assertMutationCurrent(); mutations++; }).toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
      }
    } });
    const outcome = original.catch(error => error);
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(2 * profileInspectionShutdownMilliseconds);
      expect((await outcome).errors[0]).toMatchObject({ message: 'ACTIVE_PROFILE_VALIDATION_FAILED' });
      expect(mutations).toBe(0); expect(f.lease.readState()).toBe('busy');
      expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
      finish.resolve(); await settled.promise; await vi.advanceTimersByTimeAsync(0);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(unhandled).toEqual([]); expect(f.lease.readState()).toBe('busy');
    } finally {
      finish.resolve(); await settled.promise; await vi.runAllTimersAsync(); await outcome;
      process.off('unhandledRejection', observeUnhandled);
    }
  });

  it.each([false, true])('retains the exact borrowed restore owner (rejected: %s)', async rejected => {
    const f = fixture(); const held = await f.lease.acquire('restore');
    const assertBorrowedRestoreOwner = f.lease.captureCurrentOwner(['restore']);
    const acquire = vi.spyOn(f.lease, 'acquire');
    const first = new Error('synthetic inspection refusal');
    if (rejected) f.hooks.inspect = async () => { throw first; };
    try {
      const result = validateOwnedActiveProfile({ ...f.input, assertBorrowedRestoreOwner });
      if (rejected) await expect(result).rejects.toBe(first);
      else await expect(result).resolves.toEqual(f.metadata);
      expect(acquire).not.toHaveBeenCalled();
      expect(assertBorrowedRestoreOwner).not.toThrow();
      expect(f.lease.readState()).toBe('busy');
      expect(f.client.removeProfileSnapshot).toHaveBeenCalledTimes(rejected ? 0 : 1);
    } finally { await held.release(); }
  });

  it.each(['missing', 'wrongPurpose', 'replaced'] as const)(
    'rejects a %s borrowed owner before starting a fence', async state => {
      const f = fixture();
      let held = state === 'missing' ? undefined : await f.lease.acquire(state === 'wrongPurpose' ? 'update' : 'restore');
      const assertBorrowedRestoreOwner = state === 'replaced' ? f.lease.captureCurrentOwner(['restore']) : () => {};
      if (state === 'replaced') { await held!.release(); held = await f.lease.acquire('restore'); }
      try {
        await expect(validateOwnedActiveProfile({ ...f.input, assertBorrowedRestoreOwner })).rejects.toThrow();
        expect(f.client.beginRestoreMaintenance).not.toHaveBeenCalled();
        expect(f.lease.readState()).toBe(state === 'missing' ? 'idle' : 'busy');
      } finally { await held?.release(); }
    },
  );

  it('rejects a borrowed owner replaced while inspection is awaited', async () => {
    const f = fixture(); let held = await f.lease.acquire('restore');
    const assertBorrowedRestoreOwner = f.lease.captureCurrentOwner(['restore']);
    f.hooks.inspect = async () => { await held.release(); held = await f.lease.acquire('restore'); };
    try {
      await expect(validateOwnedActiveProfile({ ...f.input, assertBorrowedRestoreOwner })).rejects.toThrow();
      expect(f.client.withProfileSnapshot).not.toHaveBeenCalled();
      expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
      expect(f.client.endRestoreMaintenance).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('busy');
    } finally { await held.release(); }
  });

  it('uses the isolated snapshot port and returns only validation metadata after cleanup', async () => {
    const f = fixture();
    const result = await validateOwnedActiveProfile(f.input);
    expect(result).toEqual(f.metadata);
    expect(Object.isFrozen(result)).toBe(true);
    expect(f.events).toEqual(['operation', 'begin', 'snapshot', 'inspect', 'use', 'fence', 'current', 'remove', 'end']);
    expect(f.client.createProfileSnapshot).toHaveBeenCalledWith(f.operationId(), 'exactCurrentManifest');
    expect(f.client.createRestoredProfileSnapshot).not.toHaveBeenCalled();
    expect(f.client.releaseProfileSnapshot).not.toHaveBeenCalled();
    expect(f.input.assertLineage).toHaveBeenCalledWith(f.metadata.profileId);
    expect(f.lease.readState()).toBe('idle');
    expect(f.client.invalidateRestoreMaintenance).not.toHaveBeenCalled();
  });

  it('uses only the explicit C original-chain binding for restore-compatible inspection', async () => {
    const f = fixture('restoreCompatible');
    const current = vi.fn(async () => {});
    await expect(validateOwnedActiveProfile({ ...f.input, beforeUpdateRollbackMigrations: {
      expectedMigrationChainIdentity: f.metadata.migrationChainIdentity, assertCurrent: current,
    } })).resolves.toEqual(f.metadata);
    expect(f.client.createProfileSnapshot).not.toHaveBeenCalled();
    expect(f.client.createRestoredProfileSnapshot).toHaveBeenCalledWith(f.operationId());
    expect(current).toHaveBeenCalled();
  });

  it('rejects malformed C bindings before acquiring maintenance', async () => {
    const f = fixture();
    await expect(validateOwnedActiveProfile({ ...f.input, beforeUpdateRollbackMigrations: {
      expectedMigrationChainIdentity: 'invalid', assertCurrent: async () => {},
    } })).rejects.toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
    expect(f.client.withInspectionOperation).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it.each(['artifactCount', 'artifactTotalByteSize', 'migrationChainIdentity', 'profileId', 'migrationPolicy', 'databaseHealth'] as const)(
    'rejects a %s mismatch without publishing metadata or deleting the snapshot', async key => {
      const f = fixture();
      f.receipt[key] = (typeof f.receipt[key] === 'number' ? 99 : 'mismatched') as never;
      await expect(validateOwnedActiveProfile(f.input)).rejects.toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
      expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
      expect(f.client.endRestoreMaintenance).not.toHaveBeenCalled();
      expect(f.client.invalidateRestoreMaintenance).toHaveBeenCalledOnce();
      expect(f.client.releaseProfileSnapshot).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('busy');
    },
  );

  it('rejects a healthy snapshot that does not match the active lineage', async () => {
    const f = fixture();
    f.inspected.profileMatchesActive = false;
    await expect(validateOwnedActiveProfile(f.input)).rejects.toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
    expect(f.client.withProfileSnapshot).not.toHaveBeenCalled();
    expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
  });

  it('preserves the original lineage failure before invalidation failure and keeps snapshot ownership', async () => {
    const f = fixture();
    const first = new Error('synthetic lineage refusal');
    const invalidation = new Error('synthetic fence acknowledgement failure');
    f.input.assertLineage.mockImplementation(() => { throw first; });
    f.client.invalidateRestoreMaintenance.mockRejectedValue(invalidation);
    await expect(validateOwnedActiveProfile(f.input)).rejects.toMatchObject({ errors: [first, invalidation] });
    expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
    expect(f.client.releaseProfileSnapshot).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy');
  });

  it('does not start a snapshot under a competing installation lease', async () => {
    const f = fixture();
    const owner = await f.lease.acquire('backup');
    try {
      await expect(validateOwnedActiveProfile(f.input)).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
      expect(f.client.beginRestoreMaintenance).not.toHaveBeenCalled();
      expect(f.client.createProfileSnapshot).not.toHaveBeenCalled();
    } finally { await owner.release(); }
  });

  it('rejects C selection changed while inspection is awaited', async () => {
    const f = fixture('restoreCompatible');
    let current = true;
    const first = new Error('synthetic changed C selection');
    f.hooks.inspect = async () => { current = false; };
    await expect(validateOwnedActiveProfile({ ...f.input, beforeUpdateRollbackMigrations: {
      expectedMigrationChainIdentity: f.metadata.migrationChainIdentity,
      assertCurrent: async () => { if (!current) throw first; },
    } })).rejects.toBe(first);
    expect(f.client.withProfileSnapshot).not.toHaveBeenCalled();
    expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
    expect(f.client.releaseProfileSnapshot).not.toHaveBeenCalled();
  });

  it('rejects lost authority after snapshot cleanup without releasing the fence as success', async () => {
    const f = fixture();
    let current = true;
    const first = new Error('synthetic runtime replaced');
    f.hooks.remove = async () => { current = false; };
    f.input.assertAuthority.mockImplementation(() => { if (!current) throw first; });
    await expect(validateOwnedActiveProfile(f.input)).rejects.toBe(first);
    expect(f.client.endRestoreMaintenance).not.toHaveBeenCalled();
    expect(f.client.invalidateRestoreMaintenance).toHaveBeenCalledOnce();
    expect(f.client.releaseProfileSnapshot).not.toHaveBeenCalled();
  });

  it('does not await another C guard after the terminal fence release', async () => {
    const f = fixture('restoreCompatible');
    const current = vi.fn(async () => {
      expect(f.client.endRestoreMaintenance).not.toHaveBeenCalled();
    });
    await expect(validateOwnedActiveProfile({ ...f.input, beforeUpdateRollbackMigrations: {
      expectedMigrationChainIdentity: f.metadata.migrationChainIdentity, assertCurrent: current,
    } })).resolves.toEqual(f.metadata);
    expect(f.events.at(-1)).toBe('end');
    expect(f.lease.readState()).toBe('idle');
  });

  it('keeps admission blocked when terminal release loses its acknowledgement', async () => {
    const f = fixture();
    const first = new Error('synthetic release acknowledgement missing');
    const invalidation = new Error('synthetic already ended operation');
    f.client.endRestoreMaintenance.mockRejectedValue(first);
    f.client.invalidateRestoreMaintenance.mockRejectedValue(invalidation);
    await expect(validateOwnedActiveProfile(f.input)).rejects.toMatchObject({ errors: [first, invalidation] });
    expect(f.client.releaseProfileSnapshot).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy');
  });

  it('checks final lineage before releasing the installation lease', async () => {
    const f = fixture();
    const first = new Error('synthetic final lineage changed');
    let count = 0;
    f.input.assertLineage.mockImplementation(() => { if (++count === 4) throw first; });
    await expect(validateOwnedActiveProfile(f.input)).rejects.toBe(first);
    expect(f.client.endRestoreMaintenance).toHaveBeenCalledOnce();
    expect(f.client.invalidateRestoreMaintenance).toHaveBeenCalledOnce();
    expect(f.lease.readState()).toBe('busy');
  });

  it('keeps the fence and lease when an inspection outlives work and cleanup', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture();
    const pending = deferred();
    f.hooks.inspect = () => pending.promise;
    const result = validateOwnedActiveProfile(f.input);
    const rejected = expect(result).rejects.toBeInstanceOf(AggregateError);
    await f.inspectionStarted;
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds + 2 * profileInspectionShutdownMilliseconds);
    await rejected;
    expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
    expect(f.client.releaseProfileSnapshot).not.toHaveBeenCalled();
    expect(f.client.endRestoreMaintenance).not.toHaveBeenCalled();
    expect(f.client.invalidateRestoreMaintenance).toHaveBeenCalledOnce();
    expect(f.lease.readState()).toBe('busy');
    pending.resolve();
    await vi.runAllTimersAsync();
    expect(f.client.withProfileSnapshot).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy');
  });

  it('does not free the lease while a snapshot deletion acknowledgement is unsettled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture();
    const pending = deferred();
    f.hooks.remove = () => pending.promise;
    const result = validateOwnedActiveProfile(f.input);
    const rejected = expect(result).rejects.toBeInstanceOf(Error);
    await f.removalStarted;
    await vi.advanceTimersByTimeAsync(2 * profileInspectionShutdownMilliseconds);
    await rejected;
    expect(f.client.endRestoreMaintenance).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy');
    pending.resolve();
    await vi.runAllTimersAsync();
    expect(f.lease.readState()).toBe('busy');
  });

  it('does not initiate another C read when inspection resolves after timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture('restoreCompatible');
    const pending = deferred();
    f.hooks.inspect = () => pending.promise;
    const current = vi.fn(async () => {});
    const result = validateOwnedActiveProfile({ ...f.input, beforeUpdateRollbackMigrations: {
      expectedMigrationChainIdentity: f.metadata.migrationChainIdentity, assertCurrent: current,
    } });
    const rejected = expect(result).rejects.toMatchObject({ errors: [
      { message: 'PROFILE_INSPECTION_TIMEOUT' }, { message: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' },
      { message: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' },
    ] });
    await f.inspectionStarted;
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds + 2 * profileInspectionShutdownMilliseconds);
    await rejected;
    const count = current.mock.calls.length;
    pending.resolve();
    await vi.runAllTimersAsync();
    expect(current).toHaveBeenCalledTimes(count);
    expect(f.client.withProfileSnapshot).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy');
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(policy: ProfileInspectionReceipt['migrationPolicy'] = 'exactCurrentManifest') {
  const events: string[] = [];
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const metadata = { artifactCount: 1, artifactTotalByteSize: 8, databaseHealth: 'healthy' as const,
    migrationChainIdentity: 'c'.repeat(64), profileId: 'a'.repeat(64) };
  const receipt: { -readonly [K in keyof ProfileInspectionReceipt]: ProfileInspectionReceipt[K] } = { ...metadata, migrationPolicy: policy,
    artifactIdentity: 'e'.repeat(64), database: { byteSize: 4, sha256: 'd'.repeat(64) },
    artifactCatalog: { byteSize: 4, sha256: 'b'.repeat(64) } };
  const inspected = { ...metadata, type: 'profileSnapshotValidation' as const,
    activeProfileIsEmpty: false, profileMatchesActive: true };
  const hooks = { inspect: async () => {}, remove: async () => {} };
  const inspection = deferred(); const removal = deferred();
  let operationId: string | undefined;
  let snapshotActive = false;
  const client = {
    async withInspectionOperation<T>(use: () => Promise<T>): Promise<T> { events.push('operation'); return use(); },
    beginRestoreMaintenance: vi.fn(async (id: string) => { operationId = id; events.push('begin'); return 'busy' as const; }),
    assertRestoreMaintenance: vi.fn(async () => { events.push('fence'); return 'busy' as const; }),
    endRestoreMaintenance: vi.fn(async () => { events.push('end'); return 'normal' as const; }),
    invalidateRestoreMaintenance: vi.fn(async () => { events.push('invalidate'); return 'busy' as const; }),
    createProfileSnapshot: vi.fn(async () => { events.push('snapshot'); return snapshotMetadata; }),
    createRestoredProfileSnapshot: vi.fn(async () => { events.push('restoredSnapshot'); return snapshotMetadata; }),
    validateProfileSnapshot: vi.fn(async () => {
      events.push('inspect'); inspection.resolve(); await hooks.inspect(); return inspected;
    }),
    async withProfileSnapshot<T>(_id: string,
      use: (receipt: ProfileInspectionReceipt, assertCurrent: () => Promise<void>) => Promise<T>): Promise<T> {
      events.push('use'); snapshotActive = true;
      try { return await use(receipt, async () => { events.push('current'); }); }
      finally { snapshotActive = false; }
    },
    removeProfileSnapshot: vi.fn(async () => { events.push('remove'); removal.resolve(); await hooks.remove(); }),
    releaseProfileSnapshot: vi.fn(async () => { events.push('release'); }),
  };
  vi.spyOn(client, 'withInspectionOperation');
  vi.spyOn(client, 'withProfileSnapshot');
  const snapshotMetadata = { type: 'profileSnapshot' as const,
    artifactCatalog: { artifactCount: 1, artifactTotalByteSize: 8, catalogByteSize: 4,
      logicalPath: 'snapshot-catalog-v1.json' as const, sha256: 'b'.repeat(64) },
    database: { databaseByteSize: 4, logicalPath: 'profile.sqlite' as const, sha256: 'd'.repeat(64), totalPages: 1 } };
  const input = { snapshotClient: client, maintenanceLease: lease,
    assertAuthority: vi.fn(() => {}), assertLineage: vi.fn((_profileId: string) => {}) };
  return { client, input, lease, events, metadata, receipt, inspected, hooks,
    isSnapshotActive: () => snapshotActive,
    inspectionStarted: inspection.promise, removalStarted: removal.promise,
    operationId: () => operationId };
}
