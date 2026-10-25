import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { deriveWorkspaceBackupReplacementPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { NodeWorkspaceBackupReplacementRootStore } from '../replacement/workspaceBackupReplacementRootStore.js';
import { WorkspaceActivationMigrationCoordinator } from './workspaceActivationMigrationCoordinator.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
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
const testUserDataRoot = resolve(
  'test-data',
  'workspace-activation-migration',
);
const cleanupRoots: string[] = [];

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

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

  it('retains recovery staging and requires recovery when inspection cleanup is unresolved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eky-activation-preservation-'));
    cleanupRoots.push(root);
    const paths = deriveWorkspaceBackupReplacementPaths(
      root,
      validateWorkspaceBackupReplacementOperationId(operationId),
      targetWorkspaceId,
    );
    await mkdir(dirname(paths.activeDatabasePath), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(paths.activeArtifactRoot, { recursive: true, mode: 0o700 });
    await writeFile(paths.activeDatabasePath, 'unchanged target database');
    const stagedRoot = join(root, 'recovery', 'staged');
    const sourcePath = join(stagedRoot, 'profile.sqlite');
    await mkdir(stagedRoot, { recursive: true, mode: 0o700 });
    await writeFile(sourcePath, 'original recovery snapshot');
    const inspectionRoot = join(
      paths.activationStagingOperationRoot,
      'inspection-unresolved',
    );
    const inspectionPath = join(inspectionRoot, 'inspection.sqlite');
    const fixture = createFixture({
      failCandidateMigration: true,
      userDataRoot: root,
    });
    const store = new NodeWorkspaceBackupReplacementRootStore();
    fixture.rootStore.prepareCandidate.mockImplementation(async () => {
      fixture.events.push('candidate.prepareRoot');
      await store.prepareCandidate(paths);
      await writeFile(paths.candidateDatabasePath, 'unpublished candidate');
      await mkdir(inspectionRoot, { mode: 0o700 });
      await writeFile(inspectionPath, 'unresolved inspection copy');
    });
    fixture.rootStore.discardBeforeActivation.mockImplementation(async () => {
      fixture.events.push('candidate.discard');
      await store.discardBeforeActivation(paths);
    });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.rootStore.discardBeforeActivation).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.requireRecovery).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(fixture.requestRelaunch).not.toHaveBeenCalled();
    expect(fixture.activation.transaction.prepare).not.toHaveBeenCalled();
    expect(fixture.events).not.toContain('recovery.removeStaging');
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(
      'original recovery snapshot',
    );
    await expect(readFile(paths.candidateDatabasePath, 'utf8')).resolves.toBe(
      'unpublished candidate',
    );
    await expect(readFile(inspectionPath, 'utf8')).resolves.toBe(
      'unresolved inspection copy',
    );
    await expect(readFile(paths.activeDatabasePath, 'utf8')).resolves.toBe(
      'unchanged target database',
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

  it.each([
    { expireAt: 'lease.acquire' }, { expireAt: 'activation.read' },
    { expireAt: 'recovery.createAndStage' }, { expireAt: 'candidate.prepareRoot' },
    { expireAt: 'candidate.migrate' }, { expireAt: 'candidate.validate' },
    { expireAt: 'recovery.removeStaging' }, { expireAt: 'candidate.inspect' },
    { expireAt: 'activation.prepare' }, { expireAt: 'activation.advance' },
    { expireAt: 'activation.read', expireOccurrence: 2, failCandidateMigration: true },
    { expireAt: 'candidate.discard', failCandidateMigration: true },
    { expireAt: 'activation.rollback', failActivationAdvance: true },
    { expireAt: 'recovery.removeStaging', failCandidateMigration: true },
  ])('stops selector mutations after authority expires at $expireAt ($expireOccurrence)', async scenario => {
    const f = createFixture({ ...scenario, selector: true });
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });
    const expiry = f.events.indexOf('selector.expired');
    expect(expiry).toBeGreaterThan(-1);
    expect(f.events.slice(expiry + 1).every(event =>
      ['guard.reprove', 'runtime.stop', 'runtime.absent'].includes(event))).toBe(true);
    expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it.each([
    {}, { failCandidateMigration: true }, { failActivationAdvance: true },
    { failCandidateMigration: true, expireAt: 'source.recover' },
  ])(
    'preserves successful selector activation or owned recovery %#', async failure => {
      const f = createFixture({ ...failure, selector: true });
      await expect(f.coordinator.migrateAndActivate(f.input)).resolves.toBe('relaunchRequired');
      expect(f.requestRelaunch).toHaveBeenCalledOnce();
      expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    },
  );
});

interface FixtureOptions {
  readonly failActivationAdvance?: boolean;
  readonly failCandidateMigration?: boolean;
  readonly failLeaseRelease?: boolean;
  readonly failRecoveryPoint?: boolean;
  readonly failRuntimeStop?: boolean;
  readonly foreignActivationJournal?: boolean;
  readonly userDataRoot?: string;
  readonly selector?: boolean;
  readonly expireAt?: string;
  readonly expireOccurrence?: number;
}

function createFixture(options: FixtureOptions = {}) {
  const userDataRoot = options.userDataRoot ?? testUserDataRoot;
  const events: string[] = [];
  let selectorCurrent = true;
  let expiryOccurrences = 0;
  const record = (event: string) => {
    events.push(event);
    if (event === options.expireAt && ++expiryOccurrences === (options.expireOccurrence ?? 1)) {
      selectorCurrent = false;
      events.push('selector.expired');
    }
  };
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
    sourceWorkspaceId: options.selector ? null : sourceWorkspaceId,
    switchJournalSnapshot: new Uint8Array([2]),
    targetWorkspaceId,
  });
  const requestRelaunch = vi.fn(() => record('runtime.relaunch'));
  const stopTargetStartupRuntime = vi.fn(async () => {
    record('runtime.stop');
    if (options.failRuntimeStop) throw new Error('stop-failed');
  });
  const sourceRecovery = {
    recoverFromFailure: vi.fn(async () => {
      record('source.recover');
      return 'relaunchRequired' as const;
    }),
    requireRecovery: vi.fn(async () => {
      record('source.requireRecovery');
      return 'recoveryRequired' as const;
    }),
  };
  const activation = {
    journalStore: {
      read: vi.fn(async () => {
        record('activation.read');
        return activationJournal;
      }),
    },
    transaction: {
      assertForwardRecoveryState: vi.fn(async () => {
        throw new Error('SYNTHETIC_MIGRATION_HAS_NO_COLD_AUTHORITY');
      }),
      readForwardRecoverySources: vi.fn(async () => {
        throw new Error('SYNTHETIC_MIGRATION_HAS_NO_COLD_AUTHORITY');
      }),
      accept: vi.fn(async () => undefined),
      advanceToValidation: vi.fn(async () => {
        record('activation.advance');
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
        record('activation.prepare');
        activationJournal = createActivationJournal(
          operationId,
          'prepared',
        );
      }),
      commitAcceptance: vi.fn(async () => { throw new Error('UNEXPECTED_ACCEPTANCE_PUBLICATION'); }),
      clearAccepted: vi.fn(async () => { throw new Error('UNEXPECTED_ACCEPTED_CLEANUP'); }),
      rollback: vi.fn(async () => {
        record('activation.rollback');
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
      record('candidate.discard');
    }),
    inspectCandidate: vi.fn(async () => {
      record('candidate.inspect');
    }),
    prepareCandidate: vi.fn(async () => {
      record('candidate.prepareRoot');
    }),
    removeImportStaging: vi.fn(async () => undefined),
  };
  const coordinator = new WorkspaceActivationMigrationCoordinator({
    activationAuthorityFactory: {
      create: () => activation,
    },
    backupCandidate: {
      migrate: vi.fn(async () => {
        record('candidate.migrate');
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
        record('candidate.validate');
        return createCandidateReadiness();
      }),
      validatePublished: vi.fn(async () => createCandidateReadiness()),
    },
    guard: {
      reprove: vi.fn(async () => {
        record('guard.reprove');
        if (!selectorCurrent) throw new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
      }),
    },
    maintenanceLease: {
      acquire: vi.fn(async () => {
        record('lease.acquire');
        return {
          release: vi.fn(async () => {
            record('lease.release');
            if (options.failLeaseRelease) {
              throw new Error('release-failed');
            }
          }),
        };
      }),
    },
    recoveryPoint: {
      createAndStage: vi.fn(async () => {
        record('recovery.createAndStage');
        if (options.failRecoveryPoint) {
          throw new Error('recovery-point-failed');
        }
        return {
          appVersion: '0.2.6',
          artifactTotalByteSize: 1,
          createdAt: '2026-08-22T00:00:00.000Z',
          documentCount: 1,
          migrationChainIdentity: sourceMigrationChainIdentity,
          operationRoot: join(userDataRoot, 'recovery', 'staged'),
          profileId,
        };
      }),
      removeStaging: vi.fn(async () => {
        record('recovery.removeStaging');
      }),
    },
    requestRelaunch,
    rootStore,
    sourceRecovery,
    userDataRoot,
    workspaceRuntimeAbsence: {
      assertNoActiveWorkspaceRuntime: vi.fn(async () => {
        record('runtime.absent');
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
