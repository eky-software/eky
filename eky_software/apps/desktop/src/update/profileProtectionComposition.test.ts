import { describe, expect, it, vi } from 'vitest';

import { createProfileProtectionComposition } from './profileProtectionComposition.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const recoveryPointReference =
  '22222222-2222-4222-8222-222222222222';

describe('update profile protection composition', () => {
  it('exposes only the seven narrow update protection operations', () => {
    const fixture = createFixture();

    expect(Object.keys(fixture.protection).sort()).toEqual([
      'createValidatedPreMigrationPoint',
      'createValidatedPreUpdatePoint',
      'enterMaintenance',
      'leaveMaintenance',
      'releaseProtectedPoint',
      'restoreRecoveryPoint',
      'validateActiveProfile',
    ]);
  });

  it('creates validated update and migration points without exposing storage details', async () => {
    const fixture = createFixture();

    await expect(
      fixture.protection.createValidatedPreUpdatePoint(),
    ).resolves.toBe(recoveryPointReference);
    await expect(
      fixture.protection.createValidatedPreMigrationPoint(),
    ).resolves.toBe(recoveryPointReference);
  });

  it('delegates maintenance and returns only bounded active-profile health', async () => {
    const fixture = createFixture();

    await fixture.protection.enterMaintenance(operationId);
    await fixture.protection.leaveMaintenance(operationId);
    await expect(
      fixture.protection.validateActiveProfile(),
    ).resolves.toEqual({
      artifactCount: 3,
      artifactTotalByteSize: 4_096,
      databaseHealth: 'healthy',
      migrationChainIdentity: 'c'.repeat(64),
    });
    expect(fixture.beginMaintenance).toHaveBeenCalledWith(operationId);
    expect(fixture.endMaintenance).toHaveBeenCalledWith(operationId);
  });

  it('refuses to release a point while the durable journal protects it', async () => {
    const fixture = createFixture({ journalState: 'awaitingFirstStart' });

    await expect(
      fixture.protection.releaseProtectedPoint(recoveryPointReference),
    ).rejects.toThrow('UPDATE_RECOVERY_POINT_STILL_PROTECTED');
  });

  it('allows release verification only after journal protection ended', async () => {
    const fixture = createFixture({ journalState: 'accepted' });

    await expect(
      fixture.protection.releaseProtectedPoint(recoveryPointReference),
    ).resolves.toBeUndefined();
  });

  it('validates restore references before invoking the private rollback port', async () => {
    const fixture = createFixture();

    await expect(
      fixture.protection.restoreRecoveryPoint({
        expectedMigrationChainIdentity: 'a'.repeat(64),
        operationId: '22222222-2222-4222-8222-222222222222',
        recoveryPointReference: 'not-an-artifact',
      }),
    ).rejects.toThrow('UPDATE_RECOVERY_POINT_INVALID');
    expect(fixture.restoreRecoveryPoint).not.toHaveBeenCalled();

    const input = {
      expectedMigrationChainIdentity: 'a'.repeat(64),
      operationId: '22222222-2222-4222-8222-222222222222',
      recoveryPointReference,
    };
    await fixture.protection.restoreRecoveryPoint(input);
    expect(fixture.restoreRecoveryPoint).toHaveBeenCalledWith(input);
  });
});

function createFixture(
  options: {
    journalState?: 'accepted' | 'awaitingFirstStart';
  } = {},
) {
  const beginMaintenance = vi.fn(async () => 'busy' as const);
  const endMaintenance = vi.fn(async () => 'normal' as const);
  const restoreRecoveryPoint = vi.fn(async () => 'relaunching' as const);
  const protection = createProfileProtectionComposition({
    directSetupRecoveryStore: {
      read: vi.fn(async () => undefined),
    },
    profileSnapshotClient: {
      beginMaintenance,
      endMaintenance,
      validateActiveProfile: vi.fn(async () => ({
        artifactCount: 3,
        artifactTotalByteSize: 4_096,
        databaseHealth: 'healthy' as const,
        migrationChainIdentity: 'c'.repeat(64),
        type: 'activeProfileValidation' as const,
      })),
    },
    recoveryPointService: {
      createPreMigration: vi.fn(async () => createPoint()),
      createPreUpdate: vi.fn(async () => createPoint()),
    },
    restoreRecoveryPoint,
    updateJournalStore: {
      read: vi.fn(async () => ({
        binaryRollbackAttemptCount: 0 as const,
        candidatePackageIdentity: {
          buildRevision: 'bbbbbbbbbbbb',
          msiProductVersion: '0.2.0',
          packageSha256: 'b'.repeat(64),
          packageSize: 2_048,
        },
        correlationId: '33333333-3333-4333-8333-333333333333',
        createdAt: '2026-08-11T18:00:00.000Z',
        currentPackageIdentity: {
          buildRevision: 'aaaaaaaaaaaa',
          msiProductVersion: '0.1.0',
          packageSha256: 'a'.repeat(64),
          packageSize: 1_024,
        },
        currentVersion: '0.1.0',
        formatVersion: 1 as const,
        handoffAttemptCount: 1 as const,
        recoveryPointReference,
        releaseChannel: 'pilot' as const,
        revision: 4,
        state: options.journalState ?? 'accepted',
        targetVersion: '0.2.0',
        updatedAt: '2026-08-11T18:00:00.000Z',
      })),
    },
  });
  return {
    beginMaintenance,
    endMaintenance,
    protection,
    restoreRecoveryPoint,
  };
}

function createPoint() {
  return {
    artifactId: recoveryPointReference,
    byteSize: 1_024,
    createdAt: '2026-08-11T18:00:00.000Z',
    kind: 'preUpdate' as const,
    state: 'validatedGood' as const,
    validatedAt: '2026-08-11T18:00:00.000Z',
  };
}
