import { describe, expect, it, vi } from 'vitest';

import type { AcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
  type DirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';
import {
  PreBackendFirstStartFailureAuthority,
  PreBackendFirstStartFailureAuthorityError,
} from './preBackendFirstStartFailureAuthority.js';
import type { UpdateJournal } from './updateJournal.js';

const sourceRevision = 'aaaaaaaaaaaa';
const targetRevision = 'bbbbbbbbbbbb';
const at = new Date('2026-08-21T12:00:00.000Z');
const acceptedBuild: AcceptedBuildMetadata = {
  acceptedAt: '2026-08-20T12:00:00.000Z',
  appVersion: '0.2.6',
  buildRevision: sourceRevision,
  formatVersion: 1,
  releaseChannel: 'pilot',
};
const releaseInfo = {
  appIdentity: 'Eky' as const,
  appVersion: '0.2.7',
  architecture: 'x64' as const,
  buildRevision: targetRevision,
  msiProductVersion: '0.2.7',
  platform: 'win32' as const,
  releaseChannel: 'pilot' as const,
  schemaVersion: 1 as const,
  upgradeCode: '11111111-1111-4111-8111-111111111111',
};

describe('PreBackendFirstStartFailureAuthority', () => {
  it('moves an identity-bound coordinated update to rollbackRequired', async () => {
    const journal = createJournal('awaitingFirstStart');
    const harness = createHarness({ journal });

    await expect(
      harness.authority.recordFailure('coordinatedUpdateTarget'),
    ).resolves.toEqual({ kind: 'rollbackRequired' });

    expect(harness.writeJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: journal.correlationId,
        revision: journal.revision + 1,
        state: 'rollbackRequired',
      }),
    );
    expect(harness.writeDirectSetupRecovery).not.toHaveBeenCalled();
  });

  it('rejects a coordinated failure with a mismatched target identity', async () => {
    const harness = createHarness({
      journal: {
        ...createJournal('firstStartValidating'),
        candidatePackageIdentity: {
          ...createJournal('firstStartValidating').candidatePackageIdentity,
          buildRevision: 'cccccccccccc',
        },
      },
    });

    await expect(
      harness.authority.recordFailure('coordinatedUpdateTarget'),
    ).rejects.toBeInstanceOf(PreBackendFirstStartFailureAuthorityError);
    expect(harness.writeJournal).not.toHaveBeenCalled();
  });

  it('fails closed without inventing direct Setup recovery state', async () => {
    const harness = createHarness();

    await expect(
      harness.authority.recordFailure('authorizedNewerBuild'),
    ).resolves.toEqual({ kind: 'failedSafeWithoutRecovery' });

    expect(harness.writeJournal).not.toHaveBeenCalled();
    expect(harness.writeDirectSetupRecovery).not.toHaveBeenCalled();
  });

  it('marks an existing direct Setup recovery point as required', async () => {
    const recovery = createRecovery();
    const harness = createHarness({ directSetupRecovery: recovery });

    await expect(
      harness.authority.recordFailure('authorizedNewerBuild'),
    ).resolves.toEqual({ kind: 'directSetupRecoveryRequired' });

    expect(harness.writeDirectSetupRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: recovery.correlationId,
        revision: recovery.revision + 1,
        state: 'recoveryRequired',
      }),
    );
  });

  it('keeps an existing terminal direct Setup failure state unchanged', async () => {
    const recovery = transitionDirectSetupMigrationRecovery(createRecovery(), {
      at: '2026-08-21T11:00:00.000Z',
      state: 'failedSafe',
    });
    const harness = createHarness({ directSetupRecovery: recovery });

    await expect(
      harness.authority.recordFailure('authorizedNewerBuild'),
    ).resolves.toEqual({ kind: 'directSetupFailedSafe' });
    expect(harness.writeDirectSetupRecovery).not.toHaveBeenCalled();
  });

  it.each([
    'development',
    'exactAcceptedBuild',
    'initialInstall',
  ] as const)('does not touch update state for %s admission', async (admission) => {
    const harness = createHarness();

    await expect(harness.authority.recordFailure(admission)).resolves.toEqual({
      kind: 'notApplicable',
    });
    expect(harness.readAcceptedBuild).not.toHaveBeenCalled();
    expect(harness.readJournal).not.toHaveBeenCalled();
    expect(harness.readDirectSetupRecovery).not.toHaveBeenCalled();
  });
});

function createHarness(input: {
  accepted?: AcceptedBuildMetadata;
  directSetupRecovery?: Readonly<DirectSetupMigrationRecovery>;
  journal?: Readonly<UpdateJournal>;
} = {}) {
  const readAcceptedBuild = vi
    .fn()
    .mockResolvedValue(input.accepted ?? acceptedBuild);
  const readDirectSetupRecovery = vi
    .fn()
    .mockResolvedValue(input.directSetupRecovery);
  const readJournal = vi.fn().mockResolvedValue(input.journal);
  const writeDirectSetupRecovery = vi.fn().mockResolvedValue(undefined);
  const writeJournal = vi.fn().mockResolvedValue(undefined);
  return {
    authority: new PreBackendFirstStartFailureAuthority({
      acceptedBuildStore: { read: readAcceptedBuild },
      directSetupRecoveryStore: {
        read: readDirectSetupRecovery,
        write: writeDirectSetupRecovery,
      },
      journalStore: { read: readJournal, write: writeJournal },
      now: () => at,
      releaseInfo,
    }),
    readAcceptedBuild,
    readDirectSetupRecovery,
    readJournal,
    writeDirectSetupRecovery,
    writeJournal,
  };
}

function createRecovery(): Readonly<DirectSetupMigrationRecovery> {
  return createDirectSetupMigrationRecovery({
    appliedMigrationCount: 38,
    at: '2026-08-21T10:00:00.000Z',
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
}

function createJournal(state: UpdateJournal['state']): Readonly<UpdateJournal> {
  return {
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: {
      buildRevision: targetRevision,
      msiProductVersion: '0.2.7',
      packageSha256: 'b'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-08-21T10:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: sourceRevision,
      msiProductVersion: '0.2.6',
      packageSha256: 'a'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: '0.2.6',
    formatVersion: 1,
    handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    recoveryPointReference: '44444444-4444-4444-8444-444444444444',
    releaseChannel: 'pilot',
    revision: 5,
    state,
    targetVersion: '0.2.7',
    updatedAt: '2026-08-21T11:00:00.000Z',
  };
}
