import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecoveryPointIndexEntry } from './recoveryPointIndexStore.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';
import { ProfileSnapshotBrokerClient } from '../profileSnapshotBrokerClient.js';
import {
  parseProfileSnapshotBrokerRequest,
  profileSnapshotBrokerProtocolVersion,
} from '../profileSnapshotBrokerProtocol.js';
import {
  chooseAutomaticPointKind,
  isAutomaticPointDue,
  RecoveryPointService,
} from './recoveryPointService.js';

const roots: string[] = [];
const operationId = '11111111-1111-4111-8111-111111111111';
const artifactId = '22222222-2222-4222-8222-222222222222';
const profileId = 'a'.repeat(64);
const migrationChainIdentity = 'b'.repeat(64);
const now = new Date('2026-08-04T12:00:00.000Z');

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point service', () => {
  it('RECOVERY-POINT-001 @critical creates a validated automatic point only after the healthy snapshot check', async () => {
    const fixture = await createFixture();

    await expect(fixture.service.checkAutomatic()).resolves.toEqual(
      fixture.createdPoint,
    );

    expect(fixture.calls).toEqual([
      'begin',
      'snapshot',
      'validate',
      'list',
      'create',
      'rotate',
      'list',
      'end',
    ]);
    expect(fixture.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'monthly',
        manifest: expect.objectContaining({
          migrationChainIdentity,
          profileId,
        }),
      }),
    );
    expect(fixture.service.getStatus()).toEqual({
      availability: 'available',
      budgetState: 'withinBudget',
      latestValidatedGoodAt: now.toISOString(),
      nextAutomaticCheckAt: '2026-08-05T12:00:00.000Z',
      operationState: 'idle',
      pointCount: 1,
    });
  });

  it('validates health but skips creation before 24 hours', async () => {
    const recentPoint = createPoint(
      'daily',
      '2026-08-04T11:00:00.000Z',
    );
    const fixture = await createFixture({
      existingPoints: [recentPoint],
    });

    await expect(
      fixture.service.checkAutomatic(),
    ).resolves.toBeUndefined();
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual([
      'begin',
      'snapshot',
      'validate',
      'list',
      'end',
    ]);
  });

  it('rejects an unhealthy or foreign profile before persistence', async () => {
    const fixture = await createFixture({
      profileMatchesActive: false,
    });

    await expect(fixture.service.checkAutomatic()).rejects.toThrow(
      'RECOVERY_POINT_SOURCE_UNHEALTHY',
    );
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual([
      'begin',
      'snapshot',
      'validate',
      'end',
    ]);
  });

  it('RECOVERY-POINT-002 @fault reports unavailable without plaintext fallback when key protection fails', async () => {
    const failure = Object.assign(new Error('safe failure'), {
      code: 'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
    });
    const fixture = await createFixture({
      createFailure: failure,
    });

    await expect(fixture.service.createManual()).rejects.toBe(failure);
    expect(fixture.service.getStatus()).toEqual({
      availability: 'unavailable',
      budgetState: 'withinBudget',
      lastSafeErrorCode:
        'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
      operationState: 'idle',
      pointCount: 0,
    });
    expect(fixture.events).toEqual([
      expect.objectContaining({
        eventName: 'recoveryPoint.started',
        recoveryPointKind: 'manual',
      }),
      expect.objectContaining({
        errorCode: 'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
        eventName: 'recoveryPoint.failed',
        recoveryPointKind: 'manual',
      }),
    ]);
  });

  it('keeps recovery authoritative when the operational observer fails', async () => {
    const fixture = await createFixture({ observerThrows: true });

    await expect(fixture.service.createManual()).resolves.toEqual(
      fixture.createdPoint,
    );
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it('allows a historical migration prefix only for a pre-migration point', async () => {
    const preMigration = await createFixture();
    await preMigration.service.createPreMigration();
    expect(preMigration.snapshotPolicies).toEqual([
      'compatibleHistoricalPrefix',
    ]);

    const manual = await createFixture();
    await manual.service.createManual();
    expect(manual.snapshotPolicies).toEqual(['exactCurrentManifest']);

    const preRestore = await createFixture();
    await preRestore.service.createPreRestore();
    expect(preRestore.snapshotPolicies).toEqual(['exactCurrentManifest']);

    const preUpdate = await createFixture();
    await preUpdate.service.createPreUpdateWithMaintenance('11111111-1111-4111-8111-111111111111');
    expect(preUpdate.snapshotPolicies).toEqual(['exactCurrentManifest']);
  });
});

describe('caller-owned pre-update recovery point', () => {
  it('borrows the exact operation without acquiring or releasing maintenance', async () => {
    const fixture = await createFixture();
    const client = fixture.dependencies.profileSnapshotClient;
    const snapshot = vi.spyOn(client, 'createProfileSnapshot');
    const validate = vi.spyOn(client, 'validateProfileSnapshot');

    await expect(fixture.service.createPreUpdateWithMaintenance(operationId))
      .resolves.toEqual(fixture.createdPoint);

    expect(snapshot).toHaveBeenCalledWith(operationId, 'exactCurrentManifest');
    expect(validate).toHaveBeenCalledWith(operationId);
    expect(fixture.calls).toEqual([
      'assertUpdate', 'snapshot', 'validate', 'assertUpdate',
      'create', 'rotate', 'list', 'assertUpdate',
    ]);
    expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'preUpdate',
      updateMaintenanceOperationId: operationId,
    }));
    expect(fixture.events.map((event) => [event.eventName, event.correlationId]))
      .toEqual([
        ['recoveryPoint.started', operationId],
        ['recoveryPoint.completed', operationId],
      ]);
    await expect(readFile(join(fixture.operationRoot, 'profile.sqlite')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(client.assertUpdateMaintenance(operationId)).resolves.toBe('busy');
  });

  it('rejects invalid IDs before paths or events and foreign owners before snapshot or cleanup', async () => {
    const fixture = await createFixture();
    await expect(fixture.service.createPreUpdateWithMaintenance('../foreign'))
      .rejects.toThrow('RECOVERY_POINT_OPERATION_INVALID');
    expect(fixture.events).toEqual([]);
    expect(fixture.calls).toEqual([]);

    await mkdir(fixture.operationRoot);
    await writeFile(join(fixture.operationRoot, 'profile.sqlite'), 'preserve');
    fixture.invalidateUpdate();
    await expect(fixture.service.createPreUpdateWithMaintenance(operationId))
      .rejects.toThrow('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    await expect(fixture.service.createPreUpdateWithMaintenance(artifactId))
      .rejects.toThrow('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    expect(fixture.calls).toEqual(['assertUpdate', 'assertUpdate']);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(await readFile(join(fixture.operationRoot, 'profile.sqlite'), 'utf8'))
      .toBe('preserve');
  });

  it('rejects foreign snapshot contents without persistence or release', async () => {
    const fixture = await createFixture({ profileMatchesActive: false });
    await expect(fixture.service.createPreUpdateWithMaintenance(operationId))
      .rejects.toThrow('RECOVERY_POINT_SOURCE_UNHEALTHY');
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(['assertUpdate', 'snapshot', 'validate']);
    expect(fixture.events.at(-1)).toMatchObject({
      eventName: 'recoveryPoint.failed', retryable: false,
    });
  });

  it.each(['create', 'rotation', 'list'] as const)(
    'rejects late invalidation during %s without losing the durable point or releasing writes',
    async (stage) => {
      const fixture = await createFixture();
      const entered = createDeferred<void>();
      const continueStage = createDeferred<void>();
      const pause = async () => {
        entered.resolve();
        await continueStage.promise;
      };
      if (stage === 'create') {
        const original = fixture.create.getMockImplementation()!;
        fixture.create.mockImplementationOnce(async () => {
          const result = await original();
          await pause();
          return result;
        });
      } else if (stage === 'rotation') {
        const original = fixture.dependencies.rotation.maintain;
        vi.spyOn(fixture.dependencies.rotation, 'maintain')
          .mockImplementationOnce(async (...args) => {
            const result = await original(...args);
            await pause();
            return result;
          });
      } else {
        const original = fixture.dependencies.store.list;
        vi.spyOn(fixture.dependencies.store, 'list')
          .mockImplementationOnce(async (...args) => {
            const result = await original(...args);
            await pause();
            return result;
          });
      }
      const result = expect(fixture.service.createPreUpdateWithMaintenance(operationId))
        .rejects.toThrow('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
      await entered.promise;
      await expect(fixture.service.createPreUpdateWithMaintenance(operationId))
        .rejects.toThrow('RECOVERY_POINT_BUSY');
      fixture.invalidateUpdate();
      continueStage.resolve();
      await result;

      expect(await fixture.dependencies.store.list(profileId)).toContain(fixture.createdPoint);
      expect(fixture.calls).not.toContain('end');
      expect(fixture.events.some((event) => event.eventName === 'recoveryPoint.completed'))
        .toBe(false);
      expect(fixture.service.getStatus().operationState).toBe('idle');
    },
  );

  it.each(['createProfileSnapshot', 'validateProfileSnapshot'] as const)(
    'waits for the queued barrier after %s fails before cleanup, preserving the first error',
    async (method) => {
      const fixture = await createFixture();
      const client = fixture.dependencies.profileSnapshotClient;
      const barrierEntered = createDeferred<void>();
      const barrier = createDeferred<'busy'>();
      const firstError = new Error('SYNTHETIC_SNAPSHOT_REQUEST_FAILED');
      vi.spyOn(client, method).mockImplementationOnce(async () => {
        await mkdir(fixture.operationRoot, { recursive: true });
        await writeFile(join(fixture.operationRoot, 'profile.sqlite'), 'in progress');
        throw firstError;
      });
      vi.spyOn(client, 'assertUpdateMaintenance')
        .mockResolvedValueOnce('busy')
        .mockImplementationOnce(() => {
          barrierEntered.resolve();
          return barrier.promise;
        });
      const result = expect(fixture.service.createPreUpdateWithMaintenance(operationId))
        .rejects.toBe(firstError);
      await barrierEntered.promise;
      expect(await readFile(join(fixture.operationRoot, 'profile.sqlite'), 'utf8'))
        .toBe('in progress');
      barrier.resolve('busy');
      await result;
      await expect(readFile(join(fixture.operationRoot, 'profile.sqlite')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(fixture.calls).not.toContain('end');
      expect(fixture.events.at(-1)).toMatchObject({
        eventName: 'recoveryPoint.failed',
        errorCode: 'SYNTHETIC_SNAPSHOT_REQUEST_FAILED',
      });
    },
  );

  it('keeps staging and the first error when the completion barrier also fails', async () => {
    const fixture = await createFixture();
    const client = fixture.dependencies.profileSnapshotClient;
    const firstError = new Error('SYNTHETIC_FIRST_FAILURE');
    vi.spyOn(client, 'createProfileSnapshot').mockImplementationOnce(async () => {
      await mkdir(fixture.operationRoot);
      await writeFile(join(fixture.operationRoot, 'profile.sqlite'), 'preserve');
      throw firstError;
    });
    vi.spyOn(client, 'assertUpdateMaintenance')
      .mockResolvedValueOnce('busy')
      .mockRejectedValueOnce(new Error('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE'));

    await expect(fixture.service.createPreUpdateWithMaintenance(operationId))
      .rejects.toBe(firstError);
    expect(await readFile(join(fixture.operationRoot, 'profile.sqlite'), 'utf8'))
      .toBe('preserve');
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.events.at(-1)).toMatchObject({
      eventName: 'recoveryPoint.failed', errorCode: 'SYNTHETIC_FIRST_FAILURE',
    });
  });

  it('checks the fence after staging cleanup, before publishing success', async () => {
    const fixture = await createFixture();
    vi.spyOn(fixture.dependencies.profileSnapshotClient, 'assertUpdateMaintenance')
      .mockResolvedValueOnce('busy')
      .mockResolvedValueOnce('busy')
      .mockImplementationOnce(async () => {
        await expect(readFile(join(fixture.operationRoot, 'profile.sqlite')))
          .rejects.toMatchObject({ code: 'ENOENT' });
        throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
      });

    await expect(fixture.service.createPreUpdateWithMaintenance(operationId))
      .rejects.toThrow('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.events.at(-1)).toMatchObject({
      eventName: 'recoveryPoint.failed', retryable: false, sideEffectState: 'unknown',
    });
  });

  it('ignores late snapshot and barrier responses after both real client requests time out', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.operationRoot);
    await writeFile(join(fixture.operationRoot, 'profile.sqlite'), 'remote still owns this');
    const snapshotRequested = createDeferred<string>();
    const barrierRequested = createDeferred<string>();
    let receive: (value: unknown) => void = () => undefined;
    let assertionCount = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const acknowledge = (requestId: string) => receive({
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
      result: { type: 'maintenanceStatus', status: 'busy' },
    });
    const client = new ProfileSnapshotBrokerClient({
      close() {},
      send(value) {
        const request = parseProfileSnapshotBrokerRequest(value);
        if (request === undefined) throw new Error('INVALID_TEST_REQUEST');
        if (request.operation === 'createProfileSnapshot') {
          snapshotRequested.resolve(request.requestId);
        } else if (request.operation === 'assertUpdateMaintenance') {
          assertionCount += 1;
          if (assertionCount === 1) acknowledge(request.requestId);
          else barrierRequested.resolve(request.requestId);
        } else {
          throw new Error('UNEXPECTED_TEST_REQUEST');
        }
      },
      subscribe(listener) {
        receive = listener;
        return () => { receive = () => undefined; };
      },
      subscribeClose() { return () => undefined; },
    });
    try {
      fixture.dependencies.profileSnapshotClient = client;
      receive({
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        type: 'profileSnapshotBrokerReady',
      });
      const result = expect(fixture.service.createPreUpdateWithMaintenance(operationId))
        .rejects.toMatchObject({ code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE' });
      const snapshotRequestId = await snapshotRequested.promise;
      await vi.advanceTimersByTimeAsync(35_000);
      const barrierRequestId = await barrierRequested.promise;
      await vi.advanceTimersByTimeAsync(35_000);
      await result;

      // The remote operation eventually finishes, but its dropped reply must
      // not resurrect the failed caller or authorize deferred cleanup.
      receive({
        ok: false,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId: snapshotRequestId,
        errorCode: 'PROFILE_SNAPSHOT_DATABASE_FAILED',
      });
      acknowledge(barrierRequestId);
      expect(await readFile(join(fixture.operationRoot, 'profile.sqlite'), 'utf8'))
        .toBe('remote still owns this');
      expect(fixture.create).not.toHaveBeenCalled();
      expect(fixture.events.map((event) => event.eventName))
        .toEqual(['recoveryPoint.started', 'recoveryPoint.failed']);
      expect(fixture.events.at(-1)).toMatchObject({
        errorCode: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });
});

describe('automatic recovery point classification', () => {
  it('uses monthly, then weekly, then daily within the same period', () => {
    expect(chooseAutomaticPointKind([], now)).toBe('monthly');
    const monthly = createPoint(
      'monthly',
      '2026-08-01T12:00:00.000Z',
    );
    expect(chooseAutomaticPointKind([monthly], now)).toBe('weekly');
    expect(
      chooseAutomaticPointKind(
        [
          monthly,
          createPoint('weekly', '2026-08-03T12:00:00.000Z'),
        ],
        now,
      ),
    ).toBe('daily');
  });

  it('enforces the full 24-hour interval', () => {
    expect(
      isAutomaticPointDue(
        [createPoint('daily', '2026-08-03T12:00:01.000Z')],
        now,
      ),
    ).toBe(false);
    expect(
      isAutomaticPointDue(
        [createPoint('daily', '2026-08-03T12:00:00.000Z')],
        now,
      ),
    ).toBe(true);
  });
});

async function createFixture(options: {
  createFailure?: Error;
  existingPoints?: RecoveryPointIndexEntry[];
  observerThrows?: boolean;
  profileMatchesActive?: boolean;
} = {}) {
  const stagingRoot = await mkdtemp(
    join(tmpdir(), 'eky-recovery-service-'),
  );
  roots.push(stagingRoot);
  const operationRoot = join(stagingRoot, operationId);
  const calls: string[] = [];
  const snapshotPolicies: string[] = [];
  const existingPoints = options.existingPoints ?? [];
  const createdPoint = createPoint('monthly', now.toISOString());
  const events: ProfileRecoveryOperationalEvent[] = [];
  let persisted = false;
  const create = vi.fn(async () => {
    calls.push('create');
    if (options.createFailure !== undefined) {
      throw options.createFailure;
    }
    persisted = true;
    return createdPoint;
  });
  let updateValid = true;
  const dependencies: ConstructorParameters<typeof RecoveryPointService>[0] = {
    appVersion: '0.1.0-alpha.1',
    now: () => new Date(now),
    operationIdFactory: () => operationId,
    observer: {
      observe(event) {
        if (options.observerThrows) {
          throw new Error('SYNTHETIC_OBSERVER_FAILURE');
        }
        events.push(event);
      },
    },
    profileSnapshotClient: {
      async assertUpdateMaintenance(requestedOperationId) {
        calls.push('assertUpdate');
        if (!updateValid || requestedOperationId !== operationId) {
          throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
        }
        return 'busy';
      },
      async beginMaintenance() {
        calls.push('begin');
        return 'busy';
      },
      async createProfileSnapshot(_operationId, migrationPolicy) {
        calls.push('snapshot');
        snapshotPolicies.push(migrationPolicy);
        await mkdir(operationRoot, { mode: 0o700, recursive: true });
        await Promise.all([
          writeFile(join(operationRoot, 'profile.sqlite'), 'database'),
          writeFile(
            join(operationRoot, 'snapshot-catalog-v1.json'),
            '{"artifacts":[]}',
          ),
        ]);
        return {
          artifactCatalog: {
            artifactCount: 0,
            artifactTotalByteSize: 0,
            catalogByteSize: 16,
            logicalPath: 'snapshot-catalog-v1.json' as const,
            sha256: 'c'.repeat(64),
          },
          database: {
            databaseByteSize: 8,
            logicalPath: 'profile.sqlite' as const,
            sha256: 'd'.repeat(64),
            totalPages: 1,
          },
          type: 'profileSnapshot' as const,
        };
      },
      async endMaintenance() {
        calls.push('end');
        return 'normal';
      },
      async validateProfileSnapshot() {
        calls.push('validate');
        return {
          activeProfileIsEmpty: false,
          artifactCount: 0,
          artifactTotalByteSize: 0,
          databaseHealth: 'healthy' as const,
          migrationChainIdentity,
          profileId,
          profileMatchesActive:
            options.profileMatchesActive ?? true,
          type: 'profileSnapshotValidation' as const,
        };
      },
    },
    rotation: {
      async maintain() {
        calls.push('rotate');
        return {
          budgetExceededAfterRotation: false,
          deletedCount: 0,
          retainedByteSize: 1,
        };
      },
      async resumePending() {
        return 0;
      },
    },
    stagingRoot,
    store: {
      create,
      async list() {
        calls.push('list');
        return persisted
          ? [...existingPoints, createdPoint]
          : existingPoints;
      },
    },
  };
  const service = new RecoveryPointService(dependencies);

  return {
    calls,
    create,
    createdPoint,
    dependencies,
    events,
    invalidateUpdate() { updateValid = false; },
    operationRoot,
    service,
    snapshotPolicies,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createPoint(
  kind: RecoveryPointIndexEntry['kind'],
  timestamp: string,
): RecoveryPointIndexEntry {
  return {
    artifactId,
    byteSize: 1,
    createdAt: timestamp,
    kind,
    state: 'validatedGood',
    validatedAt: timestamp,
  };
}
