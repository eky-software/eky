import { describe, expect, it, vi } from 'vitest';

import {
  LocalUpdateCacheMaintenance,
  LocalUpdateCacheMaintenanceError,
} from './localUpdateCacheMaintenance.js';
import type { UpdateJournal } from './updateJournal.js';

describe('local update cache maintenance', () => {
  it('discards only through a resolved or missing update journal', async () => {
    const discardCandidate = vi.fn(async () => undefined);
    const maintenance = new LocalUpdateCacheMaintenance({
      cache: {
        discardCandidate,
        repairCurrentRegistration: vi.fn(),
      },
      journalStore: { read: async () => undefined },
    });

    await maintenance.discardCandidate();
    expect(discardCandidate).toHaveBeenCalledOnce();
  });

  it('blocks candidate discard and current repair for every unresolved journal', async () => {
    for (const state of [
      'prepared',
      'recoveryPointValidated',
      'runtimeStopping',
      'awaitingFirstStart',
      'firstStartValidating',
      'rollbackRequired',
      'failed',
      'failedSafe',
    ] as const) {
      const cache = {
        discardCandidate: vi.fn(),
        repairCurrentRegistration: vi.fn(),
      };
      const maintenance = new LocalUpdateCacheMaintenance({
        cache,
        journalStore: { read: async () => createJournal(state) },
      });

      await expect(maintenance.discardCandidate()).rejects.toThrow(
        LocalUpdateCacheMaintenanceError,
      );
      await expect(
        maintenance.repairCurrentRegistration('C:\\selected\\manifest.json'),
      ).rejects.toThrow(LocalUpdateCacheMaintenanceError);
      expect(cache.discardCandidate).not.toHaveBeenCalled();
      expect(cache.repairCurrentRegistration).not.toHaveBeenCalled();
    }
  });

  it('passes an internally selected manifest only to exact current repair', async () => {
    const repairCurrentRegistration = vi.fn(async () => ({
      appVersion: '0.1.0',
      buildRevision: 'aaaaaaaaaaaa',
      msiProductVersion: '0.1.0',
      releaseChannel: 'pilot' as const,
      role: 'current' as const,
      signingStatus: 'unsigned-prototype' as const,
    }));
    const maintenance = new LocalUpdateCacheMaintenance({
      cache: { discardCandidate: vi.fn(), repairCurrentRegistration },
      journalStore: {
        read: async () => createJournal('installerNotApplied'),
      },
    });

    await expect(
      maintenance.repairCurrentRegistration('C:\\selected\\manifest.json'),
    ).resolves.toMatchObject({ role: 'current' });
    expect(repairCurrentRegistration).toHaveBeenCalledWith({
      manifestPath: 'C:\\selected\\manifest.json',
    });
  });
});

function createJournal(state: UpdateJournal['state']): UpdateJournal {
  return {
    candidatePackageIdentity: packageIdentity('b', '0.2.0'),
    correlationId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-08-11T18:00:00.000Z',
    currentPackageIdentity: packageIdentity('a', '0.1.0'),
    currentVersion: '0.1.0',
    formatVersion: 1,
    handoffAttemptCount: state === 'prepared' ? 0 : 1,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    ...(state === 'prepared'
      ? {}
      : {
          recoveryPointReference:
            '11111111-1111-4111-8111-111111111111',
        }),
    releaseChannel: 'pilot',
    revision: 1,
    state,
    targetVersion: '0.2.0',
    updatedAt: '2026-08-11T18:00:00.000Z',
  };
}

function packageIdentity(character: string, msiProductVersion: string) {
  return {
    buildRevision: character.repeat(12),
    msiProductVersion,
    packageSha256: character.repeat(64),
    packageSize: 1_024,
  };
}
