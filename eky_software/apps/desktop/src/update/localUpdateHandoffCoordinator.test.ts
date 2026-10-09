import { describe, expect, it, vi } from 'vitest';

import {
  LocalUpdateHandoffCoordinator,
  LocalUpdateHandoffError,
} from './localUpdateHandoffCoordinator.js';
import type { UpdateJournal } from './updateJournal.js';
import {
  InMemoryWorkspaceMaintenanceLease,
  type WorkspaceMaintenanceLease,
} from '../workspaces/maintenance/workspaceMaintenanceLease.js';

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
const operationId = '22222222-2222-4222-8222-222222222222';

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
    expect(fixture.createValidatedPreUpdatePoint).toHaveBeenCalledWith(operationId);
    expect(fixture.beginUpdateMaintenance).toHaveBeenCalledWith(operationId);
    expect(fixture.fenceHeld).toBe(true);
    expect(fixture.endUpdateMaintenance).not.toHaveBeenCalled();
    await expect(fixture.maintenanceLease.acquire('backup')).rejects.toThrow();
  });

  it('reads exclusive package cache slots sequentially', async () => {
    const fixture = createFixture({ enforceSerialIdentityReads: true });

    await expect(
      fixture.coordinator.prepareConfirmedUpdate(),
    ).resolves.toMatchObject({ state: 'recoveryPointValidated' });

    expect(fixture.identityReadRoles).toEqual(['current', 'candidate']);
    expect(fixture.maxConcurrentIdentityReads).toBe(1);
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
    expect(fixture.shutdownRuntime).toHaveBeenCalledWith(operationId);
    expect(fixture.endUpdateMaintenance).not.toHaveBeenCalled();
    await expect(fixture.maintenanceLease.acquire('backup')).rejects.toThrow();
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

  it('retains maintenance and never launches after uncertain graceful shutdown', async () => {
    const fixture = createFixture({ shutdownFails: true });
    await fixture.coordinator.prepareConfirmedUpdate();

    await expect(
      fixture.coordinator.handoffPreparedUpdate(),
    ).rejects.toThrow(LocalUpdateHandoffError);

    expect(fixture.endUpdateMaintenance).not.toHaveBeenCalled();
    expect(fixture.fenceHeld).toBe(true);
    await expect(fixture.maintenanceLease.acquire('backup')).rejects.toThrow();
    expect(fixture.launchInstaller).not.toHaveBeenCalled();
    expect(fixture.currentJournal?.state).toBe('failed');
    expect(fixture.operationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'UPDATE_SHUTDOWN_TIMEOUT',
        sideEffectState: 'unknown',
        stage: 'runtimeShutdown',
      }),
    );
  });

  it('fails preparation without shutdown when profile validation fails', async () => {
    const fixture = createFixture({ profileValidationFails: true });

    await expect(fixture.coordinator.prepareConfirmedUpdate()).rejects.toMatchObject({
      code: 'UPDATE_PREPARATION_PROFILE_FAILED',
    });

    expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
    expect(fixture.launchInstaller).not.toHaveBeenCalled();
    expect(fixture.currentJournal).toBeUndefined();
    expect(fixture.states).toEqual([]);
  });

  it('classifies recovery point preparation without exposing the raw failure', async () => {
    const fixture = createFixture({ recoveryPointFails: true });

    const result = fixture.coordinator.prepareConfirmedUpdate();

    await expect(result).rejects.toMatchObject({
      code: 'UPDATE_PREPARATION_RECOVERY_POINT_FAILED',
      message: 'The local update could not be handed off safely.',
    });
    expect(fixture.currentJournal?.state).toBe('failed');
  });

  it('rejects handoff when the migration chain changes after recovery preparation', async () => {
    const fixture = createFixture({ profileMigrationChanges: true });
    await fixture.coordinator.prepareConfirmedUpdate();

    await expect(
      fixture.coordinator.handoffPreparedUpdate(),
    ).rejects.toThrow(LocalUpdateHandoffError);

    expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
    expect(fixture.launchInstaller).not.toHaveBeenCalled();
    expect(fixture.endUpdateMaintenance).toHaveBeenCalledOnce();
    expect(fixture.currentJournal?.state).toBe('failed');
  });

  it('does not prepare an update while another workspace maintenance operation is active', async () => {
    const maintenanceLease = new InMemoryWorkspaceMaintenanceLease();
    const owner = await maintenanceLease.acquire('backup');
    const fixture = createFixture({ maintenanceLease });

    await expect(fixture.coordinator.prepareConfirmedUpdate()).rejects.toMatchObject({
      code: 'UPDATE_PREPARATION_MAINTENANCE_FAILED',
    });
    expect(fixture.validateActiveProfile).not.toHaveBeenCalled();
    expect(fixture.states).toEqual([]);

    await owner.release();
    await expect(
      fixture.coordinator.prepareConfirmedUpdate(),
    ).resolves.toMatchObject({ state: 'recoveryPointValidated' });
  });

  it('cannot reconstruct live ownership from a durable prepared journal', async () => {
    const previous = createFixture();
    const journal = await previous.coordinator.prepareConfirmedUpdate();
    const fixture = createFixture();
    fixture.replaceJournal(journal);
    await expect(fixture.coordinator.handoffPreparedUpdate()).rejects.toThrow(LocalUpdateHandoffError);
    expect(fixture.states).toEqual([]);
    expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
    expect(fixture.launchInstaller).not.toHaveBeenCalled();
  });

  it.each(['missing', 'changed', 'unreadable'] as const)(
    'preserves ambiguous live evidence and ownership (%s)', async mode => {
      const fixture = createFixture();
      const journal = await fixture.coordinator.prepareConfirmedUpdate();
      if (mode === 'missing') fixture.replaceJournal(undefined);
      if (mode === 'changed') fixture.replaceJournal({ ...journal, targetVersion: '0.2.1' });
      if (mode === 'unreadable') fixture.readForLiveOwner.mockRejectedValue(new Error('recovery slots'));
      const before = fixture.currentJournal;
      await expect(fixture.coordinator.handoffPreparedUpdate()).rejects.toThrow();
      expect(fixture.currentJournal).toEqual(before);
      expect(fixture.states).toEqual(['prepared', 'recoveryPointValidated']);
      expect(fixture.endUpdateMaintenance).not.toHaveBeenCalled();
      expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
      await expect(fixture.maintenanceLease.acquire('backup')).rejects.toThrow();
      await expect(fixture.coordinator.prepareConfirmedUpdate()).rejects.toThrow();
    },
  );

  it.each(['prepared', 'recoveryPointValidated', 'failed'])(
    'retains ownership if a journal write publishes then rejects (%s)', async failedState => {
      const fixture = createFixture({
        recoveryPointFails: failedState === 'failed',
        onWrite(state) { if (state === failedState) throw new Error('after publication'); },
      });
      await expect(fixture.coordinator.prepareConfirmedUpdate()).rejects.toThrow();
      expect(fixture.currentJournal?.state).toBe(failedState);
      expect(fixture.endUpdateMaintenance).not.toHaveBeenCalled();
      await expect(fixture.maintenanceLease.acquire('backup')).rejects.toThrow();
      await expect(fixture.coordinator.prepareConfirmedUpdate()).rejects.toThrow();
      expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
    },
  );

  it.each(['rejects', 'mismatch'] as const)(
    'latches the first ownership ambiguity even if another read would match (%s)', async mode => {
      const fixture = createFixture();
      const journal = await fixture.coordinator.prepareConfirmedUpdate();
      fixture.readForLiveOwner.mockClear();
      if (mode === 'rejects') fixture.readForLiveOwner.mockRejectedValueOnce(new Error('uncertain read'));
      else fixture.readForLiveOwner.mockResolvedValueOnce({ ...journal, targetVersion: '0.2.1' });
      await expect(fixture.coordinator.handoffPreparedUpdate()).rejects.toThrow();
      expect(fixture.readForLiveOwner).toHaveBeenCalledOnce();
      expect(fixture.currentJournal).toEqual(journal);
      expect(fixture.states).toEqual(['prepared', 'recoveryPointValidated']);
      expect(fixture.endUpdateMaintenance).not.toHaveBeenCalled();
      expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
      await expect(fixture.maintenanceLease.acquire('backup')).rejects.toThrow();
    },
  );

  it('releases a safe pre-stop abort only after terminal write and exact readback', async () => {
    const order: string[] = [];
    const fixture = createFixture({
      recoveryPointFails: true,
      onWrite(state) { order.push(`write:${state}`); },
    });
    fixture.readForLiveOwner.mockImplementation(async () => {
      order.push(`read:${fixture.currentJournal?.state ?? 'absent'}`);
      return fixture.currentJournal;
    });
    fixture.endUpdateMaintenance.mockImplementation(async () => {
      order.push('end');
    });
    await expect(fixture.coordinator.prepareConfirmedUpdate()).rejects.toThrow();
    expect(order.slice(-3)).toEqual(['write:failed', 'read:failed', 'end']);
    const nextLease = await fixture.maintenanceLease.acquire('backup');
    await nextLease.release();
  });

  it('does not release after a contradictory terminal readback', async () => {
    const fixture = createFixture({ recoveryPointFails: true });
    fixture.readForLiveOwner.mockImplementation(async () => {
      const current = fixture.currentJournal;
      return current?.state === 'failed' ? { ...current, targetVersion: '0.2.1' } : current;
    });
    await expect(fixture.coordinator.prepareConfirmedUpdate()).rejects.toThrow();
    expect(fixture.endUpdateMaintenance).not.toHaveBeenCalled();
    await expect(fixture.maintenanceLease.acquire('backup')).rejects.toThrow();
  });

  it.each(['revalidation', 'validation', 'runtimeStopping'] as const)(
    'does not start shutdown when the fence is lost during %s', async phase => {
      const fixture = createFixture({
        onWrite(state) { if (phase === 'runtimeStopping' && state === phase) fixture.invalidateFence(); },
        onRevalidation() { if (phase === 'revalidation') fixture.invalidateFence(); },
      });
      await fixture.coordinator.prepareConfirmedUpdate();
      if (phase === 'validation') fixture.validateActiveProfile.mockImplementation(async () => {
        fixture.invalidateFence();
        return { artifactCount: 0, artifactTotalByteSize: 0, databaseHealth: 'healthy', migrationChainIdentity: 'c'.repeat(64) };
      });
      await expect(fixture.coordinator.handoffPreparedUpdate()).rejects.toThrow();
      expect(fixture.shutdownRuntime).not.toHaveBeenCalled();
      expect(fixture.launchInstaller).not.toHaveBeenCalled();
      expect(fixture.endUpdateMaintenance).not.toHaveBeenCalled();
      expect(fixture.fenceHeld).toBe(true);
      await expect(fixture.maintenanceLease.acquire('backup')).rejects.toThrow();
    },
  );

  it('holds the same owner while revalidation is pending and rejects overlapping preparation', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const fixture = createFixture({ onRevalidation: async () => { entered(); await gate; } });
    await fixture.coordinator.prepareConfirmedUpdate();
    const handoff = fixture.coordinator.handoffPreparedUpdate();
    await started;
    try {
      expect(fixture.fenceHeld).toBe(true);
      await expect(fixture.maintenanceLease.acquire('switch')).rejects.toThrow();
      await expect(fixture.coordinator.prepareConfirmedUpdate()).rejects.toThrow();
    } finally { release(); }
    await handoff;
    expect(fixture.beginUpdateMaintenance).toHaveBeenCalledOnce();
  });
});

function createFixture(options: {
  enforceSerialIdentityReads?: boolean;
  onLaunch?(): void;
  onShutdown?(): void;
  onWrite?(state: string): void;
  onRevalidation?(): void | Promise<void>;
  maintenanceLease?: WorkspaceMaintenanceLease;
  profileMigrationChanges?: boolean;
  profileValidationFails?: boolean;
  recoveryPointFails?: boolean;
  revalidationFails?: boolean;
  shutdownFails?: boolean;
} = {}) {
  let currentJournal: Readonly<UpdateJournal> | undefined;
  let activeIdentityReads = 0;
  let maxConcurrentIdentityReads = 0;
  let profileValidationCount = 0;
  let fenceHeld = false;
  let fenceValid = false;
  const maintenanceLease = options.maintenanceLease ?? new InMemoryWorkspaceMaintenanceLease();
  const identityReadRoles: Array<'candidate' | 'current'> = [];
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
    async (id: string) => {
      if (id !== operationId || !fenceHeld || !fenceValid) throw new Error('invalid fence');
      if (options.recoveryPointFails) {
        throw new Error('private recovery point path');
      }
      return recoveryPointReference;
    },
  );
  const beginUpdateMaintenance = vi.fn(async (id: string) => {
    if (id !== operationId || fenceHeld) throw new Error('invalid fence');
    fenceHeld = true;
    fenceValid = true;
  });
  const assertUpdateMaintenance = vi.fn(async (id: string) => {
    if (id !== operationId || !fenceHeld || !fenceValid) throw new Error('invalid fence');
  });
  const endUpdateMaintenance = vi.fn(async (id: string) => {
    if (id !== operationId || !fenceHeld || !fenceValid) throw new Error('invalid fence');
    fenceHeld = false;
  });
  const readForLiveOwner = vi.fn(async () => currentJournal);
  const shutdownRuntime = vi.fn(async (_id: string) => {
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
        identityReadRoles.push(role);
        activeIdentityReads += 1;
        maxConcurrentIdentityReads = Math.max(
          maxConcurrentIdentityReads,
          activeIdentityReads,
        );
        try {
          if (
            options.enforceSerialIdentityReads &&
            activeIdentityReads > 1
          ) {
            throw new Error('concurrent package cache read');
          }
          await Promise.resolve();
          return role === 'current' ? currentIdentity : candidateIdentity;
        } finally {
          activeIdentityReads -= 1;
        }
      },
      async revalidateJournalPackage() {
        await options.onRevalidation?.();
        if (options.revalidationFails) {
          throw new Error('mutated');
        }
        return {
          appVersion: candidateIdentity.appVersion,
          buildRevision: candidateIdentity.buildRevision,
          msiProductVersion: candidateIdentity.msiProductVersion,
          packagePath: 'C:\\private\\candidate.msi',
          productCode: '{22222222-2222-4222-8222-222222222222}',
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
      readForLiveOwner,
      async write(journal) {
        currentJournal = journal;
        states.push(journal.state);
        options.onWrite?.(journal.state);
      },
    },
    launchInstaller,
    maintenanceLease,
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
      beginUpdateMaintenance,
      assertUpdateMaintenance,
      endUpdateMaintenance,
      validateActiveProfile,
    },
    shutdownRuntime,
  });
  return {
    coordinator,
    createValidatedPreUpdatePoint,
    beginUpdateMaintenance,
    assertUpdateMaintenance,
    endUpdateMaintenance,
    readForLiveOwner,
    maintenanceLease,
    get fenceHeld() { return fenceHeld; },
    invalidateFence() { fenceValid = false; },
    replaceJournal(value: Readonly<UpdateJournal> | undefined) { currentJournal = value; },
    get currentJournal() {
      return currentJournal;
    },
    launchInstaller,
    identityReadRoles,
    get maxConcurrentIdentityReads() {
      return maxConcurrentIdentityReads;
    },
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
