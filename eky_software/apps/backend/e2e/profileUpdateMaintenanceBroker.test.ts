import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';

import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileMaintenanceState } from '../src/runtime/profileMaintenance/profileMaintenanceState.js';
import { createProfileMaintenanceMiddleware } from '../src/http/profileMaintenance.js';
import type { BackendEnvironment } from '../src/http/runtimeTrust.js';
import { startProfileSnapshotBrokerBackend } from '../../desktop/src/profileBackup/profileSnapshotBrokerBackend.js';
import { ProfileSnapshotBrokerClient } from '../../desktop/src/profileBackup/profileSnapshotBrokerClient.js';
import { ProfileSnapshotInspectionClient } from '../../desktop/src/profileBackup/profileSnapshotInspectionClient.js';
import type { runProfileSnapshotInspection } from '../../desktop/src/profileBackup/runProfileSnapshotInspection.js';
import type { OwnedProfileBackupInspectionReservation } from '../../desktop/src/profileBackup/inspectOwnedEncryptedProfileBackup.js';
import { createProfileSnapshotArtifactIdentity } from '../../desktop/src/runtime/profileInspectionArtifactIdentity.js';
import { ProfileInspectionProcessError } from '../../desktop/src/runtime/profileInspectionProcess.js';
import { profileInspectionProtocolVersion } from '../../desktop/src/runtime/profileInspectionMessages.js';
import type { ProfileSnapshotBrokerTransport } from '../../desktop/src/profileBackup/profileSnapshotBrokerTransport.js';
import { LocalUpdateHandoffCoordinator } from '../../desktop/src/update/localUpdateHandoffCoordinator.js';
import type { UpdateJournal } from '../../desktop/src/update/updateJournal.js';
import { InMemoryWorkspaceMaintenanceLease } from '../../desktop/src/workspaces/maintenance/workspaceMaintenanceLease.js';
import { RecoveryPointKeyProtector } from '../../desktop/src/profileBackup/recoveryPoint/recoveryPointKeyProtector.js';
import { RecoveryPointService } from '../../desktop/src/profileBackup/recoveryPoint/recoveryPointService.js';
import { RecoveryPointStore } from '../../desktop/src/profileBackup/recoveryPoint/recoveryPointStore.js';
import { RecoveryPointRotationService } from '../../desktop/src/profileBackup/recoveryPoint/recoveryPointRotationService.js';

const inspectionBoundary = vi.hoisted(() => ({ run: vi.fn<typeof runProfileSnapshotInspection>() }));
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock('../../desktop/src/profileBackup/runProfileSnapshotInspection.js', () => ({
  runProfileSnapshotInspection: inspectionBoundary.run,
}));

const fixtures: {
  client: ProfileSnapshotBrokerClient;
  backend: { close(): void };
  closed: Promise<void>;
}[] = [];
const maximumMaintenanceDurationMilliseconds = 10 * 60_000;
const temporaryRoots: string[] = [];

afterEach(async (context) => {
  const roots = temporaryRoots.splice(0);
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state !== 'pass' || context.signal.aborted) return;
    for (const root of roots) await rm(root, { force: true, recursive: true });
  });
  for (const fixture of fixtures.splice(0)) {
    fixture.client.close();
    fixture.backend.close();
    await fixture.closed;
  }
  vi.restoreAllMocks();
  inspectionBoundary.run.mockReset();
  vi.useRealTimers();
});

describe('update maintenance state, private broker and HTTP write boundary', () => {
  it('self-validates a real encrypted pre-update point in independent staging under the same update owner', async () => {
    const { fixture, inspectionOperationId, inspector, service, stagingRoot, store } = await createEncryptedPointFixture();
    await fixture.client.beginUpdateMaintenance(fixture.operationId);
    const point = await service.createPreUpdateWithMaintenance(fixture.operationId);
    expect(point).toMatchObject({ kind: 'preUpdate', state: 'validatedGood' });
    expect(inspectionOperationId).not.toBe(fixture.operationId);
    expect(inspectionBoundary.run.mock.calls.map(([input]) => input.operationId))
      .toEqual([fixture.operationId, inspectionOperationId]);
    expect(inspectionBoundary.run.mock.calls.map(([input]) => input.updateMaintenanceOperationId))
      .toEqual([fixture.operationId, fixture.operationId]);
    expect(inspectionBoundary.run.mock.calls.map(([input]) => input.migrationPolicy))
      .toEqual(['exactCurrentManifest', 'restoreCompatible']);
    expect(Object.keys(fixture.snapshot).sort()).toEqual([
      'createProfileSnapshot', 'readProfileInspectionContext',
    ]);
    expect(fixture.snapshot.readProfileInspectionContext).toHaveBeenCalledTimes(4);
    await expect(store.list(activeValidation.profileId)).resolves.toEqual([point]);
    await expect(readFile(join(stagingRoot, fixture.operationId, 'profile.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(stagingRoot, inspectionOperationId, 'profile.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
    await fixture.client.assertUpdateMaintenance(fixture.operationId);
    await assertWritesBlocked(fixture);
    await fixture.client.endUpdateMaintenance(fixture.operationId);
    await inspector.shutdown();
  });

  it.each(['settled', 'unreclaimed', 'disconnected', 'observerFailure', 'beforeInspection'] as const)('gates failed inspection cleanup on process exit and native ownership (%s)', async (outcome) => {
    const { fixture, inspectionOperationId, inspector, owners, database, service, stagingRoot, store } = await createEncryptedPointFixture();
    const entered = deferred<void>();
    const finish = deferred<void>();
    const inspect = inspectionBoundary.run.getMockImplementation()!;
    const firstFailure = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED', {
      processAbsent: true, reservationReclaimed: outcome !== 'unreclaimed', forced: false,
    });
    inspectionBoundary.run.mockImplementation(async input => {
      if (outcome === 'beforeInspection') throw firstFailure;
      if (input.operationId !== inspectionOperationId) return inspect(input);
      entered.resolve();
      await finish.promise;
      throw firstFailure;
    });
    await fixture.client.beginUpdateMaintenance(fixture.operationId);
    const creating = service.createPreUpdateWithMaintenance(fixture.operationId);
    const result = creating.then(() => { throw new Error('EXPECTED_INSPECTION_FAILURE'); }, error => error);
    const inspectionPath = join(stagingRoot, inspectionOperationId, 'profile.sqlite');
    const injectedObservationFailure = new Error('SYNTHETIC_OBSERVATION_FAILURE');
    let observationFailure: unknown;
    const cleanupFailures: unknown[] = [];
    try {
      await Promise.race([entered.promise, result.then(error => { throw error; })]);
      await expect(readFile(inspectionPath, 'utf8')).resolves.toBe(database);
      await expect(inspector.removeProfileSnapshot(inspectionOperationId))
        .rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      expect(owners.get(inspectionOperationId)!.close).not.toHaveBeenCalled();
      if (outcome === 'disconnected') { fixture.backend.close(); await fixture.closed; }
      if (outcome === 'observerFailure') throw injectedObservationFailure;
    } catch (error) { observationFailure = error; }
    finally {
      finish.resolve();
      try {
        const failure = await result;
        await expect(store.list(activeValidation.profileId)).resolves.toEqual([]);
        if (outcome === 'beforeInspection') {
          expect(failure).toBe(firstFailure);
          expect(owners.has(inspectionOperationId)).toBe(false);
          expect(owners.get(fixture.operationId)!.close).toHaveBeenCalledOnce();
          await expect(readFile(join(stagingRoot, fixture.operationId, 'profile.sqlite')))
            .rejects.toMatchObject({ code: 'ENOENT' });
        } else if (outcome !== 'unreclaimed') {
          expect(failure).toBe(firstFailure);
          await expect(readFile(inspectionPath)).rejects.toMatchObject({ code: 'ENOENT' });
          expect(owners.get(inspectionOperationId)!.close).toHaveBeenCalledOnce();
        } else {
          expect(failure).toMatchObject({ cleanupStatus: 'unverified',
            cause: { cleanupStatus: 'unverified', cause: firstFailure } });
          await expect(readFile(inspectionPath, 'utf8')).resolves.toBe(database);
          expect(owners.get(inspectionOperationId)!.close).not.toHaveBeenCalled();
          expect(owners.get(inspectionOperationId)!.invalidate).toHaveBeenCalled();
        }
        if (outcome === 'settled') await fixture.client.assertUpdateMaintenance(fixture.operationId);
        await assertWritesBlocked(fixture);
      } catch (error) { cleanupFailures.push(error); }
      try {
        if (outcome === 'unreclaimed') {
          await expect(inspector.shutdown()).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
        } else await inspector.shutdown();
      } catch (error) { cleanupFailures.push(error); }
    }
    if (outcome === 'beforeInspection') expect(observationFailure).toBe(firstFailure);
    else if (outcome === 'observerFailure') expect(observationFailure).toBe(injectedObservationFailure);
    else if (observationFailure !== undefined) throw observationFailure;
    if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, 'Inspection cleanup verification failed');
  });

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
    await expect(client.readProfileInspectionContext({
      kind: 'prepareRestoreActivation', operationId,
      deadline: performance.now() + 1_000, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    expect(fixture.snapshot.readProfileInspectionContext).not.toHaveBeenCalled();
    state.assertUpdate(operationId);
    await expect(client.endUpdateMaintenance(operationId)).resolves.toBe('normal');
    expect((await fixture.app.request('/business', { method: 'POST' })).status).toBe(200);
  });

  it('requires a live explicit update owner for inspection context without loosening snapshot creation', async () => {
    const fixture = createFixture();
    const inspectionOperationId = randomUUID();
    const inspectionInput = { kind: 'inspect' as const, operationId: inspectionOperationId,
      deadline: performance.now() + 1_000, signal: new AbortController().signal };
    const validate = () => fixture.client.readProfileInspectionContext({
      ...inspectionInput, updateMaintenanceOperationId: fixture.operationId,
    });
    await expect(validate()).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    await fixture.client.beginMaintenance(fixture.operationId);
    await expect(validate()).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    await fixture.client.endMaintenance(fixture.operationId);
    await fixture.client.beginUpdateMaintenance(fixture.operationId);
    await expect(fixture.client.readProfileInspectionContext(inspectionInput))
      .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    await expect(fixture.client.readProfileInspectionContext({ ...inspectionInput, updateMaintenanceOperationId: randomUUID() }))
      .rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    expect(fixture.snapshot.readProfileInspectionContext).not.toHaveBeenCalled();
    await expect(validate()).resolves.toEqual(inspectionContext);
    expect(fixture.snapshot.readProfileInspectionContext).toHaveBeenCalledExactlyOnceWith();
    await expect(fixture.client.createProfileSnapshot(inspectionOperationId, 'exactCurrentManifest')).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    await fixture.client.endUpdateMaintenance(fixture.operationId);
    await expect(validate()).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
    await expect(fixture.client.readProfileInspectionContext(inspectionInput)).resolves.toEqual(inspectionContext);
  });

  it.each(['expiry', 'disconnect'] as const)('does not acknowledge a late independent inspection context after %s', async (failure) => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
    const fixture = createFixture();
    const entered = deferred<void>();
    const finish = deferred<void>();
    const completed = deferred<void>();
    const send = vi.spyOn(fixture.backendTransport, 'send');
    fixture.snapshot.readProfileInspectionContext.mockImplementationOnce(async () => {
      entered.resolve();
      await finish.promise;
      completed.resolve();
      return inspectionContext;
    });
    await fixture.client.beginUpdateMaintenance(fixture.operationId);
    const work = fixture.client.readProfileInspectionContext({
      kind: 'inspect', operationId: randomUUID(), updateMaintenanceOperationId: fixture.operationId,
      deadline: performance.now() + 1_000,
      signal: new AbortController().signal,
    });
    const expectation = expect(work).rejects.toMatchObject({ code: failure === 'expiry'
      ? 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' : 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' });
    await entered.promise;
    if (failure === 'expiry') clock.mockReturnValue(100 + maximumMaintenanceDurationMilliseconds);
    else fixture.backend.close();
    finish.resolve();
    await completed.promise;
    await expectation;
    expect(send.mock.calls.some(([value]) => (value as { result?: { type?: string } }).result?.type === 'profileInspectionContext')).toBe(false);
    await assertWritesBlocked(fixture);
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
    fixture.snapshot.readProfileInspectionContext.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      return inspectionContext;
    });
    const validation = fixture.client.readProfileInspectionContext({
      kind: 'inspect', operationId: randomUUID(),
      deadline: performance.now() + 1_000, signal: new AbortController().signal,
    });
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

  it.each(['snapshot', 'inspectionContext'] as const)(
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
      fixture.snapshot.readProfileInspectionContext.mockImplementationOnce(() => delayed(inspectionContext));
      await fixture.client.beginUpdateMaintenance(fixture.operationId);
      const work = operation === 'snapshot'
        ? fixture.client.createProfileSnapshot(fixture.operationId, 'exactCurrentManifest')
        : fixture.client.readProfileInspectionContext({
          kind: 'inspect', operationId: fixture.operationId, updateMaintenanceOperationId: fixture.operationId,
          deadline: performance.now() + 1_000,
          signal: new AbortController().signal,
        });
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
      async validateActiveProfileForUpdate(context) {
        context.assertCurrent();
        // This coordinator fixture supplies validation; broker context is not a content proof.
        context.confirmCleanup();
        return activeValidation;
      },
    },
    shutdownRuntime: shutdown,
    launchInstaller: launch,
  });
  return { coordinator, journal: () => journal, launch, lease, shutdown };
}

function createFixture(requestTimeoutMilliseconds?: number) {
  const channel = new MessageChannel();
  const closed = Promise.all([channel.port1, channel.port2].map(
    (port) => new Promise<void>((resolve) => port.once('close', resolve)),
  )).then(() => undefined);
  const state = new ProfileMaintenanceState();
  const snapshot = {
    createProfileSnapshot: vi.fn(async (_input: {
      migrationPolicy: 'exactCurrentManifest' | 'compatibleHistoricalPrefix';
      operationId: string;
      signal: AbortSignal;
    }) => snapshotMetadata),
    readProfileInspectionContext: vi.fn(async () => inspectionContext),
  };
  const backendTransport = transport(channel.port2);
  const backend = startProfileSnapshotBrokerBackend({ maintenance: state, snapshot, transport: backendTransport });
  const client = new ProfileSnapshotBrokerClient(transport(channel.port1), requestTimeoutMilliseconds);
  const app = new Hono<BackendEnvironment>();
  app.use('*', createProfileMaintenanceMiddleware(state));
  app.get('/health', (context) => context.json({ status: 'ok' }));
  app.post('/business', (context) => context.json({ ok: true }));
  const fixture = { app, backend, backendTransport, client, closed, operationId: randomUUID(), snapshot, state };
  fixtures.push(fixture);
  return fixture;
}

async function createEncryptedPointFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-update-recovery-boundary-'));
  temporaryRoots.push(root);
  const stagingRoot = join(root, 'staging');
  const quarantineRoot = join(root, 'quarantine');
  await mkdir(quarantineRoot, { mode: 0o700 });
  const fixture = createFixture();
  const inspectionOperationId = randomUUID();
  const database = 'synthetic-update-snapshot';
  const catalog = '{"artifacts":[]}';
  fixture.snapshot.createProfileSnapshot.mockImplementationOnce(async ({ operationId }) => {
    const operationRoot = join(stagingRoot, operationId);
    await mkdir(operationRoot, { recursive: true });
    await writeFile(join(operationRoot, 'profile.sqlite'), database);
    await writeFile(join(operationRoot, 'snapshot-catalog-v1.json'), catalog);
    return {
      artifactCatalog: { ...snapshotMetadata.artifactCatalog, catalogByteSize: Buffer.byteLength(catalog),
        sha256: createHash('sha256').update(catalog).digest('hex') },
      database: { ...snapshotMetadata.database, databaseByteSize: Buffer.byteLength(database),
        sha256: createHash('sha256').update(database).digest('hex') },
    };
  });
  const owners = new Map<string, OwnedProfileBackupInspectionReservation>();
  const inspector = new ProfileSnapshotInspectionClient({
    broker: fixture.client, stagingRoot, runnerPath: join(root, 'synthetic-unused-runner.js'),
    deployment: { backendRoot: join(root, 'backend'), migrationsDirectory: join(root, 'migrations'),
      nativeResourceRoot: join(root, 'native') },
    assertMainInstance() {},
    async acquireReservation({ operationRoot }) {
      const owner = { assertMainOwned: vi.fn(async () => undefined),
        bind: vi.fn<OwnedProfileBackupInspectionReservation['bind']>(),
        invalidate: vi.fn(), close: vi.fn(async () => undefined) };
      owners.set(operationRoot === join(stagingRoot, fixture.operationId) ? fixture.operationId : inspectionOperationId, owner);
      return owner;
    },
  });
  // Native process/reservation boundaries are synthetic; the client lifecycle,
  // broker, encrypted container and independent staging use the production chain.
  inspectionBoundary.run.mockImplementation(async input => {
    const context = () => input.readActiveContext({
      operationId: input.operationId, kind: input.kind, signal: input.signal, deadline: input.deadline!,
      ...(input.updateMaintenanceOperationId === undefined ? {} : { updateMaintenanceOperationId: input.updateMaintenanceOperationId }),
    });
    input.assertAuthority();
    await input.reservation.assertMainOwned();
    await context();
    const actualDatabase = await readFile(join(stagingRoot, input.operationId, 'profile.sqlite'));
    const actualCatalog = await readFile(join(stagingRoot, input.operationId, 'snapshot-catalog-v1.json'));
    expect(actualDatabase.toString()).toBe(database);
    expect(actualCatalog.toString()).toBe(catalog);
    await context();
    input.assertAuthority();
    return { identity: { protocolVersion: profileInspectionProtocolVersion, operationId: input.operationId,
      generationId: randomUUID(), runtimeSession: randomBytes(32).toString('base64url') },
    validation: { ...snapshotValidation, type: 'profileSnapshotValidation' }, receipt: {
      ...activeValidation, migrationPolicy: input.migrationPolicy,
      artifactIdentity: createProfileSnapshotArtifactIdentity([]),
      database: { byteSize: actualDatabase.length, sha256: createHash('sha256').update(actualDatabase).digest('hex') },
      artifactCatalog: { byteSize: actualCatalog.length, sha256: createHash('sha256').update(actualCatalog).digest('hex') },
    } };
  });
  const recoveryRoot = join(root, 'recovery-points');
  const store = new RecoveryPointStore({
    inspectionOperationIdFactory: () => inspectionOperationId,
    keyProtector: new RecoveryPointKeyProtector({
      encrypt: async (value) => Buffer.from(value),
      decrypt: async (value) => ({ shouldReEncrypt: false, value: Buffer.from(value).toString() }),
    }),
    quarantineRoot, recoveryRoot, stagingRoot, validator: inspector,
  });
  const service = new RecoveryPointService({
    appVersion: '0.2.81', profileSnapshotClient: inspector,
    rotation: new RecoveryPointRotationService({ recoveryRoot, store }), stagingRoot, store,
  });
  return { fixture, inspectionOperationId, inspector, owners, database, service, stagingRoot, store };
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
const inspectionContext = { activeProfileId: activeValidation.profileId, activeProfileIsEmpty: false };
const snapshotMetadata = {
  artifactCatalog: {
    artifactCount: 0, artifactTotalByteSize: 0, catalogByteSize: 32,
    logicalPath: 'snapshot-catalog-v1.json' as const, sha256: 'a'.repeat(64),
  },
  database: { databaseByteSize: 4096, logicalPath: 'profile.sqlite' as const, sha256: 'b'.repeat(64), totalPages: 1 },
};
