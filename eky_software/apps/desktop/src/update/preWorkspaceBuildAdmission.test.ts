import { describe, expect, it } from 'vitest';

import type { AcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';
import {
  classifyPreWorkspaceBuildAdmission,
  PreWorkspaceBuildAdmissionError,
  requirePreWorkspaceBuildAdmission,
} from './preWorkspaceBuildAdmission.js';
import type { UpdateJournal } from './updateJournal.js';

const acceptedRevision = 'aaaaaaaaaaaa';
const runningRevision = 'bbbbbbbbbbbb';
const acceptedBuild: AcceptedBuildMetadata = {
  acceptedAt: '2026-08-19T12:00:00.000Z',
  appVersion: '0.2.6',
  buildRevision: acceptedRevision,
  formatVersion: 1,
  releaseChannel: 'pilot',
};
const releaseInfo = {
  appIdentity: 'Eky' as const,
  appVersion: '0.2.7',
  architecture: 'x64' as const,
  buildRevision: runningRevision,
  msiProductVersion: '0.2.7',
  platform: 'win32' as const,
  releaseChannel: 'pilot' as const,
  schemaVersion: 1 as const,
  upgradeCode: '11111111-1111-4111-8111-111111111111',
};
const buildInfo = {
  appVersion: releaseInfo.appVersion,
  buildCreatedAt: '2026-08-20T10:00:00.000Z',
  buildDirty: false,
  buildRevision: releaseInfo.buildRevision,
  schemaVersion: 1 as const,
};

describe('pre-workspace build admission', () => {
  it('allows an initial install without installation-scoped state', () => {
    expect(classify({ acceptedBuild: undefined })).toEqual({
      admission: 'initialInstall',
      status: 'allowed',
    });
  });

  it('allows the exact accepted build', () => {
    expect(
      classify({
        acceptedBuild: {
          ...acceptedBuild,
          appVersion: releaseInfo.appVersion,
          buildRevision: releaseInfo.buildRevision,
        },
      }),
    ).toEqual({ admission: 'exactAcceptedBuild', status: 'allowed' });
  });

  it('allows a newer direct Setup build without unresolved state', () => {
    expect(classify()).toEqual({
      admission: 'authorizedNewerBuild',
      status: 'allowed',
    });
  });

  it('allows only the exact coordinated update target', () => {
    expect(classify({ journal: createJournal('awaitingFirstStart') })).toEqual({
      admission: 'coordinatedUpdateTarget',
      status: 'allowed',
    });
    expect(
      classify({
        journal: {
          ...createJournal('awaitingFirstStart'),
          candidatePackageIdentity: {
            ...createJournal('awaitingFirstStart').candidatePackageIdentity,
            buildRevision: 'cccccccccccc',
          },
        },
      }),
    ).toEqual({
      reason: 'mixedOrUnknownUpdateIdentity',
      status: 'rejected',
    });
  });

  it('rejects a same-version build with a different revision', () => {
    expect(
      classify({
        acceptedBuild: {
          ...acceptedBuild,
          appVersion: releaseInfo.appVersion,
        },
      }),
    ).toEqual({
      reason: 'sameVersionDifferentRevision',
      status: 'rejected',
    });
  });

  it('rejects a downgrade before workspace startup', () => {
    expect(
      classify({
        acceptedBuild: {
          ...acceptedBuild,
          appVersion: '0.2.8',
        },
      }),
    ).toEqual({ reason: 'downgrade', status: 'rejected' });
  });

  it('rejects dirty and mismatched packaged identities', () => {
    expect(
      classify({ buildInfo: { ...buildInfo, buildDirty: true } }),
    ).toEqual({
      reason: 'mixedOrUnknownUpdateIdentity',
      status: 'rejected',
    });
    expect(
      classify({
        buildInfo: { ...buildInfo, buildRevision: 'cccccccccccc' },
      }),
    ).toEqual({
      reason: 'mixedOrUnknownUpdateIdentity',
      status: 'rejected',
    });
  });

  it('allows only an identity-bound direct Setup recovery', () => {
    const recovery = createDirectSetupMigrationRecovery({
      appliedMigrationCount: 38,
      at: '2026-08-20T10:00:00.000Z',
      correlationId: '11111111-1111-4111-8111-111111111111',
      migrationPrefixIdentity: 'a'.repeat(64),
      previousAcceptedBuildIdentity: {
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
      },
      recoveryPointReference: '22222222-2222-4222-8222-222222222222',
      runningTargetBuildIdentity: {
        appVersion: releaseInfo.appVersion,
        buildRevision: releaseInfo.buildRevision,
      },
    });
    expect(classify({ directSetupRecovery: recovery })).toEqual({
      admission: 'authorizedNewerBuild',
      status: 'allowed',
    });
    expect(
      classify({
        directSetupRecovery: {
          ...recovery,
          runningTargetBuildIdentity: {
            ...recovery.runningTargetBuildIdentity,
            buildRevision: 'cccccccccccc',
          },
        },
      }),
    ).toEqual({
      reason: 'mixedOrUnknownUpdateIdentity',
      status: 'rejected',
    });
  });

  it('allows an accepted direct Setup record only with the accepted target', () => {
    const recovery = transitionDirectSetupMigrationRecovery(
      createDirectSetupMigrationRecovery({
        appliedMigrationCount: 38,
        at: '2026-08-20T10:00:00.000Z',
        correlationId: '11111111-1111-4111-8111-111111111111',
        migrationPrefixIdentity: 'a'.repeat(64),
        previousAcceptedBuildIdentity: {
          appVersion: acceptedBuild.appVersion,
          buildRevision: acceptedBuild.buildRevision,
        },
        recoveryPointReference: '22222222-2222-4222-8222-222222222222',
        runningTargetBuildIdentity: {
          appVersion: releaseInfo.appVersion,
          buildRevision: releaseInfo.buildRevision,
        },
      }),
      { at: '2026-08-20T10:01:00.000Z', state: 'migrationRunning' },
    );
    const acceptedRecovery = transitionDirectSetupMigrationRecovery(recovery, {
      at: '2026-08-20T10:02:00.000Z',
      state: 'accepted',
    });
    expect(
      classify({
        acceptedBuild: {
          ...acceptedBuild,
          appVersion: releaseInfo.appVersion,
          buildRevision: releaseInfo.buildRevision,
        },
        directSetupRecovery: acceptedRecovery,
      }),
    ).toEqual({ admission: 'exactAcceptedBuild', status: 'allowed' });
  });

  it('does not read installation state for a development runtime', async () => {
    let reads = 0;
    const stores = createStores({ onRead: () => (reads += 1) });
    await expect(
      requirePreWorkspaceBuildAdmission({
        buildInfo,
        releaseInfo: undefined,
        stores,
      }),
    ).resolves.toBe('development');
    expect(reads).toBe(0);
  });

  it('returns only an allowlisted error when admission is rejected', async () => {
    const stores = createStores({
      acceptedBuild: {
        ...acceptedBuild,
        appVersion: releaseInfo.appVersion,
      },
    });
    const error = await requirePreWorkspaceBuildAdmission({
      buildInfo,
      releaseInfo,
      stores,
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PreWorkspaceBuildAdmissionError);
    expect(error).toMatchObject({
      message: 'DESKTOP_BUILD_ADMISSION_REJECTED',
      reason: 'sameVersionDifferentRevision',
    });
    expect(JSON.stringify(error)).not.toContain(acceptedRevision);
    expect(JSON.stringify(error)).not.toContain(runningRevision);
  });
});

function classify(
  overrides: Partial<Parameters<typeof classifyPreWorkspaceBuildAdmission>[0]> = {},
) {
  return classifyPreWorkspaceBuildAdmission({
    acceptedBuild,
    buildInfo,
    directSetupRecovery: undefined,
    journal: undefined,
    releaseInfo,
    ...overrides,
  });
}

function createStores(input: {
  acceptedBuild?: AcceptedBuildMetadata;
  onRead?(): void;
} = {}) {
  return {
    acceptedBuild: {
      async read() {
        input.onRead?.();
        return input.acceptedBuild;
      },
    },
    directSetupRecovery: {
      async read() {
        input.onRead?.();
        return undefined;
      },
    },
    journal: {
      async read() {
        input.onRead?.();
        return undefined;
      },
    },
  };
}

function createJournal(state: UpdateJournal['state']): UpdateJournal {
  return {
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: {
      buildRevision: runningRevision,
      msiProductVersion: releaseInfo.msiProductVersion,
      packageSha256: 'b'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-08-20T10:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: acceptedRevision,
      msiProductVersion: '0.2.6',
      packageSha256: 'a'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: acceptedBuild.appVersion,
    formatVersion: 1,
    handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    recoveryPointReference: '44444444-4444-4444-8444-444444444444',
    releaseChannel: 'pilot',
    revision: 3,
    state,
    targetVersion: releaseInfo.appVersion,
    updatedAt: '2026-08-20T10:01:00.000Z',
  };
}
