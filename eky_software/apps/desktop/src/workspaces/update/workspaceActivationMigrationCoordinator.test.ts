import { describe, expect, it, vi } from 'vitest';

import type { ProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { WorkspaceActivationMigrationCoordinator } from './workspaceActivationMigrationCoordinator.js';
import type { WorkspaceActivationMigrationProof } from './workspaceActivationMigrationGuard.js';

const operationId = validateWorkspaceBackupImportOperationId(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
);
const sourceWorkspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const targetWorkspaceId = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
const profileId = 'a'.repeat(64);
const sourceMigrationChainIdentity = 'b'.repeat(64);
const targetMigrationChainIdentity = 'c'.repeat(64);

describe('WorkspaceActivationMigrationCoordinator', () => {
  it('migrates only the private candidate before the activation swap', async () => {
    const fixture = createFixture();

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.events).toEqual([
      'lease.acquire',
      'guard.reprove',
      'activation.read',
      'recovery.createAndStage',
      'runtime.stop',
      'runtime.absent',
      'candidate.prepareRoot',
      'candidate.migrate',
      'candidate.validate',
      'recovery.removeStaging',
      'candidate.inspect',
      'guard.reprove',
      'activation.prepare',
      'activation.advance',
      'lease.release',
      'runtime.relaunch',
    ]);
    expect(fixture.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(fixture.activation.transaction.rollback).not.toHaveBeenCalled();
  });

  it('leaves the published target unswapped and restores the source when preMigration fails', async () => {
    const fixture = createFixture({ failRecoveryPoint: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.activation.transaction.prepare).not.toHaveBeenCalled();
    expect(fixture.activation.transaction.rollback).not.toHaveBeenCalled();
    expect(fixture.rootStore.discardBeforeActivation).toHaveBeenCalledOnce();
    expect(fixture.events).toContain('runtime.stop');
    expect(fixture.events.indexOf('source.recover')).toBeGreaterThan(
      fixture.events.indexOf('candidate.discard'),
    );
  });

  it('discards a partial candidate before selecting the source after migration failure', async () => {
    const fixture = createFixture({ failCandidateMigration: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.activation.transaction.prepare).not.toHaveBeenCalled();
    expect(fixture.events.indexOf('candidate.discard')).toBeGreaterThan(
      fixture.events.indexOf('candidate.migrate'),
    );
    expect(fixture.events.indexOf('source.recover')).toBeGreaterThan(
      fixture.events.indexOf('candidate.discard'),
    );
  });

  it('rolls the target bytes back before recovering the source after swap failure', async () => {
    const fixture = createFixture({ failActivationAdvance: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.events.indexOf('activation.rollback')).toBeGreaterThan(
      fixture.events.indexOf('activation.advance'),
    );
    expect(fixture.events.indexOf('source.recover')).toBeGreaterThan(
      fixture.events.indexOf('activation.rollback'),
    );
    expect(fixture.rootStore.discardBeforeActivation).not.toHaveBeenCalled();
  });

  it('fails closed when the activation journal belongs to another operation', async () => {
    const fixture = createFixture({ foreignActivationJournal: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.sourceRecovery.requireRecovery).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(fixture.requestRelaunch).not.toHaveBeenCalled();
  });

  it('does not retry an ambiguous target runtime stop', async () => {
    const fixture = createFixture({ failRuntimeStop: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.stopTargetStartupRuntime).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.requireRecovery).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
  });

  it('does not report success when the maintenance lease cannot be released', async () => {
    const fixture = createFixture({ failLeaseRelease: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.sourceRecovery.requireRecovery).toHaveBeenCalledOnce();
    expect(fixture.requestRelaunch).not.toHaveBeenCalled();
  });
});

interface FixtureOptions {
  readonly failActivationAdvance?: boolean;
  readonly failCandidateMigration?: boolean;
  readonly failLeaseRelease?: boolean;
  readonly failRecoveryPoint?: boolean;
  readonly failRuntimeStop?: boolean;
  readonly foreignActivationJournal?: boolean;
}

function createFixture(options: FixtureOptions = {}) {
  const events: string[] = [];
  let activationJournal: ProfileRestoreActivationJournal | undefined =
    options.foreignActivationJournal
      ? createActivationJournal(
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'prepared',
        )
      : undefined;
  const proof: WorkspaceActivationMigrationProof = Object.freeze({
    operationId,
    profileId,
    registrySnapshot: new Uint8Array([1]),
    sourceWorkspaceId,
    switchJournalSnapshot: new Uint8Array([2]),
    targetWorkspaceId,
  });
  const requestRelaunch = vi.fn(() => events.push('runtime.relaunch'));
  const stopTargetStartupRuntime = vi.fn(async () => {
    events.push('runtime.stop');
    if (options.failRuntimeStop) throw new Error('stop-failed');
  });
  const sourceRecovery = {
    recoverFromFailure: vi.fn(async () => {
      events.push('source.recover');
      return 'relaunchRequired' as const;
    }),
    requireRecovery: vi.fn(async () => {
      events.push('source.requireRecovery');
      return 'recoveryRequired' as const;
    }),
  };
  const activation = {
    journalStore: {
      read: vi.fn(async () => {
        events.push('activation.read');
        return activationJournal;
      }),
    },
    transaction: {
      accept: vi.fn(async () => undefined),
      advanceToValidation: vi.fn(async () => {
        events.push('activation.advance');
        if (options.failActivationAdvance) {
          throw new Error('swap-failed');
        }
        activationJournal = createActivationJournal(
          operationId,
          'validationStarting',
        );
        return activationJournal;
      }),
      clearRolledBack: vi.fn(async () => undefined),
      prepare: vi.fn(async () => {
        events.push('activation.prepare');
        activationJournal = createActivationJournal(
          operationId,
          'prepared',
        );
      }),
      rollback: vi.fn(async () => {
        events.push('activation.rollback');
        activationJournal = createActivationJournal(
          operationId,
          'rolledBack',
        );
        return activationJournal;
      }),
    },
  };
  const rootStore = {
    discardBeforeActivation: vi.fn(async () => {
      events.push('candidate.discard');
    }),
    inspectCandidate: vi.fn(async () => {
      events.push('candidate.inspect');
    }),
    prepareCandidate: vi.fn(async () => {
      events.push('candidate.prepareRoot');
    }),
    removeImportStaging: vi.fn(async () => undefined),
  };
  const coordinator = new WorkspaceActivationMigrationCoordinator({
    activationAuthorityFactory: {
      create: () => activation,
    },
    backupCandidate: {
      migrate: vi.fn(async () => {
        events.push('candidate.migrate');
        if (options.failCandidateMigration) {
          throw new Error('migration-failed');
        }
        return {
          handlesClosed: true,
          migrationChainIdentity: targetMigrationChainIdentity,
          profileId,
        } as const;
      }),
      validateAndMaterialize: vi.fn(async () => {
        events.push('candidate.validate');
        return createCandidateReadiness();
      }),
      validatePublished: vi.fn(async () => createCandidateReadiness()),
    },
    guard: {
      reprove: vi.fn(async () => {
        events.push('guard.reprove');
      }),
    },
    maintenanceLease: {
      acquire: vi.fn(async () => {
        events.push('lease.acquire');
        return {
          release: vi.fn(async () => {
            events.push('lease.release');
            if (options.failLeaseRelease) {
              throw new Error('release-failed');
            }
          }),
        };
      }),
    },
    recoveryPoint: {
      createAndStage: vi.fn(async () => {
        events.push('recovery.createAndStage');
        if (options.failRecoveryPoint) {
          throw new Error('recovery-point-failed');
        }
        return {
          appVersion: '0.2.6',
          artifactTotalByteSize: 1,
          createdAt: '2026-08-22T00:00:00.000Z',
          documentCount: 1,
          migrationChainIdentity: sourceMigrationChainIdentity,
          operationRoot: 'C:\\safe\\staged',
          profileId,
        };
      }),
      removeStaging: vi.fn(async () => {
        events.push('recovery.removeStaging');
      }),
    },
    requestRelaunch,
    rootStore,
    sourceRecovery,
    userDataRoot: 'C:\\safe\\user-data',
    workspaceRuntimeAbsence: {
      assertNoActiveWorkspaceRuntime: vi.fn(async () => {
        events.push('runtime.absent');
      }),
    },
  });

  return {
    activation,
    coordinator,
    events,
    input: {
      expectedSourceMigrationChainIdentity: sourceMigrationChainIdentity,
      proof,
      stopTargetStartupRuntime,
    },
    requestRelaunch,
    rootStore,
    sourceRecovery,
    stopTargetStartupRuntime,
  };
}

function createCandidateReadiness() {
  return Object.freeze({
    actorId: 'local-owner' as const,
    artifactRootHealth: 'ready' as const,
    companyId: 'company-test',
    databaseHealth: 'healthy' as const,
    foreignKeyHealth: 'healthy' as const,
    handlesClosed: true as const,
    lineageIdentity: Object.freeze({
      formatVersion: 1 as const,
      profileId,
    }),
    migrationChainIdentity: targetMigrationChainIdentity,
    migrationState: 'current' as const,
  });
}

function createActivationJournal(
  journalOperationId: string,
  phase: ProfileRestoreActivationJournal['phase'],
): ProfileRestoreActivationJournal {
  return {
    formatVersion: 1,
    hadActiveDatabase: true,
    hadActiveDocuments: true,
    operationId: journalOperationId,
    phase,
    revision: 1,
  };
}
