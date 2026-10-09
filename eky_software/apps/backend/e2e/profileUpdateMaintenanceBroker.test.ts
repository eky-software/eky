import { randomUUID } from 'node:crypto';
import { MessageChannel, type MessagePort } from 'node:worker_threads';

import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileMaintenanceState } from '../src/runtime/profileMaintenance/profileMaintenanceState.js';
import { createProfileMaintenanceMiddleware } from '../src/http/profileMaintenance.js';
import type { BackendEnvironment } from '../src/http/runtimeTrust.js';
import { startProfileSnapshotBrokerBackend } from '../../desktop/src/profileBackup/profileSnapshotBrokerBackend.js';
import { ProfileSnapshotBrokerClient } from '../../desktop/src/profileBackup/profileSnapshotBrokerClient.js';
import type { ProfileSnapshotBrokerTransport } from '../../desktop/src/profileBackup/profileSnapshotBrokerTransport.js';
import { LocalUpdateHandoffCoordinator } from '../../desktop/src/update/localUpdateHandoffCoordinator.js';
import type { UpdateJournal } from '../../desktop/src/update/updateJournal.js';
import { InMemoryWorkspaceMaintenanceLease } from '../../desktop/src/workspaces/maintenance/workspaceMaintenanceLease.js';

const fixtures: {
  client: ProfileSnapshotBrokerClient;
  backend: { close(): void };
  closed: Promise<void>;
}[] = [];
const maximumMaintenanceDurationMilliseconds = 10 * 60_000;

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.client.close();
    fixture.backend.close();
    await fixture.closed;
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('update maintenance state, private broker and HTTP write boundary', () => {
  it('keeps HTTP writes blocked across coordinator preparation and delayed handoff', async () => {
    const fixture = createFixture();
    const entered = deferred<void>();
    const finish = deferred<void>();
    const update = createUpdateOwner(fixture, async () => { entered.resolve(); await finish.promise; });
    await update.coordinator.prepareConfirmedUpdate();
    await assertWritesBlocked(fixture);
    const handoff = update.coordinator.handoffPreparedUpdate();
    await entered.promise;
    try {
      await assertWritesBlocked(fixture);
      await expect(update.lease.acquire('switch')).rejects.toThrow();
      await expect(fixture.client.endMaintenance(fixture.operationId)).rejects.toThrow();
    } finally { finish.resolve(); }
    await handoff;
    expect(update.shutdown).toHaveBeenCalledExactlyOnceWith(fixture.operationId);
    expect(update.launch).toHaveBeenCalledOnce();
    expect(update.journal()?.state).toBe('awaitingFirstStart');
    await assertWritesBlocked(fixture);
  });

  it.each(['expiry', 'disconnect'] as const)(
    'keeps the coordinator and HTTP writes closed after preparation loses its fence (%s)', async failure => {
      const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
      const fixture = createFixture();
      const update = createUpdateOwner(fixture);
      await update.coordinator.prepareConfirmedUpdate();
      if (failure === 'expiry') clock.mockReturnValue(100 + maximumMaintenanceDurationMilliseconds);
      else { fixture.backend.close(); await fixture.closed; }
      await expect(update.coordinator.handoffPreparedUpdate()).rejects.toThrow();
      expect(update.shutdown).not.toHaveBeenCalled();
      expect(update.launch).not.toHaveBeenCalled();
      await expect(update.lease.acquire('backup')).rejects.toThrow();
      await expect(update.coordinator.prepareConfirmedUpdate()).rejects.toThrow();
      await assertWritesBlocked(fixture);
    },
  );

  it('reopens HTTP writes only after a verified pre-stop abort', async () => {
    const fixture = createFixture();
    const update = createUpdateOwner(fixture, async () => { throw new Error('synthetic invalid candidate'); });
    await update.coordinator.prepareConfirmedUpdate();
    await assertWritesBlocked(fixture);
    await expect(update.coordinator.handoffPreparedUpdate()).rejects.toThrow();
    expect(update.journal()?.state).toBe('failed');
    expect(update.shutdown).not.toHaveBeenCalled();
    expect(update.launch).not.toHaveBeenCalled();
    expect((await fixture.app.request('/business', { method: 'POST' })).status).toBe(200);
    const lease = await update.lease.acquire('backup');
    await lease.release();
  });

  it('holds writes through a snapshot, rejects competing owners and releases only the update owner', async () => {
    const fixture = createFixture();
    const { client, state, backend, operationId } = fixture;
    await expect(client.beginUpdateMaintenance(operationId)).resolves.toBe('busy');
    backend.assertUpdateMaintenance(operationId);
    await expect(client.assertUpdateMaintenance(operationId)).resolves.toBe('busy');
    await expect(client.createProfileSnapshot(operationId, 'exactCurrentManifest')).resolves.toMatchObject({ type: 'profileSnapshot' });
    await assertWritesBlocked(fixture);
    await expect(client.beginMaintenance(randomUUID())).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_BUSY' });
    await expect(client.beginUpdateMaintenance(randomUUID())).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_BUSY' });
    for (const release of [client.endMaintenance(operationId), client.endUpdateMaintenance(randomUUID())]) {
      await expect(release).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    }
    await expect(client.createProfileSnapshot(randomUUID(), 'exactCurrentManifest')).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    await expect(client.prepareProfileRestoreActivation(operationId)).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    expect(fixture.snapshot.prepareProfileRestoreActivation).not.toHaveBeenCalled();
    state.assertUpdate(operationId);
    await expect(client.endUpdateMaintenance(operationId)).resolves.toBe('normal');
    expect((await fixture.app.request('/business', { method: 'POST' })).status).toBe(200);
  });

  it('does not release the fence while a queued snapshot is still running', async () => {
    const fixture = createFixture();
    const started = deferred<void>();
    const finish = deferred<void>();
    fixture.snapshot.createProfileSnapshot.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      return snapshotMetadata;
    });
    await fixture.client.beginUpdateMaintenance(fixture.operationId);
    const snapshot = fixture.client.createProfileSnapshot(fixture.operationId, 'exactCurrentManifest');
    await started.promise;
    const queued = observeRequest(fixture.backendTransport, 'endUpdateMaintenance');
    const end = fixture.client.endUpdateMaintenance(fixture.operationId);
    await queued;
    await assertWritesBlocked(fixture);
    finish.resolve();
    await snapshot;
    await expect(end).resolves.toBe('normal');
  });

  it('keeps the update fence invalid after a disconnect during drain', async () => {
    const fixture = createFixture();
    const releaseWrite = fixture.state.tryBeginBusinessWrite()!;
    const entered = observeUpdateBegin(fixture.state);
    const begin = fixture.client.beginUpdateMaintenance(fixture.operationId);
    const expectation = expect(begin).rejects.toMatchObject({ code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' });
    await entered;
    expect(() => fixture.backend.assertUpdateMaintenance(fixture.operationId)).toThrow('Profile maintenance operation does not match.');
    fixture.client.close();
    await expectation;
    await fixture.closed;
    releaseWrite();
    await assertWritesBlocked(fixture);
    expect(fixture.state.isActiveOperation(fixture.operationId)).toBe(false);
    expect(() => fixture.state.endUpdate(fixture.operationId)).toThrow();
  });

  it('does not acquire a queued update after the broker has closed', async () => {
    const fixture = createFixture();
    const started = deferred<void>();
    const finish = deferred<void>();
    fixture.snapshot.validateActiveProfile.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      return activeValidation;
    });
    const validation = fixture.client.validateActiveProfile();
    const validationError = expect(validation).rejects.toMatchObject({ code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' });
    await started.promise;
    const queued = observeRequest(fixture.backendTransport, 'beginUpdateMaintenance');
    const begin = fixture.client.beginUpdateMaintenance(fixture.operationId);
    const beginError = expect(begin).rejects.toMatchObject({ code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' });
    await queued;
    fixture.backend.close();
    finish.resolve();
    await validationError;
    await beginError;
    await fixture.closed;
    expect(fixture.state.getStatus()).toBe('normal');
  });

  it.each(['snapshot', 'activeValidation', 'snapshotValidation'] as const)(
    'rejects a late %s result when the monotonic deadline passes without a timer callback', async (operation) => {
      const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
      const fixture = createFixture();
      const started = deferred<void>();
      const finish = deferred<void>();
      const delayed = async <T>(result: T) => {
        started.resolve();
        await finish.promise;
        return result;
      };
      fixture.snapshot.createProfileSnapshot.mockImplementationOnce(() => delayed(snapshotMetadata));
      fixture.snapshot.validateActiveProfile.mockImplementationOnce(() => delayed(activeValidation));
      fixture.snapshot.validateProfileSnapshot.mockImplementationOnce(() => delayed(snapshotValidation));
      await fixture.client.beginUpdateMaintenance(fixture.operationId);
      const work = operation === 'snapshot'
        ? fixture.client.createProfileSnapshot(fixture.operationId, 'exactCurrentManifest')
        : operation === 'activeValidation' ? fixture.client.validateActiveProfile()
          : fixture.client.validateProfileSnapshot(fixture.operationId);
      const expectation = expect(work).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      await started.promise;
      clock.mockReturnValue(100 + maximumMaintenanceDurationMilliseconds);
      finish.resolve();
      await expectation;
      await assertWritesBlocked(fixture);
      await expect(fixture.client.endUpdateMaintenance(fixture.operationId)).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    },
  );

  it('does not publish late snapshot success after close erased broker ownership', async () => {
    const fixture = createFixture();
    const started = deferred<void>();
    const finish = deferred<void>();
    const completed = deferred<void>();
    const send = vi.spyOn(fixture.backendTransport, 'send');
    fixture.snapshot.createProfileSnapshot.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      completed.resolve();
      return snapshotMetadata;
    });
    await fixture.client.beginUpdateMaintenance(fixture.operationId);
    const work = fixture.client.createProfileSnapshot(fixture.operationId, 'exactCurrentManifest');
    const expectation = expect(work).rejects.toMatchObject({ code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' });
    await started.promise;
    fixture.backend.close();
    await expectation;
    finish.resolve();
    await completed.promise;
    await fixture.closed;
    expect(send.mock.calls.some(([value]) =>
      (value as { result?: { type?: string } }).result?.type === 'profileSnapshot',
    )).toBe(false);
    await assertWritesBlocked(fixture);
  });

  it.each(['ordinary', 'update'] as const)('preserves the %s auto-release policy at the existing deadline', async (kind) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = createFixture();
    if (kind === 'update') await fixture.client.beginUpdateMaintenance(fixture.operationId);
    else await fixture.client.beginMaintenance(fixture.operationId);
    await vi.advanceTimersByTimeAsync(maximumMaintenanceDurationMilliseconds);
    await expect(fixture.client.getStatus()).resolves.toBe(kind === 'update' ? 'busy' : 'normal');
    if (kind === 'update') {
      await expect(fixture.client.assertUpdateMaintenance(fixture.operationId)).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      await expect(fixture.client.createProfileSnapshot(fixture.operationId, 'exactCurrentManifest')).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
      expect(fixture.snapshot.createProfileSnapshot).not.toHaveBeenCalled();
      await assertWritesBlocked(fixture);
    } else {
      expect((await fixture.app.request('/business', { method: 'POST' })).status).toBe(200);
    }
  });

  it('keeps a failed update drain closed through the client and HTTP boundary', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = createFixture();
    const release = fixture.state.tryBeginBusinessWrite()!;
    const entered = observeUpdateBegin(fixture.state);
    const failure = expect(fixture.client.beginUpdateMaintenance(fixture.operationId))
      .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_TIMEOUT' });
    await entered;
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    release();
    await assertWritesBlocked(fixture);
    await expect(fixture.client.endUpdateMaintenance(fixture.operationId)).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
  });

  it('still releases ordinary maintenance when its broker closes', async () => {
    const fixture = createFixture();
    await fixture.client.beginMaintenance(fixture.operationId);
    fixture.backend.close();
    await fixture.closed;
    expect((await fixture.app.request('/business', { method: 'POST' })).status).toBe(200);
  });
});

function createUpdateOwner(fixture: ReturnType<typeof createFixture>, revalidate?: () => Promise<void>) {
  let journal: Readonly<UpdateJournal> | undefined;
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const identity = {
    appVersion: '0.2.81', msiProductVersion: '0.2.81', buildRevision: 'a'.repeat(40),
    packageSha256: 'b'.repeat(64), packageSize: 1024,
  };
  const shutdown = vi.fn(async (operationId: string) => {
    fixture.backend.assertUpdateMaintenance(operationId);
    await assertWritesBlocked(fixture);
    fixture.backend.assertUpdateMaintenance(operationId);
    fixture.backend.close();
  });
  const launch = vi.fn(async () => undefined);
  const coordinator = new LocalUpdateHandoffCoordinator({
    cache: {
      async readExpectedPackageIdentity(role) {
        return role === 'current' ? identity : { ...identity, appVersion: '0.3.0', msiProductVersion: '0.3.0' };
      },
      async revalidateJournalPackage() {
        await revalidate?.();
        return { appVersion: '0.3.0', msiProductVersion: '0.3.0', buildRevision: identity.buildRevision,
          packagePath: 'synthetic-not-launched.msi', productCode: '{22222222-2222-4222-8222-222222222222}' };
      },
    },
    journalStore: {
      async read() { return journal; },
      async readForLiveOwner() { return journal; },
      async write(value) { journal = value; },
      async clear() { journal = undefined; },
    },
    maintenanceLease: lease,
    operationIdFactory: () => fixture.operationId,
    profileProtection: {
      async createValidatedPreUpdatePoint(operationId) {
        await fixture.client.createProfileSnapshot(operationId, 'exactCurrentManifest');
        return '11111111-1111-4111-8111-111111111111';
      },
      async beginUpdateMaintenance(operationId) { await fixture.client.beginUpdateMaintenance(operationId); },
      async assertUpdateMaintenance(operationId) { await fixture.client.assertUpdateMaintenance(operationId); },
      async endUpdateMaintenance(operationId) { await fixture.client.endUpdateMaintenance(operationId); },
      validateActiveProfile: () => fixture.client.validateActiveProfile(),
    },
    shutdownRuntime: shutdown,
    launchInstaller: launch,
  });
  return { coordinator, journal: () => journal, launch, lease, shutdown };
}

function createFixture() {
  const channel = new MessageChannel();
  const closed = Promise.all([channel.port1, channel.port2].map(
    (port) => new Promise<void>((resolve) => port.once('close', resolve)),
  )).then(() => undefined);
  const state = new ProfileMaintenanceState();
  const snapshot = {
    createProfileSnapshot: vi.fn(async () => snapshotMetadata),
    validateActiveProfile: vi.fn(async () => activeValidation),
    validateProfileSnapshot: vi.fn(async () => snapshotValidation),
    prepareProfileRestoreActivation: vi.fn(async () => ({ artifactCount: 0, artifactTotalByteSize: 0 })),
  };
  const backendTransport = transport(channel.port2);
  const backend = startProfileSnapshotBrokerBackend({ maintenance: state, snapshot, transport: backendTransport });
  const client = new ProfileSnapshotBrokerClient(transport(channel.port1));
  const app = new Hono<BackendEnvironment>();
  app.use('*', createProfileMaintenanceMiddleware(state));
  app.get('/health', (context) => context.json({ status: 'ok' }));
  app.post('/business', (context) => context.json({ ok: true }));
  const fixture = { app, backend, backendTransport, client, closed, operationId: randomUUID(), snapshot, state };
  fixtures.push(fixture);
  return fixture;
}

function transport(port: MessagePort): ProfileSnapshotBrokerTransport {
  return {
    close: () => port.close(),
    send: (value) => port.postMessage(value),
    subscribe(listener) {
      port.on('message', listener);
      return () => { port.off('message', listener); };
    },
    subscribeClose(listener) {
      port.on('close', listener);
      return () => { port.off('close', listener); };
    },
  };
}

async function assertWritesBlocked(fixture: ReturnType<typeof createFixture>) {
  expect((await fixture.app.request('/health')).status).toBe(200);
  const response = await fixture.app.request('/business', { method: 'POST' });
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    code: 'PROFILE_MAINTENANCE_ACTIVE', error: 'Service is temporarily unavailable.',
  });
}

function observeUpdateBegin(state: ProfileMaintenanceState): Promise<void> {
  const entered = deferred<void>();
  const beginUpdate = state.beginUpdate.bind(state);
  vi.spyOn(state, 'beginUpdate').mockImplementation((...args) => {
    const result = beginUpdate(...args);
    entered.resolve();
    return result;
  });
  return entered.promise;
}

function observeRequest(
  backendTransport: ProfileSnapshotBrokerTransport,
  operation: string,
): Promise<void> {
  const received = deferred<void>();
  // Registered after the broker: this acknowledges its synchronous enqueue.
  const unsubscribe = backendTransport.subscribe((value) => {
    if ((value as { operation?: unknown }).operation === operation) {
      unsubscribe();
      received.resolve();
    }
  });
  return received.promise;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const activeValidation = {
  artifactCount: 0, artifactTotalByteSize: 0, databaseHealth: 'healthy' as const,
  migrationChainIdentity: 'c'.repeat(64), profileId: 'd'.repeat(64),
};
const snapshotValidation = { ...activeValidation, activeProfileIsEmpty: false, profileMatchesActive: true };
const snapshotMetadata = {
  artifactCatalog: {
    artifactCount: 0, artifactTotalByteSize: 0, catalogByteSize: 32,
    logicalPath: 'snapshot-catalog-v1.json' as const, sha256: 'a'.repeat(64),
  },
  database: { databaseByteSize: 4096, logicalPath: 'profile.sqlite' as const, sha256: 'b'.repeat(64), totalPages: 1 },
};
