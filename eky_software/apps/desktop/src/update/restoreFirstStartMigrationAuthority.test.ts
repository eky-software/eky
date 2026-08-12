import { describe, expect, it } from 'vitest';

import type { ProfileRestoreActivationJournal } from '../profileBackup/restore/profileRestoreActivationJournal.js';
import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';
import {
  authorizeRestoreFirstStartForwardMigrations,
  RestoreFirstStartMigrationAuthorityError,
} from './restoreFirstStartMigrationAuthority.js';
import type { UpdateJournal } from './updateJournal.js';

describe('restore first-start migration authority', () => {
  it('authorizes only the missing forward migrations of an activated historical profile', () => {
    expect(
      authorizeRestoreFirstStartForwardMigrations({
        directSetupRecovery: undefined,
        inspection: createInspection(),
        profileRestoreJournal: createRestoreJournal(),
        profileRestoreStartupMode: 'validateRestoredProfile',
        startupRecoveryAuthority: 'profileRestore',
        updateJournal: createAcceptedUpdateJournal(),
      }),
    ).toBe('authorized');
  });

  it('does not claim an already current restored profile', () => {
    expect(
      authorizeRestoreFirstStartForwardMigrations({
        directSetupRecovery: undefined,
        inspection: createInspection({ pendingMigrationCount: 0 }),
        profileRestoreJournal: createRestoreJournal(),
        profileRestoreStartupMode: 'validateRestoredProfile',
        startupRecoveryAuthority: 'profileRestore',
        updateJournal: undefined,
      }),
    ).toBe('notRequired');
  });

  it.each([
    {
      name: 'restore is not in validation',
      overrides: { profileRestoreStartupMode: 'normal' as const },
    },
    {
      name: 'activation journal is not in validation',
      overrides: {
        profileRestoreJournal: createRestoreJournal('rolledBack'),
      },
    },
    {
      name: 'profile is not an existing manifest prefix',
      overrides: {
        inspection: createInspection({
          appliedMigrationCount: 0,
          migrationChainIdentity: '',
          profileState: 'empty',
        }),
      },
    },
    {
      name: 'migration chain identity is malformed',
      overrides: {
        inspection: createInspection({ migrationChainIdentity: 'invalid' }),
      },
    },
  ])('fails closed when $name', ({ overrides }) => {
    expect(() =>
      authorizeRestoreFirstStartForwardMigrations({
        directSetupRecovery: undefined,
        inspection: createInspection(),
        profileRestoreJournal: createRestoreJournal(),
        profileRestoreStartupMode: 'validateRestoredProfile',
        startupRecoveryAuthority: 'profileRestore',
        updateJournal: undefined,
        ...overrides,
      }),
    ).toThrow(RestoreFirstStartMigrationAuthorityError);
  });

  it('fails closed when update and restore authorities conflict', () => {
    expect(() =>
      authorizeRestoreFirstStartForwardMigrations({
        directSetupRecovery: undefined,
        inspection: createInspection(),
        profileRestoreJournal: createRestoreJournal(),
        profileRestoreStartupMode: 'validateRestoredProfile',
        startupRecoveryAuthority: 'profileRestore',
        updateJournal: createUnresolvedUpdateJournal(),
      }),
    ).toThrow('ambiguous');
  });

  it('fails closed when direct Setup and restore authorities conflict', () => {
    expect(() =>
      authorizeRestoreFirstStartForwardMigrations({
        directSetupRecovery: createUnresolvedDirectSetupRecovery(),
        inspection: createInspection(),
        profileRestoreJournal: createRestoreJournal(),
        profileRestoreStartupMode: 'validateRestoredProfile',
        startupRecoveryAuthority: 'profileRestore',
        updateJournal: undefined,
      }),
    ).toThrow('ambiguous');
  });
});

const operationId = '11111111-1111-4111-8111-111111111111';

function createInspection(
  overrides: Partial<{
    appliedMigrationCount: number;
    migrationChainIdentity: string;
    pendingMigrationCount: number;
    profileState: 'empty' | 'existing';
  }> = {},
) {
  return {
    appliedMigrationCount: 38,
    migrationChainIdentity: 'a'.repeat(64),
    pendingMigrationCount: 2,
    profileState: 'existing' as const,
    ...overrides,
  };
}

function createRestoreJournal(
  phase: 'rolledBack' | 'validationStarting' = 'validationStarting',
): Readonly<ProfileRestoreActivationJournal> {
  return {
    formatVersion: 1,
    hadActiveDatabase: true,
    hadActiveDocuments: true,
    operationId,
    phase,
    revision: 9,
  };
}

function createAcceptedUpdateJournal(): Readonly<UpdateJournal> {
  return {
    ...createUnresolvedUpdateJournal(),
    state: 'accepted',
  };
}

function createUnresolvedUpdateJournal(): Readonly<UpdateJournal> {
  return {
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: {
      buildRevision: 'b'.repeat(40),
      msiProductVersion: '0.0.2',
      packageSha256: '2'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '99999999-9999-4999-8999-999999999999',
    createdAt: '2026-08-12T10:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: 'a'.repeat(40),
      msiProductVersion: '0.0.1',
      packageSha256: '1'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: '0.0.0-update-fixture.1',
    formatVersion: 1,
    handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    releaseChannel: 'pilot',
    revision: 5,
    state: 'awaitingFirstStart',
    targetVersion: '0.0.0-update-fixture.2',
    updatedAt: '2026-08-12T11:00:00.000Z',
  };
}

function createUnresolvedDirectSetupRecovery() {
  const prepared = createDirectSetupMigrationRecovery({
    appliedMigrationCount: 38,
    at: '2026-08-12T10:00:00.000Z',
    correlationId: '99999999-9999-4999-8999-999999999999',
    migrationPrefixIdentity: 'c'.repeat(64),
    previousAcceptedBuildIdentity: {
      appVersion: '0.0.0-update-fixture.1',
      buildRevision: 'a'.repeat(40),
    },
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    runningTargetBuildIdentity: {
      appVersion: '0.0.0-update-fixture.2',
      buildRevision: 'b'.repeat(40),
    },
  });
  return transitionDirectSetupMigrationRecovery(prepared, {
    at: '2026-08-12T10:01:00.000Z',
    state: 'migrationRunning',
  });
}
