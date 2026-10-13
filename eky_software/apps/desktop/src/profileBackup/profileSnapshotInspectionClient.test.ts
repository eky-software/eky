import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
  type ProfileInspectionReceipt,
} from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import { BackendRequestQuiescence } from '../main/backendRequestQuiescence.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedActiveWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.js';
import type { OwnedProfileBackupInspectionReservation } from './inspectOwnedEncryptedProfileBackup.js';
import { ProfileSnapshotInspectionClient } from './profileSnapshotInspectionClient.js';
import { ProfileRestoreActivationService } from './restore/profileRestoreActivationService.js';
import { PreparedProfileRestoreOwner } from './restore/preparedProfileRestoreOwner.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { validateOwnedActiveProfile } from './validateOwnedActiveProfile.js';
import { NodeWorkspaceActivationMigrationStaging } from '../workspaces/update/nodeWorkspaceActivationMigrationStaging.js';
import { validateWorkspaceBackupImportOperationId } from '../workspaces/import/workspaceBackupImportOperationId.js';

const boundary = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock('./runProfileSnapshotInspection.js', () => ({ runProfileSnapshotInspection: boundary.run }));

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOperationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const roots: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  boundary.run.mockReset().mockResolvedValue(result());
});
afterEach(async () => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fileSystem.rm(root, { force: true, recursive: true })));
});

describe('main-owned snapshot inspection client', () => {
  it('releases activation staging through its inspection owner before client shutdown', async () => {
    const f = await fixture();
    f.owner.assertMainOwned.mockImplementation(async () => { await fileSystem.lstat(f.operationRoot); });
    await f.client.validateProfileSnapshot(operationId);
    const remove = vi.spyOn(f.client, 'removeProfileSnapshot');
    const staging = new NodeWorkspaceActivationMigrationStaging(f.stagingRoot, f.client);

    await staging.removeOperationRoot(validateWorkspaceBackupImportOperationId(operationId));

    expect(remove).toHaveBeenCalledExactlyOnceWith(operationId);
    expect(f.owner.close).toHaveBeenCalledOnce();
    await expect(fileSystem.lstat(f.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.client.shutdown();
    expect(f.owner.close).toHaveBeenCalledOnce();
    expect(f.owner.invalidate).not.toHaveBeenCalled();
    expect(await fileSystem.readFile(join(f.stagingRoot, otherOperationId, 'profile.sqlite'), 'utf8'))
      .toBe('synthetic source');
  });

  it('retains activation staging when its inspection owner cannot authorize removal', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    f.owner.assertMainOwned.mockRejectedValue(new Error('synthetic ownership lost'));
    const staging = new NodeWorkspaceActivationMigrationStaging(f.stagingRoot, f.client);

    await expect(staging.removeOperationRoot(validateWorkspaceBackupImportOperationId(operationId)))
      .rejects.toMatchObject({ code: 'WORKSPACE_ACTIVATION_MIGRATION_FAILED' });

    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    expect(f.owner.close).not.toHaveBeenCalled();
    await expect(f.client.shutdown()).rejects.toThrow();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
  });

  it('keeps a failed startup snapshot tracked until its owned shutdown cleanup', async () => {
    const f = await fixture();
    const snapshot = await f.createSnapshot();
    f.createSnapshot.mockImplementation(async id => {
      await fileSystem.mkdir(join(f.stagingRoot, id!), { recursive: true });
      await fileSystem.writeFile(join(f.stagingRoot, id!, 'profile.sqlite'), 'synthetic source');
      return snapshot;
    });
    const receipt = result().receipt;
    boundary.run.mockResolvedValueOnce(result({ ...receipt, migrationPolicy: 'exactCurrentManifest' }));
    const lease = new InMemoryWorkspaceMaintenanceLease();
    const first = new Error('synthetic startup lineage refusal');
    await expect(validateOwnedActiveProfile({
      snapshotClient: f.client, maintenanceLease: lease, assertAuthority: () => {},
      assertLineage() { throw first; },
    })).rejects.toBe(first);
    const id = boundary.run.mock.calls[0]![0].operationId as string;
    const source = join(f.stagingRoot, id, 'profile.sqlite');
    expect(await fileSystem.readFile(source, 'utf8')).toBe('synthetic source');
    expect(f.otherOwner.close).not.toHaveBeenCalled();
    expect(lease.readState()).toBe('busy');
    await f.client.shutdown();
    expect(f.otherOwner.close).toHaveBeenCalledOnce();
    await expect(fileSystem.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.restoreFence.endRestoreMaintenance).not.toHaveBeenCalled();
  });

  it('rechecks native ownership and channel authority through the active consumer guard', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    await f.client.withProfileSnapshot(operationId, async (_receipt, assertCurrent) => {
      const before = f.owner.assertMainOwned.mock.calls.length;
      await assertCurrent();
      expect(f.owner.assertMainOwned.mock.calls.length).toBeGreaterThan(before);
      f.authority.mockImplementationOnce(() => { throw new Error('synthetic expired channel'); });
      await expect(assertCurrent()).rejects.toThrow('synthetic expired channel');
    });
    await f.client.shutdown();
  });

  it('does not let a completed consumer guard authorize a later consumer of the same receipt', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    let previous!: () => Promise<void>;
    await f.client.withProfileSnapshot(operationId, async (_receipt, assertCurrent) => { previous = assertCurrent; });
    await expect(previous()).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    await f.client.withProfileSnapshot(operationId, async (_receipt, assertCurrent) => {
      await expect(previous()).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      await assertCurrent();
    });
    await f.client.shutdown();
  });

  it('closes mutation admission without rejecting the drain of an existing consumer', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    await f.client.withProfileSnapshot(operationId, async (_receipt, assertCurrent) => {
      f.client.closeAdmission();
      await expect(assertCurrent()).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    });
    await f.client.shutdown();
    expect(f.owner.close).toHaveBeenCalledOnce();
  });

  it('keeps journal-owned staging across the actual activation consumer shutdown', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    const preparedOwner = new PreparedProfileRestoreOwner();
    preparedOwner.set({ operationId, targetDisposition: 'replaceActiveProfile', summary: {
      appVersion: '0.1.0-alpha.1', compatibilityStatus: 'compatible',
      createdAt: '2026-08-04T00:00:00.000Z', databaseHealth: 'healthy',
      documentCount: 0, formatVersion: 1, profileMatchStatus: 'same', totalBusinessByteSize: 1,
    } });
    const transaction = {
      prepare: vi.fn(async (_id: string, authority?: () => Promise<void>, capture?: (journal: import('./restore/profileRestoreActivationJournal.js').ProfileRestoreActivationJournal) => void) => {
        await authority?.();
        capture?.({ ...restoreJournal('validationStarting'), phase: 'prepared', revision: 0 });
      }), readPreparation: vi.fn(async () => 'prepared' as const),
      readOwnForwardProgress: vi.fn(),
      advanceToValidation: vi.fn(async () => {
        expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
        return restoreJournal('validationStarting');
      }),
      rollback: vi.fn(async () => { throw new Error('SYNTHETIC_ROLLBACK_NOT_ALLOWED'); }),
    };
    const service = new ProfileRestoreActivationService({
      profileSnapshotClient: f.client,
      stagingService: { claimPreparedRestore: id => preparedOwner.claim(id) },
      relaunchApplication: vi.fn(), transaction,
      async stopBusinessRuntime() { await f.client.shutdown(); },
    });
    await expect(service.activate(operationId)).resolves.toBe('relaunching');
    expect(transaction.readPreparation).toHaveBeenCalledWith(operationId,
      expect.objectContaining({ operationId, phase: 'prepared', revision: 0 }), expect.any(Function));
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(f.owner.close).toHaveBeenCalledOnce();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases only the reservation during shutdown of a retained recovery source', async () => {
    const f = await fixture();
    await f.client.prepareProfileRestoreSnapshot(operationId);
    f.client.retainProfileSnapshotForRecovery(operationId);
    await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(() => f.client.validateProfileSnapshot(operationId)).toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    await expect(f.client.withProfileSnapshot(operationId, async () => undefined)).rejects.toThrow('PROFILE_PROTECTION_OPERATION_BUSY');
    await f.client.shutdown();
    expect(f.owner.close).toHaveBeenCalledOnce();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves recovery bytes when shutdown races the awaited durable write', async () => {
    const f = await fixture();
    const preparedOwner = new PreparedProfileRestoreOwner();
    preparedOwner.set({ operationId, targetDisposition: 'replaceActiveProfile', summary: {
      appVersion: '0.1.0-alpha.1', compatibilityStatus: 'compatible',
      createdAt: '2026-08-04T00:00:00.000Z', databaseHealth: 'healthy',
      documentCount: 0, formatVersion: 1, profileMatchStatus: 'same', totalBusinessByteSize: 1,
    } });
    const pending = deferred<void>();
    const entered = deferred<void>();
    const stopBusinessRuntime = vi.fn();
    const transaction = {
      prepare: vi.fn(async () => { entered.resolve(); await pending.promise; }),
      readPreparation: vi.fn(async () => 'prepared' as const),
      readOwnForwardProgress: vi.fn(),
      advanceToValidation: vi.fn(), rollback: vi.fn(),
    };
    const service = new ProfileRestoreActivationService({
      profileSnapshotClient: f.client, stagingService: { claimPreparedRestore: id => preparedOwner.claim(id) },
      relaunchApplication: vi.fn(), transaction, stopBusinessRuntime,
    });
    const outcome = failure(service.activate(operationId));
    await entered.promise;
    await f.client.shutdown();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    pending.resolve();
    expect(await outcome).toMatchObject({ code: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
    expect(stopBusinessRuntime).not.toHaveBeenCalled();
    expect(transaction.advanceToValidation).not.toHaveBeenCalled();
    expect(f.restoreFence.invalidateRestoreMaintenance).toHaveBeenCalledWith(operationId);
    expect(() => preparedOwner.claim(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    expect(f.owner.close).toHaveBeenCalledOnce();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains recovery bytes and first release failure when native shutdown is unverified', async () => {
    const f = await fixture();
    await f.client.prepareProfileRestoreSnapshot(operationId);
    f.client.retainProfileSnapshotForRecovery(operationId);
    const first = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    f.owner.close.mockRejectedValueOnce(first);
    expect(await failure(f.client.shutdown())).toBe(first);
    expect(f.owner.invalidate).toHaveBeenCalled();
    await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
  });

  it.each(['endRejected', 'endRacesShutdown'] as const)(
    'keeps both recovery owners when notPrepared cancellation is %s', async variant => {
      const f = await fixture();
      const preparedOwner = new PreparedProfileRestoreOwner();
      preparedOwner.set({ operationId, targetDisposition: 'replaceActiveProfile', summary: {
        appVersion: '0.1.0-alpha.1', compatibilityStatus: 'compatible',
        createdAt: '2026-08-04T00:00:00.000Z', databaseHealth: 'healthy',
        documentCount: 0, formatVersion: 1, profileMatchStatus: 'same', totalBusinessByteSize: 1,
      } });
      const first = new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
      const endFailure = new Error('PROFILE_PROTECTION_OPERATION_INVALID');
      const entered = deferred<void>();
      const pending = deferred<void>();
      f.restoreFence.endRestoreMaintenance.mockImplementationOnce(async () => {
        entered.resolve(); await pending.promise;
        if (variant === 'endRejected') throw endFailure;
        return 'normal';
      });
      const stopBusinessRuntime = vi.fn();
      const service = new ProfileRestoreActivationService({
        profileSnapshotClient: f.client, stagingService: { claimPreparedRestore: id => preparedOwner.claim(id) },
        relaunchApplication: vi.fn(), stopBusinessRuntime,
        transaction: { prepare: vi.fn(async () => { throw first; }),
          readPreparation: vi.fn(async () => 'notPrepared' as const), readOwnForwardProgress: vi.fn(), advanceToValidation: vi.fn(), rollback: vi.fn() },
      });
      const outcome = failure(service.activate(operationId));
      await entered.promise;
      const shutdown = variant === 'endRacesShutdown'
        ? f.client.shutdown().catch((error: unknown) => error) : undefined;
      pending.resolve();
      const error = await outcome as Error;
      expect(error).toMatchObject({ code: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
      expect((error.cause as AggregateError).errors[0]).toBe(first);
      expect(() => preparedOwner.claim(operationId)).toThrow('PROFILE_RESTORE_BUSY');
      expect(stopBusinessRuntime).not.toHaveBeenCalled();
      const shutdownFailure = await (shutdown ?? f.client.shutdown().catch((error: unknown) => error));
      expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
      expect(shutdownFailure).toBeInstanceOf(Error);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('allows cancellation without deletion only with fresh restore and native ownership', async () => {
    const f = await fixture();
    await f.client.prepareProfileRestoreSnapshot(operationId);
    f.client.retainProfileSnapshotForRecovery(operationId);
    await f.client.cancelProfileRestoreRetention(operationId);
    expect(f.restoreFence.assertRestoreMaintenance).toHaveBeenCalledTimes(2);
    expect(f.owner.assertMainOwned).toHaveBeenCalledTimes(3);
    expect(f.restoreFence.endRestoreMaintenance).toHaveBeenCalledWith(operationId);
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    await f.client.removeProfileSnapshot(operationId);
    await expect(fileSystem.lstat(f.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['fence', 'owner', 'generation', 'shutdown'] as const)(
    'preserves retained recovery evidence when cancellation loses %s authority', async variant => {
      const f = await fixture();
      await f.client.prepareProfileRestoreSnapshot(operationId);
      f.client.retainProfileSnapshotForRecovery(operationId);
      const pending = deferred<void>();
      const entered = deferred<void>();
      let ownerRevoked = false;
      f.owner.assertMainOwned.mockImplementationOnce(async () => {
        entered.resolve(); await pending.promise;
        if (ownerRevoked) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      });
      const outcome = failure(f.client.cancelProfileRestoreRetention(operationId));
      await entered.promise;
      if (variant === 'fence') f.restoreFence.assertRestoreMaintenance.mockRejectedValueOnce(new Error('PROFILE_PROTECTION_OPERATION_INVALID'));
      if (variant === 'generation') f.authority.mockImplementation(() => { throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); });
      if (variant === 'owner') ownerRevoked = true;
      if (variant === 'shutdown') f.client.closeAdmission();
      pending.resolve();
      await outcome;
      await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      await expect(f.client.shutdown()).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      expect(f.owner.close).not.toHaveBeenCalled();
      expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not allow retention after source removal has started', async () => {
    const f = await fixture();
    await f.client.prepareProfileRestoreSnapshot(operationId);
    const pending = deferred<void>();
    const entered = deferred<void>();
    f.owner.assertMainOwned.mockImplementationOnce(async () => { entered.resolve(); await pending.promise; });
    const removal = f.client.removeProfileSnapshot(operationId);
    await entered.promise;
    expect(() => f.client.retainProfileSnapshotForRecovery(operationId)).toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    pending.resolve(); await removal;
  });

  it('drains reservation-only release during shutdown without removing retained bytes', async () => {
    const f = await fixture();
    await f.client.prepareProfileRestoreSnapshot(operationId);
    f.client.retainProfileSnapshotForRecovery(operationId);
    const pending = deferred<void>();
    const entered = deferred<void>();
    f.owner.close.mockImplementationOnce(async () => { entered.resolve(); await pending.promise; });
    const release = f.client.releaseProfileSnapshot(operationId);
    await entered.promise;
    const shutdown = f.client.shutdown();
    pending.resolve();
    await release; await shutdown;
    expect(f.owner.close).toHaveBeenCalledOnce();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the reservation until separately authorized source use and removal', async () => {
    const f = await fixture();
    const validation = await f.client.validateProfileSnapshot(operationId);
    expect(validation).toEqual(result().validation);
    expect(JSON.stringify(validation)).not.toContain('sha256');
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    const use = vi.fn(async (receipt: ProfileInspectionReceipt) => receipt.database.sha256);
    expect(await f.client.withProfileSnapshot(operationId, use)).toBe(result().receipt.database.sha256);
    expect(f.owner.assertMainOwned).toHaveBeenCalledTimes(2);
    await f.client.removeProfileSnapshot(operationId);
    expect(f.owner.close).toHaveBeenCalledOnce();
    await expect(fileSystem.lstat(f.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.client.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not clean or release a source still used by the owning consumer', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    const pending = deferred<void>();
    const entered = deferred<void>();
    const task = f.client.withProfileSnapshot(operationId, async () => { entered.resolve(); await pending.promise; });
    await entered.promise;
    await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    await expect(f.client.releaseProfileSnapshot(operationId)).rejects.toThrow('PROFILE_PROTECTION_OPERATION_BUSY');
    expect(f.owner.close).not.toHaveBeenCalled();
    pending.resolve(); await task;
    await f.client.removeProfileSnapshot(operationId);
  });

  it.each(['shutdown', 'brokerLoss'] as const)('never starts source use after %s during native ownership verification', async variant => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    const pending = deferred<void>();
    f.owner.assertMainOwned.mockImplementationOnce(async () => { await pending.promise; });
    const use = vi.fn(async () => undefined);
    const outcome = failure(f.client.withProfileSnapshot(operationId, use));
    await flush();
    if (variant === 'shutdown') f.client.closeAdmission();
    else f.authority.mockImplementation(() => { throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); });
    pending.resolve();
    await outcome;
    expect(use).not.toHaveBeenCalled();
    await f.client.removeProfileSnapshot(operationId);
  });

  it('allows an independent self-inspection while retaining a previously inspected source', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    await f.client.withProfileSnapshot(operationId, async () => {
      await f.client.validateProfileSnapshot(otherOperationId);
      expect(f.owner.close).not.toHaveBeenCalled();
      await f.client.removeProfileSnapshot(otherOperationId);
    });
    expect(f.acquisition).toHaveBeenCalledTimes(2);
    await f.client.removeProfileSnapshot(operationId);
  });

  it('rejects another simultaneous inspector before acquiring a second root', async () => {
    const f = await fixture();
    const pending = deferred<ReturnType<typeof result>>();
    boundary.run.mockReturnValueOnce(pending.promise);
    const task = f.client.validateProfileSnapshot(operationId);
    await flush();
    expect(() => f.client.validateProfileSnapshot(otherOperationId)).toThrow('PROFILE_PROTECTION_OPERATION_BUSY');
    expect(f.acquisition).toHaveBeenCalledOnce();
    pending.resolve(result()); await task;
    await f.client.removeProfileSnapshot(operationId);
  });

  it('does not renew the original work budget after root acquisition', async () => {
    const f = await fixture();
    const pending = deferred<OwnedProfileBackupInspectionReservation>();
    f.acquisition.mockReturnValueOnce(pending.promise);
    const task = f.client.validateProfileSnapshot(operationId);
    await flush(); await vi.advanceTimersByTimeAsync(12_000);
    pending.resolve(f.owner); await task;
    expect(boundary.run.mock.calls[0]![0].deadline).toBe(profileInspectionWorkMilliseconds);
    await f.client.removeProfileSnapshot(operationId);
  });

  it('invalidates late acquisition without granting work, cleanup or root reuse', async () => {
    const f = await fixture();
    const pending = deferred<OwnedProfileBackupInspectionReservation>();
    f.acquisition.mockReturnValueOnce(pending.promise);
    const failed = failure(f.client.validateProfileSnapshot(operationId));
    await flush(); await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(await failed).toMatchObject({ message: 'PROFILE_INSPECTION_TIMEOUT' });
    pending.resolve(f.owner); await flush();
    expect(f.owner.invalidate).toHaveBeenCalledOnce();
    expect(boundary.run).not.toHaveBeenCalled();
    await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    await expect(f.client.shutdown()).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
  });

  it('clears its timer when capturing the private backend generation fails', async () => {
    const f = await fixture();
    const first = new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    f.captureAuthority.mockImplementationOnce(() => { throw first; });
    expect(await failure(f.client.validateProfileSnapshot(operationId))).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.acquisition).not.toHaveBeenCalled();
    expect(boundary.run).not.toHaveBeenCalled();
  });

  it('rejects a stale generation result even when actual reader exit is proven', async () => {
    const f = await fixture();
    boundary.run.mockImplementationOnce(async () => {
      f.authority.mockImplementation(() => { throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); });
      return result();
    });
    await expect(f.client.validateProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    await expect(f.client.withProfileSnapshot(operationId, async () => undefined)).rejects.toThrow();
    await f.client.removeProfileSnapshot(operationId);
    expect(f.owner.close).toHaveBeenCalledOnce();
  });

  it('does not grant a previous receipt after a changed-source reinspection fails', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    boundary.run.mockResolvedValueOnce(result({ ...result().receipt,
      database: { ...result().receipt.database, sha256: 'e'.repeat(64) } }));
    await expect(f.client.validateProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    await expect(f.client.withProfileSnapshot(operationId, async () => undefined)).rejects.toThrow();
    await f.client.removeProfileSnapshot(operationId);
  });

  it.each([
    { processAbsent: false, reservationReclaimed: false, forced: true },
    { processAbsent: true, reservationReclaimed: false, forced: false },
  ])('preserves the first failure and source after unverified cleanup: %j', async cleanup => {
    const f = await fixture();
    const first = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED', cleanup);
    boundary.run.mockRejectedValueOnce(first);
    expect(await failure(f.client.validateProfileSnapshot(operationId))).toBe(first);
    await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    await expect(f.client.shutdown()).rejects.toThrow();
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
  });

  it('permits guarded cleanup after a failed inspector whose exit and reclaim are proven', async () => {
    const f = await fixture();
    const first = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED', {
      processAbsent: true, reservationReclaimed: true, forced: false,
    });
    boundary.run.mockRejectedValueOnce(first);
    expect(await failure(f.client.validateProfileSnapshot(operationId))).toBe(first);
    await f.client.removeProfileSnapshot(operationId);
    await f.client.shutdown();
    expect(f.owner.close).toHaveBeenCalledOnce();
  });

  it('does not treat a missing create-snapshot reply as writer-exit proof', async () => {
    const f = await fixture();
    const first = new Error('PROFILE_SNAPSHOT_BROKER_TIMEOUT');
    f.createSnapshot.mockRejectedValueOnce(first);
    expect(await failure(f.client.createProfileSnapshot(operationId, 'exactCurrentManifest'))).toBe(first);
    expect(() => f.client.validateProfileSnapshot(otherOperationId)).toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(f.acquisition).not.toHaveBeenCalled();
    await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(boundary.run).not.toHaveBeenCalled();
    expect(f.owner.close).not.toHaveBeenCalled();
  });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix'] as const)
    ('retains the %s source policy through inspection and reinspection', async migrationPolicy => {
      const f = await fixture();
      const expected = result({ ...result().receipt, migrationPolicy });
      boundary.run.mockResolvedValue(expected);
      await f.client.createProfileSnapshot(operationId, migrationPolicy);
      await f.client.validateProfileSnapshot(operationId);
      await f.client.validateProfileSnapshot(operationId);
      expect(boundary.run).toHaveBeenCalledTimes(2);
      for (const [request] of boundary.run.mock.calls) expect(request.migrationPolicy).toBe(migrationPolicy);
      await f.client.withProfileSnapshot(operationId, async receipt => {
        expect(receipt.migrationPolicy).toBe(migrationPolicy);
      });
      await f.client.removeProfileSnapshot(operationId);
      expect(f.owner.close).toHaveBeenCalledOnce();
    });

  it('keeps admitted restore inspection separate from the historical snapshot broker policy', async () => {
    const f = await fixture();
    await f.client.createRestoredProfileSnapshot(operationId);
    expect(f.restoreFence.assertRestoreMaintenance).toHaveBeenCalledWith(operationId);
    expect(f.createSnapshot).toHaveBeenCalledWith(operationId, 'compatibleHistoricalPrefix');
    await f.client.validateProfileSnapshot(operationId);
    await f.client.validateProfileSnapshot(operationId);
    for (const [request] of boundary.run.mock.calls) expect(request.migrationPolicy).toBe('restoreCompatible');
    await f.client.withProfileSnapshot(operationId, async receipt => {
      expect(receipt.migrationPolicy).toBe('restoreCompatible');
    });
    await f.client.removeProfileSnapshot(operationId);
    expect(f.owner.close).toHaveBeenCalledOnce();
  });

  it.each(['fence', 'channel', 'admission'] as const)
    ('grants no restore snapshot after the awaited %s guard fails', async guard => {
      const f = await fixture();
      f.restoreFence.assertRestoreMaintenance.mockImplementationOnce(async () => {
        if (guard === 'fence') throw new Error('synthetic expired fence');
        if (guard === 'channel') f.authority.mockImplementation(() => { throw new Error('synthetic expired channel'); });
        if (guard === 'admission') f.client.closeAdmission();
        return 'busy';
      });
      await expect(f.client.createRestoredProfileSnapshot(operationId)).rejects.toThrow();
      expect(f.createSnapshot).not.toHaveBeenCalled();
      expect(f.acquisition).not.toHaveBeenCalled();
      expect(boundary.run).not.toHaveBeenCalled();
    });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix'] as const)
    ('grants no source use for a weaker receipt after %s creation', async migrationPolicy => {
      const f = await fixture();
      await f.client.createProfileSnapshot(operationId, migrationPolicy);
      await expect(f.client.validateProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
      await expect(f.client.withProfileSnapshot(operationId, async () => undefined)).rejects.toThrow('PROFILE_PROTECTION_OPERATION_BUSY');
      expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
      await f.client.removeProfileSnapshot(operationId);
    });

  it('keeps the imported restore policy separate from a concurrently retained source policy', async () => {
    const f = await fixture();
    await f.client.createProfileSnapshot(operationId, 'exactCurrentManifest');
    boundary.run.mockResolvedValueOnce(result({ ...result().receipt, migrationPolicy: 'exactCurrentManifest' }));
    await f.client.validateProfileSnapshot(operationId);
    await f.client.withProfileSnapshot(operationId, async () => {
      await f.client.validateProfileSnapshot(otherOperationId);
      expect(boundary.run.mock.calls[1]?.[0]).toHaveProperty('migrationPolicy', 'restoreCompatible');
      await f.client.removeProfileSnapshot(otherOperationId);
    });
    await f.client.removeProfileSnapshot(operationId);
  });

  it.each(['restoreCompatible', undefined, 'skipSchema'])('rejects an invalid source policy before broker work: %j', async policy => {
    const f = await fixture();
    await expect(f.client.createProfileSnapshot(operationId, policy as 'exactCurrentManifest'))
      .rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(f.createSnapshot).not.toHaveBeenCalled();
    expect(f.acquisition).not.toHaveBeenCalled();
  });

  it('does not derive removal authority from an unknown existing root', async () => {
    const f = await fixture();
    await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    await expect(f.client.shutdown()).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
  });

  it('does not remove source files after a fresh native ownership fence fails', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    f.owner.assertMainOwned.mockRejectedValueOnce(new Error('native identity changed'));
    await expect(f.client.removeProfileSnapshot(operationId)).rejects.toThrow('native identity changed');
    expect(f.owner.invalidate).toHaveBeenCalled();
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
  });

  it('drains the whole owning operation, not just its completed inspector', async () => {
    const f = await fixture();
    const pending = deferred<void>();
    const entered = deferred<void>();
    const task = f.client.withInspectionOperation(async () => {
      await f.client.validateProfileSnapshot(operationId);
      await f.client.withProfileSnapshot(operationId, async () => { entered.resolve(); await pending.promise; });
      await f.client.removeProfileSnapshot(operationId);
    });
    await entered.promise;
    let closed = false;
    const shutdown = f.client.shutdown().then(() => { closed = true; });
    await flush(); expect(closed).toBe(false);
    await expect(f.client.withInspectionOperation(async () => undefined)).rejects.toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    pending.resolve(); await task; await shutdown;
    expect(f.owner.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains source evidence instead of waiting without a bound for a consumer', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    const pending = deferred<void>();
    const entered = deferred<void>();
    const task = failure(f.client.withProfileSnapshot(operationId, async () => { entered.resolve(); await pending.promise; }));
    await entered.promise;
    const stopped = failure(f.client.shutdown());
    await flush(); await vi.advanceTimersByTimeAsync(2 * profileInspectionShutdownMilliseconds);
    expect(await stopped).toMatchObject({ message: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(f.owner.close).not.toHaveBeenCalled();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    pending.resolve(); await task;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes admission immediately and shares the existing shutdown result', async () => {
    const f = await fixture();
    const first = f.client.shutdown();
    expect(f.client.shutdown()).toBe(first);
    expect(() => f.client.validateProfileSnapshot(operationId)).toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    await first;
    expect(f.acquisition).not.toHaveBeenCalled();
  });

  it('allows preRestore inspection after write quiescence and closes admission only at final disposal', async () => {
    const f = await fixture();
    const requestQuiescence = new BackendRequestQuiescence();
    const stopScheduler = vi.fn(async () => undefined);
    const stopBackend = vi.fn(async () => 'exited' as const);
    const closeBrokers = vi.fn(async () => undefined);
    const markCleanShutdown = vi.fn(async () => undefined);
    const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(workspaceId, requestQuiescence, {
      closeBrokers, markCleanShutdown, stopBackend, stopBackendForUpdate: vi.fn(),
      disposeCapabilities: () => f.client.shutdown(), stopRecoveryPointScheduler: stopScheduler,
    }, new DeferredWorkspaceRuntimeRelaunch(vi.fn()));
    await lifecycle.quiesceWrites(workspaceId);
    expect(lifecycle.readState()).toBe('quiesced');
    expect(stopScheduler).toHaveBeenCalledOnce();
    expect(requestQuiescence.begin('POST')).toBeUndefined();
    await f.client.withInspectionOperation(async () => {
      await f.client.validateProfileSnapshot(operationId);
      await f.client.withProfileSnapshot(operationId, async () => undefined);
      await f.client.removeProfileSnapshot(operationId);
    });
    expect(boundary.run).toHaveBeenCalledOnce();
    expect(f.owner.close).toHaveBeenCalledOnce();
    expect(stopBackend).not.toHaveBeenCalled();
    await lifecycle.stopAndProveHandlesClosed(workspaceId);
    expect(() => f.client.validateProfileSnapshot(otherOperationId)).toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    expect(stopBackend).toHaveBeenCalledOnce();
    expect(closeBrokers).toHaveBeenCalledOnce();
    expect(markCleanShutdown).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prevents a clean lifecycle marker while independently continuing backend and broker closure', async () => {
    const f = await fixture();
    boundary.run.mockRejectedValueOnce(new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED', {
      processAbsent: true, reservationReclaimed: false, forced: false,
    }));
    await failure(f.client.validateProfileSnapshot(operationId));
    const markCleanShutdown = vi.fn(async () => undefined);
    const stopBackend = vi.fn(async () => 'exited' as const);
    const closeBrokers = vi.fn(async () => undefined);
    const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
    const lifecycle = new MainOwnedActiveWorkspaceLifecycle(workspaceId, new BackendRequestQuiescence(), {
      closeBrokers, markCleanShutdown, stopBackend,
      disposeCapabilities: () => f.client.shutdown(),
      stopBackendForUpdate: vi.fn(),
      async stopRecoveryPointScheduler() {},
    }, new DeferredWorkspaceRuntimeRelaunch(vi.fn()));
    await lifecycle.quiesceWrites(workspaceId);
    await expect(lifecycle.stopAndProveHandlesClosed(workspaceId)).rejects.toMatchObject({
      firstFailure: { phase: 'capabilities', reason: 'operationFailed' },
    });
    expect(stopBackend).toHaveBeenCalledOnce();
    expect(closeBrokers).toHaveBeenCalledOnce();
    expect(markCleanShutdown).not.toHaveBeenCalled();
    expect(lifecycle.readState()).toBe('stopFailed');
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
  });

  it('retains a proved source across the backend handoff without admitting new work', async () => {
    const f = await fixture();
    await f.client.validateProfileSnapshot(operationId);
    await f.client.withProfileSnapshot(operationId, async () => {
      await f.client.stopInspectionWork();
      expect(f.owner.close).not.toHaveBeenCalled();
      expect(() => f.client.validateProfileSnapshot(otherOperationId)).toThrow('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    });
    await f.client.releaseProfileSnapshot(operationId);
    expect(f.owner.close).toHaveBeenCalledOnce();
    expect(await fileSystem.readFile(f.source, 'utf8')).toBe('synthetic source');
    await f.client.shutdown();
  });
});

async function fixture() {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-owned-inspection-client-'));
  roots.push(root);
  const stagingRoot = join(root, 'staging');
  for (const id of [operationId, otherOperationId]) {
    await fileSystem.mkdir(join(stagingRoot, id), { recursive: true });
    await fileSystem.writeFile(join(stagingRoot, id, 'profile.sqlite'), 'synthetic source');
  }
  const owner = {
    assertMainOwned: vi.fn(async () => undefined),
    bind: vi.fn<OwnedProfileBackupInspectionReservation['bind']>(),
    invalidate: vi.fn(), close: vi.fn(async () => undefined),
  };
  const otherOwner = { ...owner, assertMainOwned: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined), invalidate: vi.fn() };
  const acquisition = vi.fn(async (input: { operationRoot: string }): Promise<OwnedProfileBackupInspectionReservation> =>
    input.operationRoot === join(stagingRoot, operationId) ? owner : otherOwner);
  const authority = vi.fn();
  const captureAuthority = vi.fn(() => authority);
  const createSnapshot = vi.fn(async (_operationId?: string) => ({ type: 'profileSnapshot' as const,
    database: { databaseByteSize: 10, logicalPath: 'profile.sqlite' as const, sha256: 'd'.repeat(64), totalPages: 1 },
    artifactCatalog: { artifactCount: 0, artifactTotalByteSize: 0, catalogByteSize: 2,
      logicalPath: 'snapshot-catalog-v1.json' as const, sha256: 'e'.repeat(64) } }));
  const restoreFence = {
    beginRestoreMaintenance: vi.fn(async () => 'busy' as const),
    assertRestoreMaintenance: vi.fn(async () => 'busy' as const),
    endRestoreMaintenance: vi.fn(async () => 'normal' as const),
    invalidateRestoreMaintenance: vi.fn(async () => 'busy' as const),
  };
  const client = new ProfileSnapshotInspectionClient({
    stagingRoot, runnerPath: join(root, 'runner.js'),
    deployment: { backendRoot: join(root, 'backend'), migrationsDirectory: join(root, 'migrations'),
      nativeResourceRoot: join(root, 'native') },
    assertMainInstance: vi.fn(), acquireReservation: acquisition,
    broker: { ...restoreFence, captureInspectionAuthority: captureAuthority, createProfileSnapshot: createSnapshot,
      readProfileInspectionContext: vi.fn(), beginMaintenance: vi.fn(),
      endMaintenance: vi.fn(), assertUpdateMaintenance: vi.fn() },
  });
  return { client, owner, otherOwner, acquisition, authority, captureAuthority, createSnapshot, restoreFence,
    stagingRoot, operationRoot: join(stagingRoot, operationId), source: join(stagingRoot, operationId, 'profile.sqlite') };
}

function result(receipt: ProfileInspectionReceipt = {
  artifactIdentity: 'e'.repeat(64),
  artifactCount: 0, artifactTotalByteSize: 0, databaseHealth: 'healthy',
  migrationChainIdentity: 'b'.repeat(64), profileId: 'a'.repeat(64), migrationPolicy: 'restoreCompatible',
  database: { byteSize: 10, sha256: 'c'.repeat(64) }, artifactCatalog: { byteSize: 2, sha256: 'd'.repeat(64) },
}) {
  return { receipt, validation: { type: 'profileSnapshotValidation' as const, activeProfileIsEmpty: false,
    artifactCount: receipt.artifactCount, artifactTotalByteSize: receipt.artifactTotalByteSize,
    databaseHealth: receipt.databaseHealth, migrationChainIdentity: receipt.migrationChainIdentity,
    profileId: receipt.profileId, profileMatchesActive: true } };
}

function restoreJournal(phase: 'validationStarting') {
  return { formatVersion: 1 as const, hadActiveDatabase: true, hadActiveDocuments: true,
    operationId, phase, revision: 1 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(fulfill => { resolve = fulfill; });
  return { promise, resolve };
}
async function failure(task: Promise<unknown>): Promise<unknown> {
  return task.then(() => { throw new Error('EXPECTED_FAILURE'); }, error => error);
}
async function flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
