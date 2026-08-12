import { describe, expect, it, vi } from 'vitest';

import type { RevalidatedLocalUpdatePackageHandle } from './localUpdatePackageCache.js';
import {
  UpdateBinaryRollbackCoordinator,
  UpdateRollbackPackageRequiredError,
} from './updateBinaryRollbackCoordinator.js';
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
    const failedPackage = createFailedPackage();
    const revalidateJournalPackage = vi.fn(async () => {
      order.push('revalidateFailed');
      return failedPackage;
    });
    const coordinator = new UpdateBinaryRollbackCoordinator({
      cache: createCache({
        normalizeRolledBackPackages,
        revalidateJournalPackage,
      }),
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
      'revalidateFailed',
      'binaryRollbackPrepared',
      'awaitingRollbackFirstStart',
      'launch',
    ]);
    expect(stored.binaryRollbackAttemptCount).toBe(1);
    expect(launchInstaller).toHaveBeenCalledWith({
      failedPackage,
      rollbackPackage,
    });
    expect(revalidateJournalPackage).toHaveBeenCalledWith({
      expectedIdentity: expect.objectContaining({
        appVersion: '0.2.0',
        packageSha256: 'b'.repeat(64),
      }),
      role: 'candidate',
    });
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
        cache: createCache({ normalizeRolledBackPackages: vi.fn() }),
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
      cache: createCache({ normalizeRolledBackPackages }),
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
      cache: createCache({
        normalizeRolledBackPackages: async () => createRollbackPackage(),
      }),
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

  it('requires the exact old package without launching when cache recovery cannot find it', async () => {
    let stored = createJournal('businessRollbackCompleted');
    const launchInstaller = vi.fn();
    const normalizeRolledBackPackages = vi.fn();
    const coordinator = new UpdateBinaryRollbackCoordinator({
      cache: createCache({
        hasExpectedJournalPackage: async () => false,
        normalizeRolledBackPackages,
      }),
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

    await expect(coordinator.startIfRequired()).rejects.toBeInstanceOf(
      UpdateRollbackPackageRequiredError,
    );
    expect(stored.state).toBe('rollbackPackageRequired');
    expect(stored.binaryRollbackAttemptCount).toBe(0);
    expect(normalizeRolledBackPackages).not.toHaveBeenCalled();
    expect(launchInstaller).not.toHaveBeenCalled();
  });

  it('registers only the journal-bound package before the single rollback launch', async () => {
    let stored = createJournal('rollbackPackageRequired');
    const order: string[] = [];
    const registerExactRollbackPackage = vi.fn(async () => {
      order.push('register');
      return {
        appVersion: '0.1.0',
        buildRevision: 'a'.repeat(40),
        msiProductVersion: '0.1.0',
        releaseChannel: 'pilot' as const,
        role: 'current' as const,
        signingStatus: 'unsigned-prototype' as const,
      };
    });
    const coordinator = new UpdateBinaryRollbackCoordinator({
      cache: createCache({
        hasExpectedJournalPackage: async () => true,
        normalizeRolledBackPackages: async () => {
          order.push('normalize');
          return createRollbackPackage();
        },
        registerExactRollbackPackage,
      }),
      journalStore: {
        read: async () => stored,
        write: async (next) => {
          stored = next;
          order.push(next.state);
        },
      },
      launchInstaller: async () => {
        order.push('launch');
      },
      now: createClock(),
      releaseInfo: createReleaseInfo(),
    });

    await expect(
      coordinator.registerAndStartManualRollback(
        'C:\\selected\\old-package.manifest.json',
      ),
    ).resolves.toBe('launched');

    expect(registerExactRollbackPackage).toHaveBeenCalledWith({
      expectedIdentity: expect.objectContaining({
        appVersion: '0.1.0',
        buildRevision: 'a'.repeat(40),
        packageSha256: 'a'.repeat(64),
      }),
      manifestPath: 'C:\\selected\\old-package.manifest.json',
    });
    expect(order).toEqual([
      'register',
      'businessRollbackCompleted',
      'normalize',
      'binaryRollbackPrepared',
      'awaitingRollbackFirstStart',
      'launch',
    ]);
  });
});

function createJournal(
  state:
    | 'awaitingRollbackFirstStart'
    | 'binaryRollbackPrepared'
    | 'businessRollbackCompleted'
    | 'rollbackPackageRequired',
): Readonly<UpdateJournal> {
  return {
    binaryRollbackAttemptCount:
      state === 'businessRollbackCompleted' ||
      state === 'rollbackPackageRequired'
        ? 0
        : 1,
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

function createCache(
  overrides: Partial<{
    hasExpectedJournalPackage: () => Promise<boolean>;
    normalizeRolledBackPackages: () => Promise<
      Readonly<RevalidatedLocalUpdatePackageHandle>
    >;
    revalidateJournalPackage: () => Promise<
      Readonly<RevalidatedLocalUpdatePackageHandle>
    >;
    registerExactRollbackPackage: () => Promise<{
      appVersion: string;
      buildRevision: string;
      msiProductVersion: string;
      releaseChannel: 'pilot';
      role: 'current';
      signingStatus: 'unsigned-prototype';
    }>;
  }> = {},
) {
  return {
    hasExpectedJournalPackage: async () => true,
    normalizeRolledBackPackages: async () => createRollbackPackage(),
    revalidateJournalPackage: async () => createFailedPackage(),
    registerExactRollbackPackage: async () => ({
      appVersion: '0.1.0',
      buildRevision: 'a'.repeat(40),
      msiProductVersion: '0.1.0',
      releaseChannel: 'pilot' as const,
      role: 'current' as const,
      signingStatus: 'unsigned-prototype' as const,
    }),
    ...overrides,
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
    productCode: '{11111111-1111-4111-8111-111111111111}',
  });
}

function createFailedPackage(): Readonly<RevalidatedLocalUpdatePackageHandle> {
  return Object.freeze({
    appVersion: '0.2.0',
    buildRevision: 'b'.repeat(40),
    msiProductVersion: '0.2.0',
    packagePath: 'C:\\private\\Eky-0.2.0-x64.msi',
    productCode: '{22222222-2222-4222-8222-222222222222}',
  });
}

function createClock(): () => Date {
  let minute = 0;
  return () =>
    new Date(`2026-08-12T12:${String(minute++).padStart(2, '0')}:00.000Z`);
}
