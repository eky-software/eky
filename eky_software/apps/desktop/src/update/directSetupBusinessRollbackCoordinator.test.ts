import { describe, expect, it, vi } from 'vitest';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
  type DirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';
import { DirectSetupBusinessRollbackCoordinator } from './directSetupBusinessRollbackCoordinator.js';

describe('DirectSetupBusinessRollbackCoordinator', () => {
  it('durably starts the exact protected rollback before activation', async () => {
    let stored = createRecovery('recoveryRequired');
    const order: string[] = [];
    const restoreRecoveryPoint = vi.fn(async () => {
      order.push('restore');
      return 'relaunching' as const;
    });
    const coordinator = createCoordinator({
      read: async () => stored,
      restoreRecoveryPoint,
      write: async (next) => {
        order.push(next.state);
        stored = next;
      },
    });

    await expect(coordinator.startIfRequired()).resolves.toBe('relaunching');
    expect(order).toEqual(['businessRollbackStarting', 'restore']);
    expect(restoreRecoveryPoint).toHaveBeenCalledWith({
      expectedMigrationChainIdentity: 'c'.repeat(64),
      operationId: stored.correlationId,
      recoveryPointReference: stored.recoveryPointReference,
    });
  });

  it('validates the restored prefix before waiting for the previous build', async () => {
    let stored = createRecovery('businessRollbackStarting');
    const validateActiveProfile = vi.fn(async () => ({
      artifactCount: 2,
      artifactTotalByteSize: 4_096,
      databaseHealth: 'healthy' as const,
      migrationChainIdentity: 'c'.repeat(64),
    }));
    const coordinator = createCoordinator({
      read: async () => stored,
      validateActiveProfile,
      write: async (next) => {
        stored = next;
      },
    });

    await coordinator.completeAfterProfileValidation({
      inspection: createInspection(),
    });

    expect(stored.state).toBe('awaitingPreviousBuild');
    expect(validateActiveProfile).toHaveBeenCalledOnce();
  });

  it('fails closed when restored profile identity changes', async () => {
    let stored = createRecovery('businessRollbackStarting');
    const coordinator = createCoordinator({
      read: async () => stored,
      validateActiveProfile: async () => ({
        artifactCount: 2,
        artifactTotalByteSize: 4_096,
        databaseHealth: 'healthy' as const,
        migrationChainIdentity: 'd'.repeat(64),
      }),
      write: async (next) => {
        stored = next;
      },
    });

    await expect(
      coordinator.completeAfterProfileValidation({
        inspection: createInspection(),
      }),
    ).rejects.toThrow('requires recovery');
    expect(stored.state).toBe('recoveryRequired');
  });

  it('does not run a target-owned rollback under the previous build', async () => {
    const stored = createRecovery('recoveryRequired');
    const restoreRecoveryPoint = vi.fn();
    const coordinator = createCoordinator({
      read: async () => stored,
    releaseInfo: createReleaseInfo({
      appVersion: '0.1.0-alpha.1',
      buildRevision: 'a'.repeat(40),
      msiProductVersion: '0.1.1',
    }),
      restoreRecoveryPoint,
      write: vi.fn(),
    });

    await expect(coordinator.startIfRequired()).rejects.toThrow(
      'requires recovery',
    );
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
  });
});

function createCoordinator(overrides: {
  read(): Promise<Readonly<DirectSetupMigrationRecovery> | undefined>;
  releaseInfo?: Readonly<DesktopReleaseInfo>;
  restoreRecoveryPoint?(input: {
    expectedMigrationChainIdentity: string;
    operationId: string;
    recoveryPointReference: string;
  }): Promise<'relaunching'>;
  validateActiveProfile?(): Promise<{
    artifactCount: number;
    artifactTotalByteSize: number;
    databaseHealth: 'healthy';
    migrationChainIdentity: string;
  }>;
  write(record: Readonly<DirectSetupMigrationRecovery>): Promise<void>;
}) {
  return new DirectSetupBusinessRollbackCoordinator({
    now: () => new Date('2026-08-12T19:00:00.000Z'),
    profileProtection: {
      restoreRecoveryPoint:
        overrides.restoreRecoveryPoint ??
        vi.fn(async () => 'relaunching' as const),
      validateActiveProfile:
        overrides.validateActiveProfile ??
        vi.fn(async () => ({
          artifactCount: 2,
          artifactTotalByteSize: 4_096,
          databaseHealth: 'healthy' as const,
          migrationChainIdentity: 'c'.repeat(64),
        })),
    },
    recoveryStore: {
      read: overrides.read,
      write: overrides.write,
    },
    releaseInfo:
      overrides.releaseInfo ??
      createReleaseInfo({
        appVersion: '0.1.0-alpha.2',
        buildRevision: 'b'.repeat(40),
        msiProductVersion: '0.1.2',
      }),
  });
}

function createReleaseInfo(
  overrides: Pick<
    DesktopReleaseInfo,
    'appVersion' | 'buildRevision' | 'msiProductVersion'
  >,
): Readonly<DesktopReleaseInfo> {
  return {
    appIdentity: 'Eky',
    appVersion: overrides.appVersion,
    architecture: 'x64',
    buildRevision: overrides.buildRevision,
    msiProductVersion: overrides.msiProductVersion,
    platform: 'win32',
    releaseChannel: 'pilot',
    schemaVersion: 1,
    upgradeCode: '302530B2-D950-41F5-8397-264B485FEE9A',
  };
}

function createInspection() {
  return {
    appliedMigrationCount: 37,
    migrationChainIdentity: 'c'.repeat(64),
    pendingMigrationCount: 1,
    profileState: 'existing' as const,
  };
}

function createRecovery(
  state:
    | 'businessRollbackStarting'
    | 'recoveryRequired',
): Readonly<DirectSetupMigrationRecovery> {
  const prepared = createDirectSetupMigrationRecovery({
    appliedMigrationCount: 37,
    at: '2026-08-12T18:00:00.000Z',
    correlationId: '11111111-1111-4111-8111-111111111111',
    migrationPrefixIdentity: 'c'.repeat(64),
    previousAcceptedBuildIdentity: {
      appVersion: '0.1.0-alpha.1',
      buildRevision: 'a'.repeat(40),
    },
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    runningTargetBuildIdentity: {
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'b'.repeat(40),
    },
  });
  const running = transitionDirectSetupMigrationRecovery(prepared, {
    at: '2026-08-12T18:01:00.000Z',
    state: 'migrationRunning',
  });
  const required = transitionDirectSetupMigrationRecovery(running, {
    at: '2026-08-12T18:02:00.000Z',
    state: 'recoveryRequired',
  });
  return state === 'recoveryRequired'
    ? required
    : transitionDirectSetupMigrationRecovery(required, {
        at: '2026-08-12T18:03:00.000Z',
        state,
      });
}
