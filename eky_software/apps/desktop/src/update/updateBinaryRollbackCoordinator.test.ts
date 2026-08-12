import { describe, expect, it, vi } from 'vitest';

import type { RevalidatedLocalUpdatePackageHandle } from './localUpdatePackageCache.js';
import { UpdateBinaryRollbackCoordinator } from './updateBinaryRollbackCoordinator.js';
import type { UpdateJournal } from './updateJournal.js';

describe('UpdateBinaryRollbackCoordinator', () => {
  it('durably records one attempt before launching the exact old package', async () => {
    let stored = createJournal('businessRollbackCompleted');
    const order: string[] = [];
    const rollbackPackage = createRollbackPackage();
    const launchInstaller = vi.fn(async () => {
      order.push('launch');
    });
    const normalizeRolledBackPackages = vi.fn(async () => {
      order.push('normalize');
      return rollbackPackage;
    });
    const coordinator = new UpdateBinaryRollbackCoordinator({
      cache: { normalizeRolledBackPackages },
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          stored = next;
          order.push(next.state);
        },
      },
      launchInstaller,
      now: createClock(),
      releaseInfo: createReleaseInfo(),
    });

    await expect(coordinator.startIfRequired()).resolves.toBe('launched');

    expect(order).toEqual([
      'normalize',
      'binaryRollbackPrepared',
      'awaitingRollbackFirstStart',
      'launch',
    ]);
    expect(stored.binaryRollbackAttemptCount).toBe(1);
    expect(launchInstaller).toHaveBeenCalledWith(rollbackPackage);
    expect(normalizeRolledBackPackages).toHaveBeenCalledWith({
      candidateIdentity: expect.objectContaining({
        appVersion: '0.2.0',
        packageSha256: 'b'.repeat(64),
      }),
      currentIdentity: expect.objectContaining({
        appVersion: '0.1.0',
        packageSha256: 'a'.repeat(64),
      }),
    });
  });

  it.each(['binaryRollbackPrepared', 'awaitingRollbackFirstStart'] as const)(
    'never repeats an automatic installer launch from %s',
    async (state) => {
      let stored = createJournal(state);
      const launchInstaller = vi.fn();
      const coordinator = new UpdateBinaryRollbackCoordinator({
        cache: { normalizeRolledBackPackages: vi.fn() },
        journalStore: {
          read: async () => stored,
          write: async (next) => {
            stored = next;
          },
        },
        launchInstaller,
        now: () => new Date('2026-08-12T12:00:00.000Z'),
        releaseInfo: createReleaseInfo(),
      });

      await expect(coordinator.startIfRequired()).rejects.toThrow(
        'requires recovery',
      );
      expect(stored.state).toBe('recoveryRequired');
      expect(launchInstaller).not.toHaveBeenCalled();
    },
  );

  it('leaves the exact old build to validate its rollback first start', async () => {
    const journal = createJournal('awaitingRollbackFirstStart');
    const write = vi.fn();
    const launchInstaller = vi.fn();
    const normalizeRolledBackPackages = vi.fn();
    const coordinator = new UpdateBinaryRollbackCoordinator({
      cache: { normalizeRolledBackPackages },
      journalStore: { read: async () => journal, write },
      launchInstaller,
      releaseInfo: createCurrentReleaseInfo(),
    });

    await expect(coordinator.startIfRequired()).resolves.toBe('notRequired');
    expect(write).not.toHaveBeenCalled();
    expect(normalizeRolledBackPackages).not.toHaveBeenCalled();
    expect(launchInstaller).not.toHaveBeenCalled();
  });

  it('fails safe without another attempt when installer launch fails', async () => {
    let stored = createJournal('businessRollbackCompleted');
    const coordinator = new UpdateBinaryRollbackCoordinator({
      cache: {
        normalizeRolledBackPackages: async () => createRollbackPackage(),
      },
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      launchInstaller: async () => {
        throw new Error('synthetic launch failure');
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      releaseInfo: createReleaseInfo(),
    });

    await expect(coordinator.startIfRequired()).rejects.toThrow(
      'requires recovery',
    );
    expect(stored.state).toBe('failedSafe');
    expect(stored.binaryRollbackAttemptCount).toBe(1);
  });
});

function createJournal(
  state:
    | 'awaitingRollbackFirstStart'
    | 'binaryRollbackPrepared'
    | 'businessRollbackCompleted',
): Readonly<UpdateJournal> {
  return {
    binaryRollbackAttemptCount:
      state === 'businessRollbackCompleted' ? 0 : 1,
    candidatePackageIdentity: {
      buildRevision: 'b'.repeat(40),
      msiProductVersion: '0.2.0',
      packageSha256: 'b'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-08-12T10:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: 'a'.repeat(40),
      msiProductVersion: '0.1.0',
      packageSha256: 'a'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: '0.1.0',
    formatVersion: 1,
    handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    releaseChannel: 'pilot',
    revision: 8,
    state,
    targetVersion: '0.2.0',
    updatedAt: '2026-08-12T11:00:00.000Z',
  };
}

function createReleaseInfo() {
  return {
    appIdentity: 'Eky' as const,
    appVersion: '0.2.0',
    architecture: 'x64' as const,
    buildRevision: 'b'.repeat(40),
    msiProductVersion: '0.2.0',
    platform: 'win32' as const,
    releaseChannel: 'pilot' as const,
    schemaVersion: 1 as const,
    upgradeCode: '33333333-3333-4333-8333-333333333333'.toUpperCase(),
  };
}

function createCurrentReleaseInfo() {
  return {
    ...createReleaseInfo(),
    appVersion: '0.1.0',
    buildRevision: 'a'.repeat(40),
    msiProductVersion: '0.1.0',
  };
}

function createRollbackPackage(): Readonly<RevalidatedLocalUpdatePackageHandle> {
  return Object.freeze({
    appVersion: '0.1.0',
    buildRevision: 'a'.repeat(40),
    msiProductVersion: '0.1.0',
    packagePath: 'C:\\private\\Eky-0.1.0-x64.msi',
  });
}

function createClock(): () => Date {
  let minute = 0;
  return () =>
    new Date(`2026-08-12T12:${String(minute++).padStart(2, '0')}:00.000Z`);
}
