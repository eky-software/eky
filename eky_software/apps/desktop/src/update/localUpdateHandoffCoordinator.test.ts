import { describe, expect, it, vi } from 'vitest';

import {
  LocalUpdateHandoffCoordinator,
  LocalUpdateHandoffError,
} from './localUpdateHandoffCoordinator.js';
import type { UpdateJournal } from './updateJournal.js';

const currentIdentity = {
  appVersion: '0.1.0',
  buildRevision: 'aaaaaaaaaaaa',
  msiProductVersion: '0.1.0',
  packageSha256: 'a'.repeat(64),
  packageSize: 1_024,
};
const candidateIdentity = {
  appVersion: '0.2.0',
  buildRevision: 'bbbbbbbbbbbb',
  msiProductVersion: '0.2.0',
  packageSha256: 'b'.repeat(64),
  packageSize: 2_048,
};
const recoveryPointReference = '11111111-1111-4111-8111-111111111111';

describe('local update handoff coordinator', () => {
  it('persists a validated recovery point before allowing handoff', async () => {
    const fixture = createFixture();
    const journal = await fixture.coordinator.prepareConfirmedUpdate();

    expect(journal).toMatchObject({
      handoffAttemptCount: 0,
      preUpdateMigrationChainIdentity: 'c'.repeat(64),
      recoveryPointReference,
      state: 'recoveryPointValidated',
    });
    expect(fixture.states).toEqual(['prepared', 'recoveryPointValidated']);
    expect(fixture.validateActiveProfile).toHaveBeenCalledOnce();
    expect(fixture.createValidatedPreUpdatePoint).toHaveBeenCalledOnce();
  });

  it('writes awaitingFirstStart before one exact installer launch', async () => {
    const order: string[] = [];
    const fixture = createFixture({
      onLaunch() {
        order.push('launch');
      },
      onShutdown() {
        order.push('shutdown');
      },
      onWrite(state) {
        order.push(`journal:${state}`);
      },
    });
    await fixture.coordinator.prepareConfirmedUpdate();
    order.length = 0;

    await fixture.coordinator.handoffPreparedUpdate();

    expect(order).toEqual([
      'journal:runtimeStopping',
      'shutdown',
      'journal:awaitingFirstStart',
      'launch',
    ]);
    expect(fixture.launchInstaller).toHaveBeenCalledOnce();
    expect(fixture.currentJournal).toMatchObject({
      handoffAttemptCount: 1,
      state: 'awaitingFirstStart',
    });
    await expect(
      fixture.coordinator.handoffPreparedUpdate(),
    ).rejects.toThrow(LocalUpdateHandoffError);
    expect(fixture.launchInstaller).toHaveBeenCalledOnce();
  });

  it('does not stop runtime or launch when package revalidation fails', async () => {
    const fixture = createFixture({ revalidationFails: true });
    await fixture.coordinator.prepareConfirmedUpdate();

    await expect(
      fixture.coordinator.handoffPreparedUpdate(),
    ).rejects.toThrow(LocalUpdateHandoffError);

    expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
    expect(fixture.launchInstaller).not.toHaveBeenCalled();
    expect(fixture.currentJournal?.state).toBe('failed');
  });

  it('leaves maintenance and never launches after graceful shutdown failure', async () => {
    const fixture = createFixture({ shutdownFails: true });
    await fixture.coordinator.prepareConfirmedUpdate();

    await expect(
      fixture.coordinator.handoffPreparedUpdate(),
    ).rejects.toThrow(LocalUpdateHandoffError);

    expect(fixture.leaveMaintenance).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(fixture.launchInstaller).not.toHaveBeenCalled();
    expect(fixture.currentJournal?.state).toBe('failed');
    expect(fixture.operationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'UPDATE_SHUTDOWN_TIMEOUT',
        stage: 'runtimeShutdown',
      }),
    );
  });

  it('fails preparation without shutdown when profile validation fails', async () => {
    const fixture = createFixture({ profileValidationFails: true });

    await expect(
      fixture.coordinator.prepareConfirmedUpdate(),
    ).rejects.toThrow(LocalUpdateHandoffError);

    expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
    expect(fixture.launchInstaller).not.toHaveBeenCalled();
    expect(fixture.currentJournal).toBeUndefined();
    expect(fixture.states).toEqual([]);
  });

  it('rejects handoff when the migration chain changes after recovery preparation', async () => {
    const fixture = createFixture({ profileMigrationChanges: true });
    await fixture.coordinator.prepareConfirmedUpdate();

    await expect(
      fixture.coordinator.handoffPreparedUpdate(),
    ).rejects.toThrow(LocalUpdateHandoffError);

    expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
    expect(fixture.launchInstaller).not.toHaveBeenCalled();
    expect(fixture.leaveMaintenance).toHaveBeenCalledOnce();
    expect(fixture.currentJournal?.state).toBe('failed');
  });
});

function createFixture(options: {
  onLaunch?(): void;
  onShutdown?(): void;
  onWrite?(state: string): void;
  profileMigrationChanges?: boolean;
  profileValidationFails?: boolean;
  revalidationFails?: boolean;
  shutdownFails?: boolean;
} = {}) {
  let currentJournal: Readonly<UpdateJournal> | undefined;
  let profileValidationCount = 0;
  const states: string[] = [];
  const validateActiveProfile = vi.fn(async () => {
    profileValidationCount += 1;
    if (options.profileValidationFails) {
      throw new Error('unhealthy');
    }
    return {
      artifactCount: 0,
      artifactTotalByteSize: 0,
      databaseHealth: 'healthy' as const,
      migrationChainIdentity:
        options.profileMigrationChanges && profileValidationCount > 1
          ? 'd'.repeat(64)
          : 'c'.repeat(64),
    };
  });
  const createValidatedPreUpdatePoint = vi.fn(
    async () => recoveryPointReference,
  );
  const enterMaintenance = vi.fn(async () => undefined);
  const leaveMaintenance = vi.fn(async () => undefined);
  const shutdownRuntime = vi.fn(async () => {
    options.onShutdown?.();
    if (options.shutdownFails) {
      throw new Error('shutdown failed');
    }
  });
  const launchInstaller = vi.fn(async () => {
    options.onLaunch?.();
  });
  const operationCompleted = vi.fn();
  const operationFailed = vi.fn();
  const operationStarted = vi.fn();
  const coordinator = new LocalUpdateHandoffCoordinator({
    cache: {
      async readExpectedPackageIdentity(role) {
        return role === 'current' ? currentIdentity : candidateIdentity;
      },
      async revalidateJournalPackage() {
        if (options.revalidationFails) {
          throw new Error('mutated');
        }
        return {
          appVersion: candidateIdentity.appVersion,
          buildRevision: candidateIdentity.buildRevision,
          msiProductVersion: candidateIdentity.msiProductVersion,
          packagePath: 'C:\\private\\candidate.msi',
        };
      },
    },
    journalStore: {
      async clear() {
        currentJournal = undefined;
      },
      async read() {
        return currentJournal;
      },
      async write(journal) {
        currentJournal = journal;
        states.push(journal.state);
        options.onWrite?.(journal.state);
      },
    },
    launchInstaller,
    now: createClock(),
    observer: {
      operationCompleted,
      operationFailed,
      operationStarted,
    },
    operationIdFactory: () =>
      '22222222-2222-4222-8222-222222222222',
    profileProtection: {
      createValidatedPreUpdatePoint,
      enterMaintenance,
      leaveMaintenance,
      validateActiveProfile,
    },
    shutdownRuntime,
  });
  return {
    coordinator,
    createValidatedPreUpdatePoint,
    enterMaintenance,
    get currentJournal() {
      return currentJournal;
    },
    launchInstaller,
    leaveMaintenance,
    operationCompleted,
    operationFailed,
    operationStarted,
    shutdownRuntime,
    states,
    validateActiveProfile,
  };
}

function createClock(): () => Date {
  let minute = 0;
  return () => new Date(`2026-08-11T18:${String(minute++).padStart(2, '0')}:00.000Z`);
}
