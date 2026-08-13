import { describe, expect, it, vi } from 'vitest';

import {
  FirstStartUpdateCoordinator,
  FirstStartUpdateError,
  type MigrationStartupInspection,
} from './firstStartUpdateCoordinator.js';
import type { UpdateJournal } from './updateJournal.js';
import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
  type DirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';

const recoveryPointReference = '11111111-1111-4111-8111-111111111111';
const preMigrationPointReference = '33333333-3333-4333-8333-333333333333';
const currentIdentity = {
  buildRevision: 'aaaaaaaaaaaa',
  msiProductVersion: '0.1.0',
  packageSha256: 'a'.repeat(64),
  packageSize: 1_024,
};
const candidateIdentity = {
  buildRevision: 'bbbbbbbbbbbb',
  msiProductVersion: '0.2.0',
  packageSha256: 'b'.repeat(64),
  packageSize: 2_048,
};
const releaseInfo = {
  appIdentity: 'Eky' as const,
  appVersion: '0.2.0',
  architecture: 'x64' as const,
  buildRevision: candidateIdentity.buildRevision,
  msiProductVersion: candidateIdentity.msiProductVersion,
  platform: 'win32' as const,
  releaseChannel: 'pilot' as const,
  schemaVersion: 1 as const,
  upgradeCode: '11111111-1111-4111-8111-111111111111',
};
const currentReleaseInfo = {
  ...releaseInfo,
  appVersion: '0.1.0',
  buildRevision: currentIdentity.buildRevision,
  msiProductVersion: currentIdentity.msiProductVersion,
};

describe('first-start update coordinator', () => {
  it('accepts a clean initial install without creating a recovery point', async () => {
    const fixture = createFixture();

    await fixture.coordinator.beforeMigrations(createInspection('empty', 38));
    expect(fixture.createValidatedPreMigrationPoint).not.toHaveBeenCalled();
    expect(fixture.acceptedWrites).toHaveLength(0);

    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.acceptedWrites).toEqual([
      expect.objectContaining({
        appVersion: '0.2.0',
        buildRevision: candidateIdentity.buildRevision,
      }),
    ]);
    expect(fixture.validateActiveProfile).toHaveBeenCalledOnce();
  });

  it('creates a validated pre-migration point before a direct Setup upgrade', async () => {
    const fixture = createFixture({
      acceptedBuild: {
        acceptedAt: '2026-08-10T18:00:00.000Z',
        appVersion: '0.1.0',
        buildRevision: currentIdentity.buildRevision,
        formatVersion: 1,
        releaseChannel: 'pilot',
      },
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 1),
    );
    expect(fixture.createValidatedPreMigrationPoint).toHaveBeenCalledOnce();
    expect(fixture.validateProtectedRecoveryPoint).toHaveBeenCalledWith({
      expectedMigrationChainIdentity: 'a'.repeat(64),
      recoveryPointReference: preMigrationPointReference,
    });
    expect(fixture.directRecoveryStates).toEqual([
      'prepared',
      'migrationRunning',
    ]);

    await fixture.coordinator.acceptAfterBackendReady();
    expect(fixture.directRecoveryStates).toEqual([
      'prepared',
      'migrationRunning',
      'accepted',
      'cleared',
    ]);
    expect(fixture.releaseProtectedPoint).toHaveBeenCalledWith(
      preMigrationPointReference,
    );
  });

  it('reuses the original recovery point after a crash before migration side effects', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      directSetupRecovery: createDirectSetupRunningRecovery(),
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 1),
    );

    expect(fixture.createValidatedPreMigrationPoint).not.toHaveBeenCalled();
    expect(fixture.validateProtectedRecoveryPoint).toHaveBeenCalledWith({
      expectedMigrationChainIdentity: 'a'.repeat(64),
      recoveryPointReference: preMigrationPointReference,
    });
    expect(fixture.directRecoveryWrites.at(-1)).toEqual(
      expect.objectContaining({
        attemptCount: 2,
        recoveryPointReference: preMigrationPointReference,
        state: 'migrationRunning',
      }),
    );
  });

  it('requires recovery instead of replacing the point after partial migration', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      directSetupRecovery: createDirectSetupRunningRecovery(),
    });
    const changedInspection = {
      ...createInspection('existing', 1),
      appliedMigrationCount: 38,
      migrationChainIdentity: 'c'.repeat(64),
    };

    await expect(
      fixture.coordinator.beforeMigrations(changedInspection),
    ).rejects.toThrow(FirstStartUpdateError);

    expect(fixture.createValidatedPreMigrationPoint).not.toHaveBeenCalled();
    expect(fixture.directRecoveryStates).toEqual(['recoveryRequired']);
    expect(fixture.directRecoveryWrites.at(-1)).toEqual(
      expect.objectContaining({
        recoveryPointReference: preMigrationPointReference,
        state: 'recoveryRequired',
      }),
    );
  });

  it('finishes acceptance after a crash between direct recovery commit and cleanup', async () => {
    const acceptedRecovery = transitionDirectSetupMigrationRecovery(
      createDirectSetupRunningRecovery(),
      {
        at: '2026-08-11T18:04:00.000Z',
        state: 'accepted',
      },
    );
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      directSetupRecovery: acceptedRecovery,
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );
    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.createValidatedPreMigrationPoint).not.toHaveBeenCalled();
    expect(fixture.acceptedWrites).toHaveLength(1);
    expect(fixture.directRecoveryStates).toEqual(['cleared']);
    expect(fixture.releaseProtectedPoint).toHaveBeenCalledWith(
      preMigrationPointReference,
    );
  });

  it('accepts only the previous build after a direct Setup business rollback', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      directSetupRecovery: createDirectSetupAwaitingPreviousBuild(),
      runningReleaseInfo: currentReleaseInfo,
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );
    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.acceptedWrites).toEqual([
      expect.objectContaining({
        appVersion: currentReleaseInfo.appVersion,
        buildRevision: currentReleaseInfo.buildRevision,
      }),
    ]);
    expect(fixture.directRecoveryStates).toEqual(['accepted', 'cleared']);
    expect(fixture.releaseProtectedPoint).toHaveBeenCalledWith(
      preMigrationPointReference,
    );
  });

  it('rejects the target build while direct Setup recovery awaits the previous build', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      directSetupRecovery: createDirectSetupAwaitingPreviousBuild(),
    });

    await expect(
      fixture.coordinator.beforeMigrations(
        createInspection('existing', 1),
      ),
    ).rejects.toThrow(FirstStartUpdateError);

    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.directRecoveryStates).toEqual(['failedSafe']);
  });

  it('keeps an already accepted build read-only at the migration gate', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCandidateBuild(),
      journal: createJournal('accepted'),
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );
    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.validateActiveProfile).not.toHaveBeenCalled();
    expect(fixture.promoteAcceptedCandidate).not.toHaveBeenCalled();
  });

  it('rejects pending migrations under an already accepted build', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCandidateBuild(),
      journal: createJournal('accepted'),
    });

    await expect(
      fixture.coordinator.beforeMigrations(
        createInspection('existing', 1),
      ),
    ).rejects.toThrow(FirstStartUpdateError);
    expect(fixture.createValidatedPreMigrationPoint).not.toHaveBeenCalled();
  });

  it('validates, migrates and atomically accepts a coordinated update', async () => {
    const fixture = createFixture({
      acceptedBuild: {
        acceptedAt: '2026-08-10T18:00:00.000Z',
        appVersion: '0.1.0',
        buildRevision: currentIdentity.buildRevision,
        formatVersion: 1,
        releaseChannel: 'pilot',
      },
      journal: createJournal('awaitingFirstStart'),
      rejectConcurrentRevalidations: true,
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 1),
    );
    expect(fixture.journalStates).toEqual(['firstStartValidating']);
    expect(fixture.createValidatedPreMigrationPoint).not.toHaveBeenCalled();
    expect(fixture.validateProtectedRecoveryPoint).toHaveBeenCalledWith({
      expectedMigrationChainIdentity: 'a'.repeat(64),
      recoveryPointReference,
    });

    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.promoteAcceptedCandidate).toHaveBeenCalledOnce();
    expect(fixture.journalStates).toEqual([
      'firstStartValidating',
      'accepted',
    ]);
    expect(fixture.releaseProtectedPoint).toHaveBeenCalledWith(
      recoveryPointReference,
    );
    expect(fixture.operationStarted).toHaveBeenCalledWith({
      correlationId: '22222222-2222-4222-8222-222222222222',
      stage: 'firstStartValidation',
    });
    expect(fixture.operationCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: '22222222-2222-4222-8222-222222222222',
        stage: 'firstStartValidation',
      }),
    );
  });

  it('resumes after an interrupted accepted cache rotation without rotating twice', async () => {
    const fixture = createFixture({
      acceptedBuild: {
        acceptedAt: '2026-08-10T18:00:00.000Z',
        appVersion: '0.1.0',
        buildRevision: currentIdentity.buildRevision,
        formatVersion: 1,
        releaseChannel: 'pilot',
      },
      cacheAlreadyRotated: true,
      journal: createJournal('firstStartValidating'),
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );
    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.promoteAcceptedCandidate).not.toHaveBeenCalled();
    expect(fixture.journalStates).toEqual(['accepted']);
  });

  it('reports a bounded cache-rotation stage when acceptance rotation fails', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingFirstStart'),
      promoteFails: true,
    });
    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );

    await expect(
      fixture.coordinator.acceptAfterBackendReady(),
    ).rejects.toMatchObject({
      failureStage: 'packageCacheRotation',
      name: 'FirstStartUpdateError',
    });

    expect(fixture.journalStates).toEqual([
      'firstStartValidating',
      'rollbackRequired',
    ]);
  });

  it('reports only a bounded stage when coordinated package validation fails', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingFirstStart'),
      revalidationFails: true,
    });

    const error = await fixture.coordinator
      .beforeMigrations(createInspection('existing', 0))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      failureStage: 'preMigrationCoordinatedPackageValidation',
      message: 'The installed Eky build could not be accepted safely.',
      name: 'FirstStartUpdateError',
    });
    expect(String(error)).not.toContain('C:\\private');
    expect(fixture.journalStates).toEqual(['rollbackRequired']);
  });

  it('fails closed before coordinated migrations when the protected point cannot be revalidated', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingFirstStart'),
      protectedRecoveryPointFails: true,
    });

    await expect(
      fixture.coordinator.beforeMigrations(
        createInspection('existing', 1),
      ),
    ).rejects.toMatchObject({
      failureStage: 'preMigrationRecoveryPoint',
      name: 'FirstStartUpdateError',
    });
    expect(fixture.journalStates).toEqual(['rollbackRequired']);
  });

  it('keeps a committed acceptance when retention cleanup must be retried later', async () => {
    const fixture = createFixture({
      acceptedBuild: {
        acceptedAt: '2026-08-10T18:00:00.000Z',
        appVersion: '0.1.0',
        buildRevision: currentIdentity.buildRevision,
        formatVersion: 1,
        releaseChannel: 'pilot',
      },
      journal: createJournal('awaitingFirstStart'),
      releaseFails: true,
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 1),
    );
    await expect(
      fixture.coordinator.acceptAfterBackendReady(),
    ).resolves.toBeUndefined();

    expect(fixture.acceptedWrites).toHaveLength(1);
    expect(fixture.journalStates).toEqual([
      'firstStartValidating',
      'accepted',
    ]);
    expect(fixture.releaseProtectedPoint).toHaveBeenCalledOnce();
  });

  it('marks the journal rollback-required when post-start validation fails', async () => {
    const fixture = createFixture({
      acceptedBuild: {
        acceptedAt: '2026-08-10T18:00:00.000Z',
        appVersion: '0.1.0',
        buildRevision: currentIdentity.buildRevision,
        formatVersion: 1,
        releaseChannel: 'pilot',
      },
      journal: createJournal('awaitingFirstStart'),
      secretChanges: true,
    });
    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );

    await expect(
      fixture.coordinator.acceptAfterBackendReady(),
    ).rejects.toThrow(FirstStartUpdateError);

    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.journalStates).toEqual([
      'firstStartValidating',
      'rollbackRequired',
    ]);
    expect(fixture.operationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'UPDATE_FIRST_START_FAILED',
        sideEffectState: 'unknown',
        stage: 'firstStartValidation',
      }),
    );
  });

  it('requests a relaunch when the coordinated backend fails after the migration gate', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingFirstStart'),
    });
    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 1),
    );

    await expect(
      fixture.coordinator.recoverFromStartupFailure(),
    ).resolves.toBe(true);
    expect(fixture.journalStates).toEqual([
      'firstStartValidating',
      'rollbackRequired',
    ]);
  });

  it('does not revert a committed acceptance after a later startup failure', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingFirstStart'),
    });
    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 1),
    );
    await fixture.coordinator.acceptAfterBackendReady();

    await expect(
      fixture.coordinator.recoverFromStartupFailure(),
    ).resolves.toBe(false);
    expect(fixture.journalStates).toEqual([
      'firstStartValidating',
      'accepted',
    ]);
  });

  it('does not turn an ordinary startup failure into update rollback', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCandidateBuild(),
    });
    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );

    await expect(
      fixture.coordinator.recoverFromStartupFailure(),
    ).resolves.toBe(false);
    expect(fixture.journalStates).toEqual([]);
  });

  it('fails closed before migrations when the installed build does not match the journal', async () => {
    const fixture = createFixture({
      journal: {
        ...createJournal('awaitingFirstStart'),
        targetVersion: '0.3.0',
      },
    });

    await expect(
      fixture.coordinator.beforeMigrations(
        createInspection('existing', 1),
      ),
    ).rejects.toThrow(FirstStartUpdateError);
    expect(fixture.journalStates).toEqual(['failedSafe']);
    expect(fixture.createValidatedPreMigrationPoint).not.toHaveBeenCalled();
  });

  it('records installer-not-applied when the current build returns after installer cancellation', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingFirstStart'),
      runningReleaseInfo: currentReleaseInfo,
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );
    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.journalStates).toEqual(['installerNotApplied']);
    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.promoteAcceptedCandidate).not.toHaveBeenCalled();
    expect(fixture.releaseProtectedPoint).toHaveBeenCalledWith(
      recoveryPointReference,
    );
  });

  it('resolves a failed handoff as installer-not-applied when the current build is intact', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('failed'),
      runningReleaseInfo: currentReleaseInfo,
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );
    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.journalStates).toEqual(['installerNotApplied']);
    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.promoteAcceptedCandidate).not.toHaveBeenCalled();
  });

  it('treats a resolved installer-not-applied journal as an idempotent normal startup', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('installerNotApplied'),
      runningReleaseInfo: currentReleaseInfo,
    });

    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );
    await fixture.coordinator.acceptAfterBackendReady();

    expect(fixture.journalStates).toEqual([]);
    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.promoteAcceptedCandidate).not.toHaveBeenCalled();
    expect(fixture.releaseProtectedPoint).not.toHaveBeenCalled();
    expect(fixture.operationCompleted).toHaveBeenCalledOnce();
  });

  it('fails closed when a resolved installer-not-applied startup no longer matches the migration chain', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('installerNotApplied'),
      runningReleaseInfo: currentReleaseInfo,
    });

    await expect(
      fixture.coordinator.beforeMigrations({
        ...createInspection('existing', 0),
        migrationChainIdentity: 'c'.repeat(64),
      }),
    ).rejects.toThrow(FirstStartUpdateError);

    expect(fixture.journalStates).toEqual([]);
    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.releaseProtectedPoint).not.toHaveBeenCalled();
  });

  it('fails safe when the current build returns with a changed migration chain', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingFirstStart'),
      runningReleaseInfo: currentReleaseInfo,
    });
    const changedInspection = {
      ...createInspection('existing', 0),
      migrationChainIdentity: 'c'.repeat(64),
    };

    await expect(
      fixture.coordinator.beforeMigrations(changedInspection),
    ).rejects.toThrow(FirstStartUpdateError);

    expect(fixture.journalStates).toEqual(['failedSafe']);
    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.promoteAcceptedCandidate).not.toHaveBeenCalled();
  });

  it('fails safe when post-start validation observes a changed migration chain', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      activeMigrationChainIdentity: 'c'.repeat(64),
      journal: createJournal('awaitingFirstStart'),
      runningReleaseInfo: currentReleaseInfo,
    });
    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );

    await expect(
      fixture.coordinator.acceptAfterBackendReady(),
    ).rejects.toThrow(FirstStartUpdateError);

    expect(fixture.journalStates).toEqual(['failedSafe']);
    expect(fixture.acceptedWrites).toHaveLength(0);
    expect(fixture.promoteAcceptedCandidate).not.toHaveBeenCalled();
  });

  it.each([
    ['current', acceptedCurrentBuild()],
    ['candidate', acceptedCandidateBuild()],
  ] as const)(
    'accepts the exact old build after rollback when accepted metadata still names %s',
    async (_acceptedState, acceptedBuild) => {
      const fixture = createFixture({
        acceptedBuild,
        cacheAlreadyRotated: true,
        journal: createJournal('awaitingRollbackFirstStart'),
        runningReleaseInfo: currentReleaseInfo,
      });

      await fixture.coordinator.beforeMigrations(
        createInspection('existing', 0),
      );
      await fixture.coordinator.acceptAfterBackendReady();

      expect(fixture.normalizeRolledBackPackages).toHaveBeenCalledOnce();
      expect(fixture.promoteAcceptedCandidate).not.toHaveBeenCalled();
      expect(fixture.journalStates).toEqual(['rolledBack']);
      expect(fixture.acceptedWrites).toEqual([
        expect.objectContaining({
          appVersion: currentReleaseInfo.appVersion,
          buildRevision: currentReleaseInfo.buildRevision,
        }),
      ]);
      expect(fixture.releaseProtectedPoint).toHaveBeenCalledWith(
        recoveryPointReference,
      );
    },
  );

  it('requires recovery when the old build sees a changed rollback profile', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingRollbackFirstStart'),
      runningReleaseInfo: currentReleaseInfo,
    });

    await expect(
      fixture.coordinator.beforeMigrations({
        ...createInspection('existing', 0),
        migrationChainIdentity: 'c'.repeat(64),
      }),
    ).rejects.toThrow(FirstStartUpdateError);

    expect(fixture.journalStates).toEqual(['recoveryRequired']);
    expect(fixture.normalizeRolledBackPackages).not.toHaveBeenCalled();
    expect(fixture.acceptedWrites).toHaveLength(0);
  });

  it('requires recovery when secret storage changes across rollback validation', async () => {
    const fixture = createFixture({
      acceptedBuild: acceptedCurrentBuild(),
      journal: createJournal('awaitingRollbackFirstStart'),
      runningReleaseInfo: currentReleaseInfo,
      secretChanges: true,
    });
    await fixture.coordinator.beforeMigrations(
      createInspection('existing', 0),
    );

    await expect(
      fixture.coordinator.acceptAfterBackendReady(),
    ).rejects.toThrow(FirstStartUpdateError);

    expect(fixture.journalStates).toEqual(['recoveryRequired']);
    expect(fixture.acceptedWrites).toHaveLength(0);
  });
});

function createFixture(options: {
  acceptedBuild?: ReturnType<typeof acceptedCandidateBuild>;
  activeMigrationChainIdentity?: string;
  cacheAlreadyRotated?: boolean;
  directSetupRecovery?: Readonly<DirectSetupMigrationRecovery>;
  journal?: Readonly<UpdateJournal>;
  promoteFails?: boolean;
  protectedRecoveryPointFails?: boolean;
  revalidationFails?: boolean;
  rejectConcurrentRevalidations?: boolean;
  releaseFails?: boolean;
  runningReleaseInfo?: typeof releaseInfo;
  secretChanges?: boolean;
} = {}) {
  let journal = options.journal;
  let cacheRotated = options.cacheAlreadyRotated ?? false;
  let secretReadCount = 0;
  let revalidationActive = false;
  const acceptedWrites: unknown[] = [];
  let directSetupRecovery = options.directSetupRecovery;
  const directRecoveryStates: string[] = [];
  const directRecoveryWrites: Readonly<DirectSetupMigrationRecovery>[] = [];
  const journalStates: string[] = [];
  const createValidatedPreMigrationPoint = vi.fn(
    async () => preMigrationPointReference,
  );
  const releaseProtectedPoint = vi.fn(async () => {
    if (options.releaseFails) {
      throw new Error('retention cleanup deferred');
    }
  });
  const validateProtectedRecoveryPoint = vi.fn(async () => {
    if (options.protectedRecoveryPointFails) {
      throw new Error('synthetic protected recovery point failure');
    }
  });
  const validateActiveProfile = vi.fn(async () => ({
    artifactCount: 1,
    artifactTotalByteSize: 100,
    databaseHealth: 'healthy' as const,
    migrationChainIdentity:
      options.activeMigrationChainIdentity ?? 'a'.repeat(64),
  }));
  const promoteAcceptedCandidate = vi.fn(async () => {
    if (options.promoteFails) {
      throw new Error('synthetic cache rotation failure');
    }
    cacheRotated = true;
  });
  const normalizeRolledBackPackages = vi.fn(async () => {
    cacheRotated = false;
    return {
      appVersion: currentReleaseInfo.appVersion,
      buildRevision: currentReleaseInfo.buildRevision,
      msiProductVersion: currentReleaseInfo.msiProductVersion,
      packagePath: 'C:\\private\\Eky-current.msi',
      productCode: '{11111111-1111-4111-8111-111111111111}',
    };
  });
  const operationCompleted = vi.fn();
  const operationFailed = vi.fn();
  const operationStarted = vi.fn();
  const coordinator = new FirstStartUpdateCoordinator({
    acceptedBuildStore: {
      read: async () => options.acceptedBuild,
      async write(metadata) {
        acceptedWrites.push(metadata);
      },
    },
    buildInfo: {
      buildDirty: false,
      buildRevision:
        (options.runningReleaseInfo ?? releaseInfo).buildRevision,
    },
    cache: {
      normalizeRolledBackPackages,
      promoteAcceptedCandidate,
      async revalidateJournalPackage(input) {
        if (options.revalidationFails) {
          throw new Error('synthetic C:\\private\\update-cache failure');
        }
        if (options.rejectConcurrentRevalidations && revalidationActive) {
          throw new Error('concurrent cache operation');
        }
        revalidationActive = true;
        try {
          await Promise.resolve();
          const expectsCandidate =
            input.expectedIdentity.appVersion === '0.2.0';
          const valid = cacheRotated
            ? (input.role === 'current' && expectsCandidate) ||
              (input.role === 'previous' && !expectsCandidate)
            : (input.role === 'current' && !expectsCandidate) ||
              (input.role === 'candidate' && expectsCandidate);
          if (!valid) {
            throw new Error('slot mismatch');
          }
          return {
            appVersion: input.expectedIdentity.appVersion,
            buildRevision: input.expectedIdentity.buildRevision,
            msiProductVersion: input.expectedIdentity.msiProductVersion,
            packagePath: 'C:\\private\\Eky.msi',
            productCode: expectsCandidate
              ? '{22222222-2222-4222-8222-222222222222}'
              : '{11111111-1111-4111-8111-111111111111}',
          };
        } finally {
          revalidationActive = false;
        }
      },
    },
    directSetupRecoveryStore: {
      async clear() {
        directSetupRecovery = undefined;
        directRecoveryStates.push('cleared');
      },
      read: async () => directSetupRecovery,
      async write(next) {
        directSetupRecovery = next;
        directRecoveryWrites.push(next);
        directRecoveryStates.push(next.state);
      },
    },
    journalStore: {
      read: async () => journal,
      async write(next) {
        journal = next;
        journalStates.push(next.state);
      },
    },
    now: createClock(),
    observer: {
      operationCompleted,
      operationFailed,
      operationStarted,
    },
    operationIdFactory: () =>
      '44444444-4444-4444-8444-444444444444',
    profileProtection: {
      createValidatedPreMigrationPoint,
      releaseProtectedPoint,
      validateActiveProfile,
      validateProtectedRecoveryPoint,
    },
    async readSecretStorageIdentity() {
      secretReadCount += 1;
      return options.secretChanges && secretReadCount > 1
        ? 'b'.repeat(64)
        : 'a'.repeat(64);
    },
    releaseInfo: options.runningReleaseInfo ?? releaseInfo,
  });
  return {
    acceptedWrites,
    coordinator,
    createValidatedPreMigrationPoint,
    directRecoveryStates,
    directRecoveryWrites,
    journalStates,
    normalizeRolledBackPackages,
    operationCompleted,
    operationFailed,
    operationStarted,
    promoteAcceptedCandidate,
    releaseProtectedPoint,
    validateActiveProfile,
    validateProtectedRecoveryPoint,
  };
}

function createInspection(
  profileState: MigrationStartupInspection['profileState'],
  pendingMigrationCount: number,
): MigrationStartupInspection {
  return {
    appliedMigrationCount: profileState === 'empty' ? 0 : 37,
    migrationChainIdentity: 'a'.repeat(64),
    pendingMigrationCount,
    profileState,
  };
}

function createJournal(state: UpdateJournal['state']): UpdateJournal {
  return {
    binaryRollbackAttemptCount:
      state === 'binaryRollbackPrepared' ||
      state === 'awaitingRollbackFirstStart' ||
      state === 'rolledBack'
        ? 1
        : 0,
    candidatePackageIdentity: candidateIdentity,
    correlationId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-08-11T18:00:00.000Z',
    currentPackageIdentity: currentIdentity,
    currentVersion: '0.1.0',
    formatVersion: 1,
    handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: 'a'.repeat(64),
    recoveryPointReference,
    releaseChannel: 'pilot',
    revision: 4,
    state,
    targetVersion: '0.2.0',
    updatedAt: '2026-08-11T18:03:00.000Z',
  };
}

function acceptedCandidateBuild() {
  return {
    acceptedAt: '2026-08-11T18:04:00.000Z',
    appVersion: '0.2.0',
    buildRevision: candidateIdentity.buildRevision,
    formatVersion: 1 as const,
    releaseChannel: 'pilot' as const,
  };
}

function acceptedCurrentBuild() {
  return {
    acceptedAt: '2026-08-10T18:00:00.000Z',
    appVersion: '0.1.0',
    buildRevision: currentIdentity.buildRevision,
    formatVersion: 1 as const,
    releaseChannel: 'pilot' as const,
  };
}

function createDirectSetupRunningRecovery() {
  return transitionDirectSetupMigrationRecovery(
    createDirectSetupMigrationRecovery({
      appliedMigrationCount: 37,
      at: '2026-08-11T18:00:00.000Z',
      correlationId: '44444444-4444-4444-8444-444444444444',
      migrationPrefixIdentity: 'a'.repeat(64),
      previousAcceptedBuildIdentity: {
        appVersion: '0.1.0',
        buildRevision: currentIdentity.buildRevision,
      },
      recoveryPointReference: preMigrationPointReference,
      runningTargetBuildIdentity: {
        appVersion: releaseInfo.appVersion,
        buildRevision: releaseInfo.buildRevision,
      },
    }),
    {
      at: '2026-08-11T18:01:00.000Z',
      state: 'migrationRunning',
    },
  );
}

function createDirectSetupAwaitingPreviousBuild() {
  const running = createDirectSetupRunningRecovery();
  const required = transitionDirectSetupMigrationRecovery(running, {
    at: '2026-08-11T18:02:00.000Z',
    state: 'recoveryRequired',
  });
  const rollback = transitionDirectSetupMigrationRecovery(required, {
    at: '2026-08-11T18:03:00.000Z',
    state: 'businessRollbackStarting',
  });
  return transitionDirectSetupMigrationRecovery(rollback, {
    at: '2026-08-11T18:04:00.000Z',
    state: 'awaitingPreviousBuild',
  });
}

function createClock(): () => Date {
  let minute = 5;
  return () =>
    new Date(`2026-08-11T18:${String(minute++).padStart(2, '0')}:00.000Z`);
}
