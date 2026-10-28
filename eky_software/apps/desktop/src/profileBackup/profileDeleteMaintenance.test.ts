import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import { startProfileSnapshotBrokerBackend } from './profileSnapshotBrokerBackend.js';
import { ProfileMaintenanceState, ProfileMaintenanceOperationMismatchError } from './profileMaintenanceStateTestSupport.js';
import { createProfileSnapshotBrokerRequest, parseProfileSnapshotBrokerRequest,
  profileSnapshotBrokerProtocolVersion } from './profileSnapshotBrokerProtocol.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const mismatch = { code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' };
const context = Object.freeze({ activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: false });
const snapshotResult = {
  artifactCatalog: { artifactCount: 0, artifactTotalByteSize: 0, catalogByteSize: 2,
    logicalPath: 'snapshot-catalog-v1.json' as const, sha256: 'b'.repeat(64) },
  database: { databaseByteSize: 4096, logicalPath: 'profile.sqlite' as const, sha256: 'c'.repeat(64), totalPages: 1 },
};

describe('named delete maintenance state', () => {
  it('blocks new writes immediately, requires drain, and has no same-runtime release', async () => {
    const state = new ProfileMaintenanceState();
    const release = state.tryBeginBusinessWrite()!;
    const begin = state.beginDelete('delete', 1_000, 10_000);
    try {
      expect(state.tryBeginBusinessWrite()).toBeUndefined();
      expect(() => state.assertDelete('delete')).toThrow(ProfileMaintenanceOperationMismatchError);
      release(); await begin;
      state.assertDelete('delete');
      for (const end of [() => state.end('delete'), () => state.endUpdate('delete'),
        () => state.endRestore('delete')]) expect(end).toThrow(ProfileMaintenanceOperationMismatchError);
      expect(state.isActiveOperation('delete')).toBe(true);
      state.forceEnd();
      expect(state.getStatus()).toBe('busy');
      expect(state.isActiveOperation('delete')).toBe(false);
      expect(state.tryBeginBusinessWrite()).toBeUndefined();
    } finally { release(); await begin.catch(() => undefined); state.forceEnd(); }
  });

  it.each([false, true])('cannot revive invalidation during acquisition, draining=%s', async draining => {
    const state = new ProfileMaintenanceState();
    const release = draining ? state.tryBeginBusinessWrite() : undefined;
    const begin = state.beginDelete('delete', 1_000, 10_000);
    state.invalidateDelete('delete'); release?.();
    await expect(begin).rejects.toBeInstanceOf(ProfileMaintenanceOperationMismatchError);
    state.forceEnd();
    expect(state.getStatus()).toBe('busy');
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
  });

  it('retains the closed state after drain timeout and late writer completion', async () => {
    vi.useFakeTimers();
    const state = new ProfileMaintenanceState();
    const release = state.tryBeginBusinessWrite()!;
    const begin = state.beginDelete('delete', 50, 10_000);
    const outcome = begin.catch(error => error);
    try {
      await vi.advanceTimersByTimeAsync(50);
      expect(await outcome).toMatchObject({ name: 'ProfileMaintenanceTimeoutError' });
      release();
      expect(() => state.assertDelete('delete')).toThrow();
      expect(state.tryBeginBusinessWrite()).toBeUndefined();
      await expect(state.begin('other', 1_000)).rejects.toMatchObject({ name: 'ProfileMaintenanceBusyError' });
    } finally { release(); state.forceEnd(); await outcome; }
  });

  it('latches monotonic expiry even if timer dispatch is delayed', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
    const state = new ProfileMaintenanceState();
    await state.beginDelete('delete', 1_000, 10_000);
    clock.mockReturnValue(10_099); state.assertDelete('delete');
    clock.mockReturnValue(10_100); expect(() => state.assertDelete('delete')).toThrow();
    clock.mockReturnValue(100); expect(() => state.assertDelete('delete')).toThrow();
    expect(state.getStatus()).toBe('busy');
    expect(state.tryBeginBusinessWrite()).toBeUndefined();
  });

  it.each([NaN, Infinity, 0, -1])('rejects invalid protected duration %s before claiming', async duration => {
    const state = new ProfileMaintenanceState();
    await expect(state.beginDelete('delete', 1_000, duration)).rejects.toBeInstanceOf(ProfileMaintenanceOperationMismatchError);
    expect(state.getStatus()).toBe('normal');
  });
});

describe('delete snapshot broker with actual maintenance state', () => {
  it('requires the named owner for source and export context while retaining write exclusion', async () => {
    const f = fixture();
    const id = randomUUID();
    try {
      await f.client.beginDeleteMaintenance(id);
      for (const operationId of [id, randomUUID()]) {
        await expect(f.client.readProfileInspectionContext(contextInput(operationId, id))).resolves.toEqual(context);
        expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
      }
      for (const input of [contextInput(id), contextInput(id, randomUUID()),
        { ...contextInput(id), updateMaintenanceOperationId: id },
        { ...contextInput(id), kind: 'prepareRestoreActivation' as const }]) {
        await expect(f.client.readProfileInspectionContext(input)).rejects.toMatchObject(mismatch);
      }
      expect(f.snapshot.readProfileInspectionContext).toHaveBeenCalledTimes(2);
      for (const end of [() => f.client.endMaintenance(id), () => f.client.endUpdateMaintenance(id),
        () => f.client.endRestoreMaintenance(id), () => f.client.invalidateRestoreMaintenance(id)]) {
        await expect(end()).rejects.toMatchObject(mismatch);
      }
      await expect(f.client.assertDeleteMaintenance(id)).resolves.toBe('busy');
      await expect(f.client.createProfileSnapshot(randomUUID(), 'exactCurrentManifest')).rejects.toMatchObject(mismatch);
      expect(f.snapshot.createProfileSnapshot).not.toHaveBeenCalled();
      await expect(f.client.createProfileSnapshot(id, 'exactCurrentManifest')).resolves.toMatchObject({ type: 'profileSnapshot' });
      expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
    } finally { f.close(); }
    expect(f.state.getStatus()).toBe('busy');
  });

  it.each(['ordinary', 'update', 'restore'] as const)('cannot borrow or revoke %s ownership', async kind => {
    const f = fixture(); const id = randomUUID();
    try {
      if (kind === 'ordinary') await f.client.beginMaintenance(id);
      else if (kind === 'update') await f.client.beginUpdateMaintenance(id);
      else await f.client.beginRestoreMaintenance(id);
      await expect(f.client.assertDeleteMaintenance(id)).rejects.toMatchObject(mismatch);
      await expect(f.client.invalidateDeleteMaintenance(id)).rejects.toMatchObject(mismatch);
      await expect(f.client.readProfileInspectionContext(contextInput(id, id))).rejects.toMatchObject(mismatch);
      expect(f.snapshot.readProfileInspectionContext).not.toHaveBeenCalled();
      if (kind === 'ordinary') await expect(f.client.endMaintenance(id)).resolves.toBe('normal');
      else if (kind === 'update') await expect(f.client.endUpdateMaintenance(id)).resolves.toBe('normal');
      else await expect(f.client.endRestoreMaintenance(id)).resolves.toBe('normal');
      f.state.tryBeginBusinessWrite()!();
    } finally { f.close(); }
  });

  it('revokes while begin waits for an existing writer without waiting behind the queue', async () => {
    const f = fixture(); const id = randomUUID(); const entered = deferred<void>();
    const release = f.state.tryBeginBusinessWrite()!;
    const original = f.state.beginDelete.bind(f.state);
    vi.spyOn(f.state, 'beginDelete').mockImplementation((...args) => { const task = original(...args); entered.resolve(); return task; });
    const outcome = f.client.beginDeleteMaintenance(id).catch(error => error);
    try {
      await entered.promise;
      await expect(f.client.invalidateDeleteMaintenance(id)).resolves.toBe('busy');
      expect(await outcome).toMatchObject(mismatch);
      release();
      expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
      await expect(f.client.assertDeleteMaintenance(id)).rejects.toMatchObject(mismatch);
    } finally { release(); f.close(); await outcome; }
  });

  it.each([true, false])('cancels only the exact queued begin before acquisition, matching=%s', async matching => {
    const f = fixture(); const id = randomUUID(); const entered = deferred<void>(); const gate = deferred<void>();
    f.snapshot.readProfileInspectionContext.mockImplementation(async () => {
      entered.resolve(); await gate.promise; return context;
    });
    const beginCalled = vi.spyOn(f.state, 'beginDelete');
    const contextOutcome = f.client.readProfileInspectionContext(contextInput(randomUUID()))
      .then(value => ({ value }), error => ({ error }));
    let beginOutcome: Promise<unknown> | undefined;
    try {
      await entered.promise;
      beginOutcome = f.client.beginDeleteMaintenance(id).catch(error => error);
      // Sending from this client preserves begin-before-invalidate channel order.
      await expect(f.client.invalidateDeleteMaintenance(matching ? id : randomUUID())).rejects.toMatchObject(mismatch);
      expect(beginCalled).not.toHaveBeenCalled();
      gate.resolve();
      expect(await contextOutcome).toEqual({ value: context });
      if (matching) {
        expect(await beginOutcome).toMatchObject(mismatch);
        expect(beginCalled).not.toHaveBeenCalled();
        await expect(f.client.getStatus()).resolves.toBe('normal');
        f.state.tryBeginBusinessWrite()!();
      } else {
        expect(await beginOutcome).toBe('busy');
        expect(beginCalled).toHaveBeenCalledOnce();
        await expect(f.client.assertDeleteMaintenance(id)).resolves.toBe('busy');
        expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
      }
    } finally { gate.resolve(); await Promise.allSettled([contextOutcome, beginOutcome]); f.close(); }
  });

  it.each(['revoke', 'foreignRevoke', 'expire', 'close'] as const)(
    'checks %s against a delayed inspection context before acknowledging', async mode => {
      const f = fixture(); const id = randomUUID(); const entered = deferred<void>(); const gate = deferred<void>();
      const returned = deferred<void>();
      f.snapshot.readProfileInspectionContext.mockImplementation(async () => {
        entered.resolve(); await gate.promise; returned.resolve(); return context;
      });
      let outcome: Promise<unknown> | undefined;
      try {
        await f.client.beginDeleteMaintenance(id);
        outcome = f.client.readProfileInspectionContext(contextInput(randomUUID(), id))
          .then(value => ({ value }), error => ({ error }));
        await entered.promise;
        if (mode === 'revoke') await f.client.invalidateDeleteMaintenance(id);
        if (mode === 'foreignRevoke') await expect(f.client.invalidateDeleteMaintenance(randomUUID())).rejects.toMatchObject(mismatch);
        if (mode === 'expire') vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 10 * 60_000);
        if (mode === 'close') f.close();
        gate.resolve(); await returned.promise;
        const result = await outcome;
        if (mode === 'foreignRevoke') expect(result).toEqual({ value: context });
        else expect(result).toHaveProperty('error');
        if (mode === 'revoke') expect(result).toMatchObject({ error: mismatch });
        // Serial status is a barrier after the context branch settles.
        if (mode !== 'close') await expect(f.client.getStatus()).resolves.toBe('busy');
        expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
        if (mode !== 'foreignRevoke') expect(f.sent.some(value =>
          value.ok === true && value.result?.type === 'profileInspectionContext')).toBe(false);
      } finally { gate.resolve(); await outcome; f.close(); }
    },
  );

  it('rejects an in-flight snapshot after revocation, aborting the owned work without reopening writes', async () => {
    const f = fixture(); const id = randomUUID(); const entered = deferred<void>(); const gate = deferred<void>();
    let signal: AbortSignal | undefined;
    f.snapshot.createProfileSnapshot.mockImplementation(async input => {
      signal = input.signal; entered.resolve(); await gate.promise; return snapshotResult;
    });
    let outcome: Promise<unknown> | undefined;
    try {
      await f.client.beginDeleteMaintenance(id);
      outcome = f.client.createProfileSnapshot(id, 'exactCurrentManifest').catch(error => error);
      await entered.promise;
      await f.client.invalidateDeleteMaintenance(id);
      expect(signal?.aborted).toBe(true);
      gate.resolve(); expect(await outcome).toMatchObject(mismatch);
      await expect(f.client.getStatus()).resolves.toBe('busy');
      expect(f.sent.some(value => value.ok === true && value.result?.type === 'profileSnapshot')).toBe(false);
      expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
    } finally { gate.resolve(); await outcome; f.close(); }
  });

  it('keeps timed-out ownership closed at the existing ten-minute backend boundary', async () => {
    vi.useFakeTimers(); const f = fixture(); const id = randomUUID();
    try {
      await f.client.beginDeleteMaintenance(id);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await expect(f.client.assertDeleteMaintenance(id)).rejects.toMatchObject(mismatch);
      await expect(f.client.endMaintenance(id)).rejects.toMatchObject(mismatch);
      await expect(f.client.beginDeleteMaintenance(randomUUID())).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_BUSY' });
      expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
    } finally { f.close(); }
  });

  it('does not interpret a lost begin acknowledgement as write permission', async () => {
    vi.useFakeTimers(); const f = fixture(50); const id = randomUUID();
    f.dropAcknowledgements();
    const outcome = f.client.beginDeleteMaintenance(id).catch(error => error);
    try {
      await vi.advanceTimersByTimeAsync(50);
      expect(await outcome).toMatchObject({ code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' });
      expect(f.state.getStatus()).toBe('busy');
      expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
    } finally { f.close(); await outcome; }
    expect(f.state.isActiveOperation(id)).toBe(false);
    expect(f.state.getStatus()).toBe('busy');
  });
});

describe('closed protocol and exact installation lease', () => {
  it.each(['beginDeleteMaintenance', 'assertDeleteMaintenance', 'invalidateDeleteMaintenance'] as const)(
    'accepts only the strict named %s request', operation => {
      const input = { operation, operationId: randomUUID(), requestId: randomUUID() };
      const valid = createProfileSnapshotBrokerRequest(input);
      expect(parseProfileSnapshotBrokerRequest(valid)).toEqual(valid);
      for (const changed of [ { operation: 'endDeleteMaintenance' }, { protocolVersion: 12 },
        { companyId: 'foreign' }, { operationId: 'invalid' }, { requestId: 'invalid' }, { path: 'foreign' } ]) {
        expect(parseProfileSnapshotBrokerRequest({ ...valid, ...changed })).toBeUndefined();
      }
    },
  );

  it('rejects mixed, activation, malformed and unrelated-operation delete ownership', () => {
    const id = randomUUID();
    const valid = createProfileSnapshotBrokerRequest({ operation: 'readProfileInspectionContext', kind: 'inspect',
      operationId: randomUUID(), deleteMaintenanceOperationId: id, requestId: randomUUID() });
    expect(parseProfileSnapshotBrokerRequest(valid)).toEqual(valid);
    for (const changed of [{ updateMaintenanceOperationId: id }, { kind: 'prepareRestoreActivation' },
      { deleteMaintenanceOperationId: 'invalid' }, { operation: 'getProfileMaintenanceStatus' }]) {
      expect(parseProfileSnapshotBrokerRequest({ ...valid, ...changed })).toBeUndefined();
    }
    expect(() => createProfileSnapshotBrokerRequest({ operation: 'beginDeleteMaintenance', operationId: id,
      requestId: randomUUID(), deleteMaintenanceOperationId: id })).toThrow('PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID');
  });

  it('captures the actual delete lease and never revives an earlier owner', async () => {
    const lease = new InMemoryWorkspaceMaintenanceLease();
    const first = await lease.acquire('delete');
    const assertFirst = lease.captureCurrentOwner(['delete']);
    expect(() => lease.captureCurrentOwner(['backup', 'restore', 'update'])).toThrow();
    for (const purpose of ['backup', 'create', 'import', 'replace', 'adopt', 'rename', 'switch', 'update', 'restore', 'delete'] as const) {
      await expect(lease.acquire(purpose)).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    }
    assertFirst(); await first.release(); expect(assertFirst).toThrow();
    const second = await lease.acquire('delete'); const assertSecond = lease.captureCurrentOwner(['delete']);
    await first.release(); assertSecond(); expect(assertFirst).toThrow();
    await second.release(); expect(assertSecond).toThrow();
  });
});

function contextInput(operationId: string, deleteMaintenanceOperationId?: string) {
  return { operationId, kind: 'inspect' as const, signal: new AbortController().signal,
    deadline: performance.now() + 1_000,
    ...(deleteMaintenanceOperationId === undefined ? {} : { deleteMaintenanceOperationId }) };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(timeout = 1_000) {
  const state = new ProfileMaintenanceState();
  const sent: Array<{ ok?: boolean; result?: { type?: string } }> = [];
  let drop = false;
  const sides = [0, 1].map(() => ({ closed: false, messages: new Set<(value: unknown) => void>(), closes: new Set<() => void>() }));
  const transports = sides.map((own, index): ProfileSnapshotBrokerTransport => {
    const peer = sides[1 - index]!;
    return {
      close() {
        if (own.closed) return;
        own.closed = true; own.messages.clear();
        for (const listener of [...peer.closes]) listener();
      },
      send(value) {
        if (own.closed || peer.closed) throw new Error('closed');
        const copy: unknown = JSON.parse(JSON.stringify(value));
        if (index === 1) {
          sent.push(copy as typeof sent[number]);
          if (drop) return;
        }
        queueMicrotask(() => { if (!peer.closed) for (const listener of peer.messages) listener(copy); });
      },
      subscribe(listener) { own.messages.add(listener); return () => own.messages.delete(listener); },
      subscribeClose(listener) { own.closes.add(listener); return () => own.closes.delete(listener); },
    };
  });
  const snapshot = {
    readProfileInspectionContext: vi.fn(async () => context),
    createProfileSnapshot: vi.fn(async (_input: { operationId: string; signal: AbortSignal }) => snapshotResult),
  };
  const client = new ProfileSnapshotBrokerClient(transports[0]!, timeout);
  const backend = startProfileSnapshotBrokerBackend({ maintenance: state, snapshot, transport: transports[1]! });
  return { state, client, backend, snapshot, sent, dropAcknowledgements() { drop = true; },
    close() { client.close(); backend.close(); } };
}
