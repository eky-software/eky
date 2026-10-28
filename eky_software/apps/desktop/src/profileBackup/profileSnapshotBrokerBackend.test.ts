import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProfileSnapshotBrokerClient,
} from './profileSnapshotBrokerClient.js';
import { profileSnapshotBrokerProtocolVersion } from './profileSnapshotBrokerProtocol.js';
import { startProfileSnapshotBrokerBackend } from './profileSnapshotBrokerBackend.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

describe('profile snapshot broker boundary', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('releases only the valid drained restore owner through its named operation', async () => {
    const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
    const operationId = randomUUID();
    try {
      await fixture.client.beginRestoreMaintenance(operationId);
      await expect(fixture.client.assertRestoreMaintenance(operationId)).resolves.toBe('busy');
      for (const release of [
        () => fixture.client.endMaintenance(operationId),
        () => fixture.client.endUpdateMaintenance(operationId),
        () => fixture.client.endRestoreMaintenance(randomUUID()),
        () => fixture.client.invalidateRestoreMaintenance(randomUUID()),
      ]) await expect(release()).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      await expect(fixture.client.assertRestoreMaintenance(operationId)).resolves.toBe('busy');
      await expect(fixture.client.endRestoreMaintenance(operationId)).resolves.toBe('normal');
      await fixture.client.beginMaintenance(randomUUID());
    } finally { fixture.close(); }
  });

  it('keeps uncertain restore ownership closed and cannot release or replace it', async () => {
    const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
    const operationId = randomUUID();
    try {
      await fixture.client.beginRestoreMaintenance(operationId);
      await expect(fixture.client.invalidateRestoreMaintenance(operationId)).resolves.toBe('busy');
      await expect(fixture.client.invalidateRestoreMaintenance(operationId)).resolves.toBe('busy');
      await expect(fixture.client.assertRestoreMaintenance(operationId))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      await expect(fixture.client.endRestoreMaintenance(operationId))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      await expect(fixture.client.beginMaintenance(randomUUID()))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_BUSY' });
      await expect(fixture.client.beginRestoreMaintenance(randomUUID()))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_BUSY' });
      await expect(fixture.client.getStatus()).resolves.toBe('busy');
    } finally { fixture.close(); }
  });

  it('invalidates restore at the unchanged ten-minute limit without ordinary release', async () => {
    vi.useFakeTimers();
    const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
    const operationId = randomUUID();
    try {
      await fixture.client.beginRestoreMaintenance(operationId);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fixture.maintenance.getStatus()).toBe('busy');
      await expect(fixture.client.endMaintenance(operationId))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      await expect(fixture.client.endRestoreMaintenance(operationId))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    } finally { fixture.close(); }
  });

  it('allows the exact restore owner to read inspection context without preparing activation', async () => {
    const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
    const operationId = randomUUID();
    const read = vi.spyOn(fixture.snapshot, 'readProfileInspectionContext');
    try {
      await fixture.client.beginRestoreMaintenance(operationId);
      await expect(fixture.client.readProfileInspectionContext(contextInput({ operationId })))
        .resolves.toEqual(readFakeInspectionContext());
      expect(read).toHaveBeenCalledOnce();
      expect(fixture.snapshot.operationIds).toEqual([]);
      await expect(fixture.client.assertRestoreMaintenance(operationId)).resolves.toBe('busy');
      await fixture.client.endRestoreMaintenance(operationId);
    } finally { fixture.close(); }
  });

  it('requires the exact restore owner before reading inspection or activation metadata', async () => {
    const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
    const operationId = randomUUID();
    const read = vi.spyOn(fixture.snapshot, 'readProfileInspectionContext');
    try {
      await fixture.client.beginRestoreMaintenance(operationId);
      for (const input of [
        contextInput(),
        contextInput({ kind: 'prepareRestoreActivation' }),
        contextInput({ operationId, updateMaintenanceOperationId: operationId }),
      ]) await expect(fixture.client.readProfileInspectionContext(input))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      expect(read).not.toHaveBeenCalled();
      await expect(fixture.client.readProfileInspectionContext(contextInput({
        kind: 'prepareRestoreActivation', operationId,
      }))).resolves.toEqual(readFakeInspectionContext());
      await fixture.client.endRestoreMaintenance(operationId);
    } finally { fixture.close(); }
  });

  it.each(['inspect', 'prepareRestoreActivation'] as const)(
    'does not acknowledge a %s context invalidated while its read awaits', async kind => {
    const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
    const entered = deferred<void>();
    const reader = deferred<ReturnType<typeof readFakeInspectionContext>>();
    vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
      entered.resolve(); return reader.promise;
    });
    const operationId = randomUUID();
    try {
      await fixture.client.beginRestoreMaintenance(operationId);
      const outcome = fixture.client.readProfileInspectionContext(contextInput({
        kind, operationId,
      })).then(value => ({ value }), error => ({ error }));
      await entered.promise;
      await expect(fixture.client.invalidateRestoreMaintenance(operationId)).resolves.toBe('busy');
      reader.resolve(readFakeInspectionContext());
      expect(await outcome).toMatchObject({ error: { code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' } });
      expect(fixture.maintenance.getStatus()).toBe('busy');
    } finally { reader.resolve(readFakeInspectionContext()); fixture.close(); }
  });

  it.each(['inspect', 'prepareRestoreActivation'] as const)(
    'rejects foreign invalidation without releasing or blocking an awaiting %s restore context', async kind => {
    const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
    const entered = deferred<void>();
    const reader = deferred<ReturnType<typeof readFakeInspectionContext>>();
    vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
      entered.resolve(); return reader.promise;
    });
    const operationId = randomUUID();
    try {
      await fixture.client.beginRestoreMaintenance(operationId);
      const outcome = fixture.client.readProfileInspectionContext(contextInput({
        kind, operationId,
      })).then(value => ({ value }), error => ({ error }));
      await entered.promise;
      await expect(fixture.client.invalidateRestoreMaintenance(randomUUID()))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      expect(fixture.maintenance.getStatus()).toBe('busy');
      reader.resolve(readFakeInspectionContext());
      expect(await outcome).toEqual({ value: readFakeInspectionContext() });
      await fixture.client.endRestoreMaintenance(operationId);
    } finally { reader.resolve(readFakeInspectionContext()); fixture.close(); }
  });

  it.each(['inspect', 'prepareRestoreActivation'] as const)(
    'rejects late restore %s context without timer dispatch when monotonic validity expires', async kind => {
      const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
      const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
      const operationId = randomUUID();
      const entered = deferred<void>();
      const continuation = deferred<void>();
      vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
        entered.resolve(); await continuation.promise; return readFakeInspectionContext();
      });
      try {
        await fixture.client.beginRestoreMaintenance(operationId);
        const pending = fixture.client.readProfileInspectionContext(contextInput({ kind, operationId }));
        const outcome = pending.then(value => ({ value }), error => ({ error }));
        await entered.promise;
        clock.mockReturnValue(100 + 10 * 60_000);
        continuation.resolve();
        expect(await outcome).toMatchObject({ error: { code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' } });
        expect(fixture.maintenance.getStatus()).toBe('busy');
        clock.mockReturnValue(100);
        await expect(fixture.client.endRestoreMaintenance(operationId))
          .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      } finally { continuation.resolve(); fixture.close(); }
    },
  );

  it('keeps a restore closed when its transport disappears during a context read', async () => {
    const fixture = createContextFixture(new FakeRestoreProfileMaintenance());
    const operationId = randomUUID();
    const entered = deferred<void>();
    const continuation = deferred<void>();
    vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
      entered.resolve(); await continuation.promise; return readFakeInspectionContext();
    });
    try {
      await fixture.client.beginRestoreMaintenance(operationId);
      const outcome = fixture.client.readProfileInspectionContext(contextInput({ operationId }))
        .then(value => ({ value }), error => ({ error }));
      await entered.promise;
      fixture.transports.backend.close();
      continuation.resolve();
      expect(await outcome).toMatchObject({ error: { code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' } });
      expect(fixture.maintenance.getStatus()).toBe('busy');
    } finally { continuation.resolve(); fixture.close(); }
  });

  it('reads the current context without staged validation or snapshot work', async () => {
    const fixture = createContextFixture();
    try {
      await expect(fixture.client.readProfileInspectionContext(contextInput())).resolves.toEqual(readFakeInspectionContext());
      expect(fixture.snapshot.operationIds).toEqual([]);
      fixture.snapshot.readProfileInspectionContext = () => ({ activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true });
      const context = await fixture.client.readProfileInspectionContext(contextInput());
      expect(context).toEqual({ activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true });
      expect(Object.isFrozen(context)).toBe(true);
    } finally { fixture.close(); }
  });

  it('requires the exact ordinary maintenance owner for activation context', async () => {
    const fixture = createContextFixture();
    const operationId = randomUUID();
    const read = vi.spyOn(fixture.snapshot, 'readProfileInspectionContext');
    try {
      await expect(fixture.client.readProfileInspectionContext(contextInput({ kind: 'prepareRestoreActivation', operationId })))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      expect(read).not.toHaveBeenCalled();
      await fixture.client.beginMaintenance(operationId);
      await expect(fixture.client.readProfileInspectionContext(contextInput({ kind: 'prepareRestoreActivation' })))
        .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      await expect(fixture.client.readProfileInspectionContext(contextInput({ kind: 'prepareRestoreActivation', operationId })))
        .resolves.toEqual(readFakeInspectionContext());
      await fixture.client.endMaintenance(operationId);
    } finally { fixture.close(); }
  });

  it('does not acknowledge context when ordinary maintenance becomes invalid while the reader awaits', async () => {
    const fixture = createContextFixture();
    const entered = deferred<void>();
    const reader = deferred<ReturnType<typeof readFakeInspectionContext>>();
    vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
      entered.resolve(); return reader.promise;
    });
    try {
      const operationId = randomUUID();
      await fixture.client.beginMaintenance(operationId);
      const pending = fixture.client.readProfileInspectionContext(contextInput({
        operationId, kind: 'prepareRestoreActivation',
      }));
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      await entered.promise;
      fixture.maintenance.forceEnd();
      reader.resolve(readFakeInspectionContext());
      expect(await outcome).toMatchObject({ error: { code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' } });
      expect(fixture.maintenance.getStatus()).toBe('normal');
    } finally { fixture.close(); }
  });

  it('binds context authority to the old closed channel even when a new channel reads the same profile', async () => {
    const previous = createContextFixture();
    const current = createContextFixture();
    try {
      await previous.client.readProfileInspectionContext(contextInput());
      const assertPrevious = previous.client.captureInspectionAuthority();
      previous.close();
      await expect(current.client.readProfileInspectionContext(contextInput())).resolves.toEqual(readFakeInspectionContext());
      expect(assertPrevious).toThrow('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
    } finally { previous.close(); current.close(); }
  });

  it('rejects a pending context and its captured authority when the private channel closes', async () => {
    const fixture = createContextFixture();
    const entered = deferred<void>();
    const reader = deferred<ReturnType<typeof readFakeInspectionContext>>();
    vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
      entered.resolve(); return reader.promise;
    });
    try {
      const assertAuthority = fixture.client.captureInspectionAuthority();
      const pending = fixture.client.readProfileInspectionContext(contextInput());
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      await entered.promise;
      fixture.transports.backend.close();
      expect(await outcome).toMatchObject({ error: { code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' } });
      expect(assertAuthority).toThrow('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
      reader.resolve(readFakeInspectionContext());
    } finally { fixture.close(); }
  });

  it('counts readiness and the context response inside one caller deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const transports = createTransportPair();
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const sent: unknown[] = [];
    const originalSend = transports.main.send;
    transports.main.send = value => { sent.push(value); originalSend(value); };
    let backend: ReturnType<typeof startProfileSnapshotBrokerBackend> | undefined;
    const entered = deferred<void>();
    const reader = deferred<ReturnType<typeof readFakeInspectionContext>>();
    try {
      const pending = client.readProfileInspectionContext(contextInput({ deadline: performance.now() + 100 }));
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      await vi.advanceTimersByTimeAsync(60);
      const snapshot = createFakeSnapshotService();
      vi.spyOn(snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
        entered.resolve(); return reader.promise;
      });
      backend = startProfileSnapshotBrokerBackend({ maintenance: new FakeProfileMaintenance(), snapshot, transport: transports.backend });
      await entered.promise;
      await vi.advanceTimersByTimeAsync(40);
      expect(await outcome).toMatchObject({ error: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
      expect(sent).toHaveLength(1);
      reader.resolve(readFakeInspectionContext());
      await expect(client.getStatus()).resolves.toBe('normal');
      expect(vi.getTimerCount()).toBe(0);
    } finally { client.close(); backend?.close(); }
  });

  it('requires the exact explicit update owner before handing off a context', async () => {
    const fixture = createContextFixture(new FakeUpdateProfileMaintenance());
    const ownerId = randomUUID();
    const read = vi.spyOn(fixture.snapshot, 'readProfileInspectionContext');
    try {
      await fixture.client.beginUpdateMaintenance(ownerId);
      for (const input of [contextInput(), contextInput({ updateMaintenanceOperationId: randomUUID() }),
        contextInput({ kind: 'prepareRestoreActivation', operationId: ownerId })]) {
        await expect(fixture.client.readProfileInspectionContext(input))
          .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      }
      expect(read).not.toHaveBeenCalled();
      await expect(fixture.client.readProfileInspectionContext(contextInput({ updateMaintenanceOperationId: ownerId })))
        .resolves.toEqual(readFakeInspectionContext());
      await fixture.client.endUpdateMaintenance(ownerId);
    } finally { fixture.close(); }
  });

  it('rechecks the captured update owner after the reader awaits without opening business writes', async () => {
    const fixture = createContextFixture(new FakeUpdateProfileMaintenance());
    const entered = deferred<void>();
    const reader = deferred<ReturnType<typeof readFakeInspectionContext>>();
    vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
      entered.resolve(); return reader.promise;
    });
    try {
      const ownerId = randomUUID();
      await fixture.client.beginUpdateMaintenance(ownerId);
      const pending = fixture.client.readProfileInspectionContext(contextInput({ updateMaintenanceOperationId: ownerId }));
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      await entered.promise;
      fixture.maintenance.forceEnd();
      reader.resolve(readFakeInspectionContext());
      expect(await outcome).toMatchObject({ error: { code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' } });
      expect(fixture.maintenance.getStatus()).toBe('busy');
    } finally { fixture.close(); }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 60_000])(
    'rejects an invalid or enlarged context deadline before sending (%s)', async remaining => {
      const fixture = createContextFixture();
      const send = vi.spyOn(fixture.transports.main, 'send');
      try {
        await expect(fixture.client.readProfileInspectionContext(contextInput({ deadline: performance.now() + remaining })))
          .rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
        expect(send).not.toHaveBeenCalled();
      } finally { fixture.close(); }
    },
  );

  it('cancels readiness without sending a late request', async () => {
    const transports = createTransportPair();
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const send = vi.spyOn(transports.main, 'send');
    const cancellation = new AbortController();
    try {
      const pending = client.readProfileInspectionContext(contextInput({ signal: cancellation.signal }));
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      cancellation.abort();
      expect(await outcome).toMatchObject({ error: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
      expect(send).not.toHaveBeenCalled();
    } finally { client.close(); }
  });

  it('drops a cancelled context answer without poisoning the next request', async () => {
    const fixture = createContextFixture();
    const entered = deferred<void>();
    const reader = deferred<ReturnType<typeof readFakeInspectionContext>>();
    vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementationOnce(async () => {
      entered.resolve(); return reader.promise;
    });
    const cancellation = new AbortController();
    try {
      const pending = fixture.client.readProfileInspectionContext(contextInput({ signal: cancellation.signal }));
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      await entered.promise;
      cancellation.abort();
      expect(await outcome).toMatchObject({ error: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
      reader.resolve({ activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true });
      await expect(fixture.client.readProfileInspectionContext(contextInput())).resolves.toEqual(readFakeInspectionContext());
    } finally { fixture.close(); }
  });

  it('rejects an over-deadline answer even before the timeout callback is dispatched', async () => {
    const fixture = createContextFixture();
    const entered = deferred<void>();
    const reader = deferred<ReturnType<typeof readFakeInspectionContext>>();
    vi.spyOn(fixture.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
      entered.resolve(); return reader.promise;
    });
    try {
      const deadline = performance.now() + 1_000;
      const pending = fixture.client.readProfileInspectionContext(contextInput({ deadline }));
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      await entered.promise;
      vi.spyOn(performance, 'now').mockReturnValue(deadline + 1);
      reader.resolve(readFakeInspectionContext());
      expect(await outcome).toMatchObject({ error: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
    } finally { fixture.close(); }
  });

  it('waits for broker readiness before sending the immediate first status request', async () => {
    const transports = createTransportPair();
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const status = client.getStatus();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance: new FakeProfileMaintenance(),
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });

    await expect(status).resolves.toBe('normal');

    client.close();
    backend.close();
  });

  it('rejects requests when the transport closes before readiness', async () => {
    const transports = createTransportPair();
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);

    transports.backend.close();

    await expect(client.getStatus()).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    client.close();
  });

  it('rejects an unknown ready protocol version without sending a request', async () => {
    const transports = createTransportPair();
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);

    transports.backend.send({
      protocolVersion: profileSnapshotBrokerProtocolVersion + 1,
      type: 'profileSnapshotBrokerReady',
    });

    await expect(client.getStatus()).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    client.close();
  });

  it('rejects pending requests immediately when the broker transport closes', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance: {
        begin: () => new Promise<void>(() => undefined),
        beginUpdate: () => maintenance.beginUpdate(),
        assertUpdate: () => maintenance.assertUpdate(),
        endUpdate: () => maintenance.endUpdate(),
        beginRestore: () => maintenance.beginRestore(),
        assertRestore: () => maintenance.assertRestore(),
        endRestore: () => maintenance.endRestore(),
        invalidateRestore: () => maintenance.invalidateRestore(),
        beginDelete: () => maintenance.beginDelete(),
        assertDelete: () => maintenance.assertDelete(),
        invalidateDelete: () => maintenance.invalidateDelete(),
        end: (operationId) => maintenance.end(operationId),
        forceEnd: () => maintenance.forceEnd(),
        getStatus: () => maintenance.getStatus(),
      },
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    await client.waitUntilReady();
    const pending = client.beginMaintenance(randomUUID());

    transports.backend.close();

    await expect(pending).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    client.close();
    backend.close();
  });

  it('rejects malformed and wrong-type responses without leaving requests pending', async () => {
    const malformedTransports = createTransportPair();
    const malformedClient = new ProfileSnapshotBrokerClient(
      malformedTransports.main,
      1_000,
    );
    installDirectResponder(malformedTransports.backend, (requestId) => ({
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
      result: { type: 'unexpected' },
    }));

    await expect(malformedClient.getStatus()).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    malformedClient.close();

    const wrongTypeTransports = createTransportPair();
    const wrongTypeClient = new ProfileSnapshotBrokerClient(
      wrongTypeTransports.main,
      1_000,
    );
    installDirectResponder(wrongTypeTransports.backend, (requestId) => ({
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
      result: {
        artifactCount: 0,
        artifactTotalByteSize: 0,
        databaseHealth: 'healthy',
        migrationChainIdentity: 'c'.repeat(64),
        profileId: 'd'.repeat(64),
        type: 'activeProfileValidation',
      },
    }));

    await expect(wrongTypeClient.getStatus()).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    });
    wrongTypeClient.close();
  });

  it('starts cleanly again after the previous broker is closed', async () => {
    for (let index = 0; index < 2; index += 1) {
      const transports = createTransportPair();
      const backend = startProfileSnapshotBrokerBackend({
        maintenance: new FakeProfileMaintenance(),
        snapshot: createFakeSnapshotService(),
        transport: transports.backend,
      });
      const client = new ProfileSnapshotBrokerClient(
        transports.main,
        1_000,
      );

      await expect(client.getStatus()).resolves.toBe('normal');

      client.close();
      backend.close();
    }
  });

  it('starts and ends one maintenance operation through the private protocol', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await expect(client.getStatus()).resolves.toBe('normal');
    await expect(client.beginMaintenance(operationId)).resolves.toBe('busy');
    expect(maintenance.status).toBe('busy');
    await expect(client.endMaintenance(operationId)).resolves.toBe('normal');
    expect(maintenance.status).toBe('normal');

    client.close();
    backend.close();
  });

  it('maps busy and mismatched operations to bounded errors', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const firstOperationId = randomUUID();

    await client.beginMaintenance(firstOperationId);
    await expect(
      client.beginMaintenance(randomUUID()),
    ).rejects.toMatchObject({
      code: 'PROFILE_MAINTENANCE_BUSY',
    });
    await expect(
      client.endMaintenance(randomUUID()),
    ).rejects.toMatchObject({
      code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH',
    });

    client.close();
    backend.close();
  });

  it('forces maintenance back to normal when the broker closes', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: createFakeSnapshotService(),
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);

    await client.beginMaintenance(randomUUID());
    backend.close();

    expect(maintenance.status).toBe('normal');
    client.close();
  });

  it('returns only bounded metadata for a consistent profile snapshot', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const snapshot = createFakeSnapshotService();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot,
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId, 'exactCurrentManifest'),
    ).resolves.toEqual({
      artifactCatalog: {
        artifactCount: 1,
        artifactTotalByteSize: 2_048,
        catalogByteSize: 512,
        logicalPath: 'snapshot-catalog-v1.json',
        sha256: 'b'.repeat(64),
      },
      database: {
        databaseByteSize: 8_192,
        logicalPath: 'profile.sqlite',
        sha256: 'a'.repeat(64),
        totalPages: 2,
      },
      type: 'profileSnapshot',
    });
    expect(snapshot.operationIds).toEqual([operationId]);
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('maps snapshot failures without exposing backend details', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        readProfileInspectionContext: readFakeInspectionContext,
        async createProfileSnapshot() {
          throw new Error('PROFILE_SNAPSHOT_DATABASE_FAILED');
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId, 'exactCurrentManifest'),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_DATABASE_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('maps allowlisted errors from dynamically loaded backend realms', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        readProfileInspectionContext: readFakeInspectionContext,
        async createProfileSnapshot() {
          throw Object.freeze({
            message: 'PROFILE_SNAPSHOT_DATABASE_FAILED',
            name: 'Error',
          });
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId, 'exactCurrentManifest'),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_DATABASE_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('separates unknown backend failures from broker availability', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        readProfileInspectionContext: readFakeInspectionContext,
        async createProfileSnapshot() {
          throw new Error('D:\\private\\unexpected-backend-detail');
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId, 'exactCurrentManifest'),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED',
      message: 'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('classifies staging failures without exposing filesystem details', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        readProfileInspectionContext: readFakeInspectionContext,
        async createProfileSnapshot() {
          throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId, 'exactCurrentManifest'),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_STAGING_FAILED',
      message: 'PROFILE_SNAPSHOT_STAGING_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it('maps artifact failures without exposing storage details', async () => {
    const transports = createTransportPair();
    const maintenance = new FakeProfileMaintenance();
    const backend = startProfileSnapshotBrokerBackend({
      maintenance,
      snapshot: {
        readProfileInspectionContext: readFakeInspectionContext,
        async createProfileSnapshot() {
          throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_FAILED');
        },
      },
      transport: transports.backend,
    });
    const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
    const operationId = randomUUID();

    await client.beginMaintenance(operationId);
    await expect(
      client.createProfileSnapshot(operationId, 'exactCurrentManifest'),
    ).rejects.toMatchObject({
      code: 'PROFILE_SNAPSHOT_ARTIFACTS_FAILED',
    });
    await client.endMaintenance(operationId);

    client.close();
    backend.close();
  });

  it.each([
    'validateActiveProfile',
    'validateProfileSnapshot',
    'prepareProfileRestoreActivation',
  ])('rejects retired %s requests without snapshot work or maintenance changes', async operation => {
    const fixture = createContextFixture();
    const requestId = randomUUID();
    const response = deferred<unknown>();
    const read = vi.spyOn(fixture.snapshot, 'readProfileInspectionContext');
    const snapshot = vi.spyOn(fixture.snapshot, 'createProfileSnapshot');
    const unsubscribe = fixture.transports.main.subscribe(value => {
      if (typeof value === 'object' && value !== null &&
        'requestId' in value && value.requestId === requestId) {
        response.resolve(value);
      }
    });
    try {
      fixture.transports.main.send({
        operation,
        ...(operation === 'validateActiveProfile' ? {} : { operationId: randomUUID() }),
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
      });
      expect(await response.promise).toEqual({
        errorCode: 'PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID',
        ok: false,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
      });
      expect(read).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled();
      expect(fixture.maintenance.getStatus()).toBe('normal');
      await expect(fixture.client.getStatus()).resolves.toBe('normal');
    } finally { unsubscribe(); fixture.close(); }
  });
});

function createFakeSnapshotService(): {
  readProfileInspectionContext(): ReturnType<typeof readFakeInspectionContext> | Promise<ReturnType<typeof readFakeInspectionContext>>;
  createProfileSnapshot(input: {
    operationId: string;
    signal: AbortSignal;
  }): Promise<{
    artifactCatalog: {
      artifactCount: number;
      artifactTotalByteSize: number;
      catalogByteSize: number;
      logicalPath: 'snapshot-catalog-v1.json';
      sha256: string;
    };
    database: {
      databaseByteSize: number;
      logicalPath: 'profile.sqlite';
      sha256: string;
      totalPages: number;
    };
  }>;
  operationIds: string[];
} {
  const operationIds: string[] = [];

  return {
    readProfileInspectionContext: readFakeInspectionContext,
    async createProfileSnapshot({ operationId, signal }) {
      expect(signal.aborted).toBe(false);
      operationIds.push(operationId);
      return {
        artifactCatalog: {
          artifactCount: 1,
          artifactTotalByteSize: 2_048,
          catalogByteSize: 512,
          logicalPath: 'snapshot-catalog-v1.json',
          sha256: 'b'.repeat(64),
        },
        database: {
          databaseByteSize: 8_192,
          logicalPath: 'profile.sqlite',
          sha256: 'a'.repeat(64),
          totalPages: 2,
        },
      };
    },
    operationIds,
  };
}

function readFakeInspectionContext() {
  return { activeProfileId: 'd'.repeat(64), activeProfileIsEmpty: false };
}

function contextInput(changed: Partial<Parameters<ProfileSnapshotBrokerClient['readProfileInspectionContext']>[0]> = {}) {
  return { kind: 'inspect' as const, operationId: randomUUID(), deadline: performance.now() + 1_000,
    signal: new AbortController().signal, ...changed };
}

function createContextFixture(maintenance = new FakeProfileMaintenance()) {
  const transports = createTransportPair();
  const snapshot = createFakeSnapshotService();
  const backend = startProfileSnapshotBrokerBackend({ maintenance, snapshot, transport: transports.backend });
  const client = new ProfileSnapshotBrokerClient(transports.main, 1_000);
  return { transports, maintenance, snapshot, client, close() { client.close(); backend.close(); } };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolveTask => { resolve = resolveTask; });
  return { promise, resolve };
}

class FakeProfileMaintenance {
  status: 'busy' | 'normal' = 'normal';
  private operationId: string | undefined;

  async beginDelete(): Promise<void> {
    throw new Error('Delete maintenance requires the real-state boundary fixture.');
  }

  assertDelete(): void {
    throw new Error('Delete maintenance requires the real-state boundary fixture.');
  }

  invalidateDelete(): void {
    throw new Error('Delete maintenance requires the real-state boundary fixture.');
  }

  async beginUpdate(): Promise<void> {
    throw new Error('Update maintenance requires the real-state boundary fixture.');
  }

  assertUpdate(): void {
    throw new Error('Update maintenance requires the real-state boundary fixture.');
  }

  endUpdate(): void {
    throw new Error('Update maintenance requires the real-state boundary fixture.');
  }

  async beginRestore(): Promise<void> {
    throw new Error('Restore maintenance requires the protected-state boundary fixture.');
  }

  assertRestore(): void {
    throw new Error('Restore maintenance requires the protected-state boundary fixture.');
  }

  endRestore(): void {
    throw new Error('Restore maintenance requires the protected-state boundary fixture.');
  }

  invalidateRestore(_operationId?: string): void {
    throw new Error('Restore maintenance requires the protected-state boundary fixture.');
  }

  async begin(operationId: string): Promise<void> {
    if (this.status === 'busy') {
      const error = new Error('busy');
      error.name = 'ProfileMaintenanceBusyError';
      throw error;
    }
    this.operationId = operationId;
    this.status = 'busy';
  }

  end(operationId: string): void {
    if (this.operationId !== operationId) {
      const error = new Error('mismatch');
      error.name = 'ProfileMaintenanceOperationMismatchError';
      throw error;
    }
    this.operationId = undefined;
    this.status = 'normal';
  }

  forceEnd(): void {
    this.operationId = undefined;
    this.status = 'normal';
  }

  getStatus(): 'busy' | 'normal' {
    return this.status;
  }
}

class FakeRestoreProfileMaintenance extends FakeProfileMaintenance {
  private restoreId: string | undefined;
  private validUntil: number | undefined;
  private valid = false;

  override async beginRestore(
    operationId?: string,
    _drainTimeoutMilliseconds?: number,
    durationMilliseconds = 10 * 60_000,
  ): Promise<void> {
    if (this.status !== 'normal' || operationId === undefined) throw new Error('PROFILE_MAINTENANCE_BUSY');
    this.restoreId = operationId;
    this.validUntil = performance.now() + durationMilliseconds;
    this.valid = true;
    this.status = 'busy';
  }

  override assertRestore(operationId?: string): void {
    if (this.validUntil !== undefined && performance.now() >= this.validUntil) this.valid = false;
    if (!this.valid || operationId !== this.restoreId) throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
  }

  override endRestore(operationId?: string): void {
    this.assertRestore(operationId);
    this.restoreId = undefined;
    this.validUntil = undefined;
    this.valid = false;
    this.status = 'normal';
  }

  override invalidateRestore(operationId?: string): void {
    if (this.restoreId === undefined || operationId !== this.restoreId) throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    this.valid = false;
  }

  override end(operationId: string): void {
    if (this.restoreId !== undefined) throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    super.end(operationId);
  }

  override forceEnd(): void {
    if (this.restoreId === undefined) super.forceEnd();
    else this.valid = false;
  }
}

class FakeUpdateProfileMaintenance extends FakeProfileMaintenance {
  private updateId: string | undefined;
  private valid = false;

  override async beginUpdate(operationId?: string): Promise<void> {
    if (this.status !== 'normal' || operationId === undefined) throw new Error('PROFILE_MAINTENANCE_BUSY');
    this.updateId = operationId;
    this.valid = true;
    this.status = 'busy';
  }

  override assertUpdate(operationId?: string): void {
    if (!this.valid || operationId !== this.updateId) throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
  }

  override endUpdate(operationId?: string): void {
    this.assertUpdate(operationId);
    this.status = 'normal';
    this.updateId = undefined;
    this.valid = false;
  }

  override forceEnd(): void {
    if (this.updateId === undefined) super.forceEnd();
    else this.valid = false;
  }
}

function createTransportPair(): {
  backend: ProfileSnapshotBrokerTransport;
  main: ProfileSnapshotBrokerTransport;
} {
  const main = createTransportState();
  const backend = createTransportState();

  const createTransport = (
    own: TransportState,
    peer: TransportState,
  ): ProfileSnapshotBrokerTransport => ({
    close() {
      if (own.closed) {
        return;
      }
      own.closed = true;
      own.listeners.clear();
      queueMicrotask(() => {
        for (const listener of peer.closeListeners) {
          listener();
        }
      });
    },
    send(value) {
      if (own.closed || peer.closed) {
        throw new Error('closed');
      }
      queueMicrotask(() => {
        if (peer.closed) {
          return;
        }
        for (const listener of peer.listeners) {
          listener(value);
        }
      });
    },
    subscribe(listener) {
      own.listeners.add(listener);
      return () => own.listeners.delete(listener);
    },
    subscribeClose(listener) {
      own.closeListeners.add(listener);
      return () => own.closeListeners.delete(listener);
    },
  });

  return {
    backend: createTransport(backend, main),
    main: createTransport(main, backend),
  };
}

interface TransportState {
  closeListeners: Set<() => void>;
  closed: boolean;
  listeners: Set<(value: unknown) => void>;
}

function createTransportState(): TransportState {
  return {
    closeListeners: new Set(),
    closed: false,
    listeners: new Set(),
  };
}

function installDirectResponder(
  backend: ProfileSnapshotBrokerTransport,
  createResponse: (requestId: string) => unknown,
): void {
  backend.subscribe((value) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      'requestId' in value &&
      typeof value.requestId === 'string'
    ) {
      backend.send(createResponse(value.requestId));
    }
  });
  backend.send({
    protocolVersion: profileSnapshotBrokerProtocolVersion,
    type: 'profileSnapshotBrokerReady',
  });
}
