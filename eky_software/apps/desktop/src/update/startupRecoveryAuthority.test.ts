import { describe, expect, it } from 'vitest';

import type { ProfileRestoreActivationJournal } from '../profileBackup/restore/profileRestoreActivationJournal.js';
import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
  type DirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';
import type { UpdateJournal } from './updateJournal.js';
import { resolveStartupRecoveryAuthority } from './startupRecoveryAuthority.js';

describe('startup recovery authority', () => {
  it('recognizes only the restore journal owned by the business rollback', () => {
    expect(
      resolveStartupRecoveryAuthority({
        directSetupRecovery: undefined,
        profileRestoreJournal: createRestoreJournal(operationId),
        updateJournal: createUpdateJournal('businessRollbackStarting'),
      }),
    ).toBe('updateBusinessRollback');
  });

  it('recognizes a restore journal owned by direct Setup rollback', () => {
    expect(
      resolveStartupRecoveryAuthority({
        directSetupRecovery: createDirectRecovery(
          'businessRollbackStarting',
        ),
        profileRestoreJournal: createRestoreJournal(operationId),
        updateJournal: undefined,
      }),
    ).toBe('directSetupBusinessRollback');
  });

  it('fails closed for unrelated unresolved update and restore journals', () => {
    expect(() =>
      resolveStartupRecoveryAuthority({
        directSetupRecovery: undefined,
        profileRestoreJournal: createRestoreJournal(
          '99999999-9999-4999-8999-999999999999',
        ),
        updateJournal: createUpdateJournal('businessRollbackStarting'),
      }),
    ).toThrow('ambiguous');
    expect(() =>
      resolveStartupRecoveryAuthority({
        directSetupRecovery: undefined,
        profileRestoreJournal: createRestoreJournal(operationId),
        updateJournal: createUpdateJournal('awaitingFirstStart'),
      }),
    ).toThrow('ambiguous');
    expect(() =>
      resolveStartupRecoveryAuthority({
        directSetupRecovery: createDirectRecovery('recoveryRequired'),
        profileRestoreJournal: createRestoreJournal(
          '99999999-9999-4999-8999-999999999999',
        ),
        updateJournal: undefined,
      }),
    ).toThrow('ambiguous');
  });

  it('leaves ordinary restore and update-only starts unambiguous', () => {
    expect(
      resolveStartupRecoveryAuthority({
        directSetupRecovery: undefined,
        profileRestoreJournal: createRestoreJournal(operationId),
        updateJournal: undefined,
      }),
    ).toBe('profileRestore');
    expect(
      resolveStartupRecoveryAuthority({
        directSetupRecovery: undefined,
        profileRestoreJournal: undefined,
        updateJournal: createUpdateJournal('rollbackRequired'),
      }),
    ).toBe('none');
  });
});

const operationId = '11111111-1111-4111-8111-111111111111';

function createRestoreJournal(
  id: string,
): Readonly<ProfileRestoreActivationJournal> {
  return {
    formatVersion: 1,
    hadActiveDatabase: true,
    hadActiveDocuments: true,
    operationId: id,
    phase: 'validationStarting',
    revision: 9,
  };
}

function createDirectRecovery(
  state: 'businessRollbackStarting' | 'recoveryRequired',
): Readonly<DirectSetupMigrationRecovery> {
  const prepared = createDirectSetupMigrationRecovery({
    appliedMigrationCount: 37,
    at: '2026-08-12T10:00:00.000Z',
    correlationId: operationId,
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
    at: '2026-08-12T10:01:00.000Z',
    state: 'migrationRunning',
  });
  const required = transitionDirectSetupMigrationRecovery(running, {
    at: '2026-08-12T10:02:00.000Z',
    state: 'recoveryRequired',
  });
  return state === 'recoveryRequired'
    ? required
    : transitionDirectSetupMigrationRecovery(required, {
        at: '2026-08-12T10:03:00.000Z',
        state,
      });
}

function createUpdateJournal(
  state:
    | 'awaitingFirstStart'
    | 'businessRollbackStarting'
    | 'rollbackRequired',
): Readonly<UpdateJournal> {
  return {
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: {
      buildRevision: 'b'.repeat(40),
      msiProductVersion: '0.1.2',
      packageSha256: '2'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: operationId,
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
    revision: 5,
    state,
    targetVersion: '0.1.0-alpha.2',
    updatedAt: '2026-08-12T11:00:00.000Z',
  };
}
