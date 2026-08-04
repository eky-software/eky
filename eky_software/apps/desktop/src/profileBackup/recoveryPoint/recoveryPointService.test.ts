import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecoveryPointIndexEntry } from './recoveryPointIndexStore.js';
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
  it('creates a validated automatic point only after the healthy snapshot check', async () => {
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

  it('reports unavailable without plaintext fallback when key protection fails', async () => {
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
  profileMatchesActive?: boolean;
} = {}) {
  const stagingRoot = await mkdtemp(
    join(tmpdir(), 'eky-recovery-service-'),
  );
  roots.push(stagingRoot);
  const operationRoot = join(stagingRoot, operationId);
  const calls: string[] = [];
  const existingPoints = options.existingPoints ?? [];
  const createdPoint = createPoint('monthly', now.toISOString());
  let persisted = false;
  const create = vi.fn(async () => {
    calls.push('create');
    if (options.createFailure !== undefined) {
      throw options.createFailure;
    }
    persisted = true;
    return createdPoint;
  });
  const service = new RecoveryPointService({
    appVersion: '0.1.0-alpha.1',
    now: () => new Date(now),
    operationIdFactory: () => operationId,
    profileSnapshotClient: {
      async beginMaintenance() {
        calls.push('begin');
        return 'busy';
      },
      async createProfileSnapshot() {
        calls.push('snapshot');
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
  });

  return {
    calls,
    create,
    createdPoint,
    service,
  };
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
