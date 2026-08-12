import { describe, expect, it } from 'vitest';

import {
  createDirectSetupMigrationRecovery,
  DirectSetupMigrationRecoveryValidationError,
  parseDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';

const at = '2026-08-12T18:00:00.000Z';

describe('direct Setup migration recovery record', () => {
  it('creates a minimal strict record without profile or filesystem data', () => {
    const record = createRecord();

    expect(record).toEqual({
      appliedMigrationCount: 37,
      attemptCount: 1,
      correlationId: '11111111-1111-4111-8111-111111111111',
      createdAt: at,
      formatVersion: 1,
      migrationPrefixIdentity: 'a'.repeat(64),
      previousAcceptedBuildIdentity: {
        appVersion: '0.1.0-alpha.1',
        buildRevision: 'aaaaaaaaaaaa',
      },
      recoveryPointReference: '22222222-2222-4222-8222-222222222222',
      revision: 1,
      runningTargetBuildIdentity: {
        appVersion: '0.1.0-alpha.2',
        buildRevision: 'bbbbbbbbbbbb',
      },
      state: 'prepared',
      updatedAt: at,
    });
    expect(JSON.stringify(record)).not.toContain('profile');
    expect(JSON.stringify(record)).not.toContain('path');
  });

  it('rejects unknown fields and unsafe identity values', () => {
    expect(() =>
      parseDirectSetupMigrationRecovery({
        ...createRecord(),
        profileId: 'not-allowed',
      }),
    ).toThrow(DirectSetupMigrationRecoveryValidationError);
    expect(() =>
      parseDirectSetupMigrationRecovery({
        ...createRecord(),
        migrationPrefixIdentity: 'not-a-hash',
      }),
    ).toThrow(DirectSetupMigrationRecoveryValidationError);
  });

  it('allows only documented monotonic state transitions', () => {
    const running = transitionDirectSetupMigrationRecovery(createRecord(), {
      at: '2026-08-12T18:01:00.000Z',
      state: 'migrationRunning',
    });
    const recoveryRequired = transitionDirectSetupMigrationRecovery(running, {
      at: '2026-08-12T18:02:00.000Z',
      state: 'recoveryRequired',
    });

    expect(running.revision).toBe(2);
    expect(recoveryRequired.revision).toBe(3);
    expect(() =>
      transitionDirectSetupMigrationRecovery(recoveryRequired, {
        at: '2026-08-12T18:03:00.000Z',
        state: 'accepted',
      }),
    ).toThrow(DirectSetupMigrationRecoveryValidationError);
  });

  it('requires profile rollback before the previous build can accept recovery', () => {
    const running = transitionDirectSetupMigrationRecovery(createRecord(), {
      at: '2026-08-12T18:01:00.000Z',
      state: 'migrationRunning',
    });
    const required = transitionDirectSetupMigrationRecovery(running, {
      at: '2026-08-12T18:02:00.000Z',
      state: 'recoveryRequired',
    });
    const rollback = transitionDirectSetupMigrationRecovery(required, {
      at: '2026-08-12T18:03:00.000Z',
      state: 'businessRollbackStarting',
    });
    const previousBuild = transitionDirectSetupMigrationRecovery(rollback, {
      at: '2026-08-12T18:04:00.000Z',
      state: 'awaitingPreviousBuild',
    });

    expect(previousBuild.state).toBe('awaitingPreviousBuild');
    expect(
      transitionDirectSetupMigrationRecovery(previousBuild, {
        at: '2026-08-12T18:05:00.000Z',
        state: 'accepted',
      }).state,
    ).toBe('accepted');
  });
});

function createRecord() {
  return createDirectSetupMigrationRecovery({
    appliedMigrationCount: 37,
    at,
    correlationId: '11111111-1111-4111-8111-111111111111',
    migrationPrefixIdentity: 'a'.repeat(64),
    previousAcceptedBuildIdentity: {
      appVersion: '0.1.0-alpha.1',
      buildRevision: 'aaaaaaaaaaaa',
    },
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    runningTargetBuildIdentity: {
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'bbbbbbbbbbbb',
    },
  });
}
