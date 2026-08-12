import { describe, expect, it, vi } from 'vitest';

import { UpdateBusinessRollbackCoordinator } from './updateBusinessRollbackCoordinator.js';
import type { UpdateJournal } from './updateJournal.js';

describe('UpdateBusinessRollbackCoordinator', () => {
  it('durably starts one exact business rollback before activation', async () => {
    const journal = createJournal('rollbackRequired');
    let stored: Readonly<UpdateJournal> = journal;
    const order: string[] = [];
    const restoreRecoveryPoint = vi.fn(async () => {
      order.push('restore');
      return 'relaunching' as const;
    });
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          order.push(next.state);
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint,
        validateActiveProfile: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    await expect(coordinator.startIfRequired()).resolves.toBe('relaunching');
    expect(order).toEqual(['businessRollbackStarting', 'restore']);
    expect(restoreRecoveryPoint).toHaveBeenCalledWith({
      expectedMigrationChainIdentity: 'c'.repeat(64),
      operationId: journal.correlationId,
      recoveryPointReference: journal.recoveryPointReference,
    });
  });

  it('resumes the same journal correlation without a second transition', async () => {
    const journal = createJournal('businessRollbackStarting');
    const write = vi.fn();
    const restoreRecoveryPoint = vi.fn(async () => 'relaunching' as const);
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => journal, write },
      profileProtection: {
        restoreRecoveryPoint,
        validateActiveProfile: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    await coordinator.startIfRequired();

    expect(write).not.toHaveBeenCalled();
    expect(restoreRecoveryPoint).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: journal.correlationId }),
    );
  });

  it('fails safe without activating when the protected identity is incomplete', async () => {
    const {
      preUpdateMigrationChainIdentity: _preUpdateMigrationChainIdentity,
      ...journal
    } = createJournal('rollbackRequired');
    let stored = journal;
    const restoreRecoveryPoint = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint,
        validateActiveProfile: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    await expect(coordinator.startIfRequired()).rejects.toThrow(
      'requires recovery',
    );
    expect(stored.state).toBe('failedSafe');
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
  });

  it('fails safe when activation cannot establish a recoverable profile', async () => {
    let stored = createJournal('rollbackRequired');
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint: vi.fn(async () => {
          throw new Error('synthetic activation failure');
        }),
        validateActiveProfile: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    await expect(coordinator.startIfRequired()).rejects.toThrow(
      'requires recovery',
    );
    expect(stored.state).toBe('failedSafe');
  });

  it('validates an already restored exact profile before completing business rollback', async () => {
    let stored = createJournal('businessRollbackStarting');
    const restoreRecoveryPoint = vi.fn();
    const validateActiveProfile = vi.fn(createProfileValidation);
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint,
        validateActiveProfile,
      },
      releaseInfo: createReleaseInfo(),
    });
    const inspection = createInspection();

    await expect(
      coordinator.startIfRequired(inspection),
    ).resolves.toBe('validationRequired');
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
    await coordinator.completeAfterProfileValidation({ inspection });

    expect(stored.state).toBe('businessRollbackCompleted');
    expect(validateActiveProfile).toHaveBeenCalledOnce();
  });

  it('requires recovery when restored profile validation changes the migration chain', async () => {
    let stored = createJournal('businessRollbackStarting');
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      profileProtection: {
        restoreRecoveryPoint: vi.fn(),
        validateActiveProfile: async () => ({
          ...(await createProfileValidation()),
          migrationChainIdentity: 'd'.repeat(64),
        }),
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      releaseInfo: createReleaseInfo(),
    });

    await expect(
      coordinator.completeAfterProfileValidation({
        inspection: createInspection(),
      }),
    ).rejects.toThrow('requires recovery');
    expect(stored.state).toBe('recoveryRequired');
  });

  it('requires recovery after the restore transaction rolls itself back', async () => {
    let stored = createJournal('businessRollbackStarting');
    const validateActiveProfile = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint: vi.fn(),
        validateActiveProfile,
      },
      releaseInfo: createReleaseInfo(),
    });

    await expect(
      coordinator.requireRecoveryAfterRestoreRollback(),
    ).rejects.toThrow('requires recovery');
    expect(stored.state).toBe('recoveryRequired');
    expect(validateActiveProfile).not.toHaveBeenCalled();
  });
});

function createInspection() {
  return {
    appliedMigrationCount: 37,
    migrationChainIdentity: 'c'.repeat(64),
    pendingMigrationCount: 1,
    profileState: 'existing' as const,
  };
}

async function createProfileValidation() {
  return {
    artifactCount: 2,
    artifactTotalByteSize: 4_096,
    databaseHealth: 'healthy' as const,
    migrationChainIdentity: 'c'.repeat(64),
  };
}

function createJournal(
  state: 'businessRollbackStarting' | 'rollbackRequired',
): Readonly<UpdateJournal> {
  return {
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: {
      buildRevision: 'b'.repeat(40),
      msiProductVersion: '0.1.2',
      packageSha256: '2'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-08-12T10:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: 'a'.repeat(40),
      msiProductVersion: '0.1.1',
      packageSha256: '1'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: '0.1.0-alpha.1',
    formatVersion: 1,
    handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    releaseChannel: 'pilot',
    revision: state === 'rollbackRequired' ? 6 : 7,
    state,
    targetVersion: '0.1.0-alpha.2',
    updatedAt: '2026-08-12T11:00:00.000Z',
  };
}

function createReleaseInfo() {
  return {
    appIdentity: 'Eky' as const,
    appVersion: '0.1.0-alpha.2',
    architecture: 'x64' as const,
    buildRevision: 'b'.repeat(40),
    msiProductVersion: '0.1.2',
    platform: 'win32' as const,
    releaseChannel: 'pilot' as const,
    schemaVersion: 1 as const,
    upgradeCode: '33333333-3333-4333-8333-333333333333'.toUpperCase(),
  };
}
