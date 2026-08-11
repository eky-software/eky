import { describe, expect, it } from 'vitest';

import type { UpdateJournal } from './updateJournal.js';
import { readUpdateProtectedRecoveryPointReferences } from './updateRecoveryPointProtection.js';

const recoveryPointReference =
  '11111111-1111-4111-8111-111111111111';

describe('update recovery point protection', () => {
  it.each([
    'recoveryPointValidated',
    'runtimeStopping',
    'awaitingFirstStart',
    'firstStartValidating',
    'rollbackRequired',
  ] as const)('protects the referenced point in %s state', async (state) => {
    await expect(
      readUpdateProtectedRecoveryPointReferences({
        read: async () => createJournal(state),
      }),
    ).resolves.toEqual([recoveryPointReference]);
  });

  it.each(['prepared', 'accepted', 'rolledBack', 'failed'] as const)(
    'releases journal protection in %s state',
    async (state) => {
      await expect(
        readUpdateProtectedRecoveryPointReferences({
          read: async () => createJournal(state),
        }),
      ).resolves.toEqual([]);
    },
  );

  it('returns no protection without an update journal', async () => {
    await expect(
      readUpdateProtectedRecoveryPointReferences({
        read: async () => undefined,
      }),
    ).resolves.toEqual([]);
  });
});

function createJournal(state: UpdateJournal['state']): UpdateJournal {
  return {
    candidatePackageIdentity: {
      buildRevision: 'bbbbbbbbbbbb',
      msiProductVersion: '0.2.0',
      packageSha256: 'b'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-08-11T18:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: 'aaaaaaaaaaaa',
      msiProductVersion: '0.1.0',
      packageSha256: 'a'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: '0.1.0',
    formatVersion: 1,
    handoffAttemptCount:
      state === 'prepared' ||
      state === 'recoveryPointValidated' ||
      state === 'runtimeStopping'
        ? 0
        : 1,
    ...(state === 'prepared'
      ? {}
      : { recoveryPointReference }),
    releaseChannel: 'pilot',
    revision: 1,
    state,
    targetVersion: '0.2.0',
    updatedAt: '2026-08-11T18:00:00.000Z',
  };
}
