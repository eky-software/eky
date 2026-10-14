import { randomUUID } from 'node:crypto';

import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import {
  profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
  type ProfileInspectionReceipt,
} from '../runtime/profileInspectionMessages.js';
import { waitForInspectionPhase } from './inspectOwnedEncryptedProfileBackup.js';
import type { ProfileSnapshotInspectionClient } from './profileSnapshotInspectionClient.js';

export type OwnedActiveProfileValidation = Pick<ProfileInspectionReceipt,
  'artifactCount' | 'artifactTotalByteSize' | 'databaseHealth' | 'migrationChainIdentity' | 'profileId'>;

/** Startup validation only; metadata grants no mutation, and failure requires runtime shutdown. */
export async function validateOwnedActiveProfile(input: {
  readonly snapshotClient: Pick<ProfileSnapshotInspectionClient,
    'withInspectionOperation' | 'beginRestoreMaintenance' | 'assertRestoreMaintenance' |
    'endRestoreMaintenance' | 'invalidateRestoreMaintenance' | 'createProfileSnapshot' |
    'createRestoredProfileSnapshot' | 'validateProfileSnapshot' | 'withProfileSnapshot' |
    'removeProfileSnapshot'>;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'acquire' | 'captureCurrentOwner'>;
  /** Main retains this exact restore owner through validation failure and stopped-backend rollback. */
  readonly assertBorrowedRestoreOwner?: () => void;
  readonly assertAuthority: () => void;
  readonly assertLineage: (profileId: string) => void;
  readonly beforeUpdateRollbackMigrations?: {
    readonly expectedMigrationChainIdentity: string;
    assertCurrent(): Promise<void>;
  };
}): Promise<Readonly<OwnedActiveProfileValidation>> {
  const assertBorrowedRestoreOwner = input.assertBorrowedRestoreOwner;
  const rollback = input.beforeUpdateRollbackMigrations === undefined ? undefined
    : Object.freeze({ ...input.beforeUpdateRollbackMigrations });
  if (rollback !== undefined && !/^[a-f0-9]{64}$/.test(rollback.expectedMigrationChainIdentity)) {
    throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
  }
  return input.snapshotClient.withInspectionOperation(async () => {
    const operationId = randomUUID();
    const policy = rollback === undefined ? 'exactCurrentManifest' : 'restoreCompatible';
    const cancellation = new AbortController();
    const deadline = performance.now() + profileInspectionWorkMilliseconds;
    const timer = setTimeout(() => cancellation.abort(), profileInspectionWorkMilliseconds);
    const pendingReads = new Set<Promise<unknown>>();
    const failures: unknown[] = [];
    let lease: Awaited<ReturnType<typeof input.maintenanceLease.acquire>> | undefined;
    let assertLease = () => {};
    let fenceAttempted = false;
    let validation: Readonly<OwnedActiveProfileValidation> | undefined;
    const assertCurrent = () => {
      input.assertAuthority();
      assertLease();
      if (cancellation.signal.aborted || performance.now() >= deadline) {
        throw new Error('PROFILE_INSPECTION_TIMEOUT');
      }
    };
    const read = async <T>(task: () => Promise<T>): Promise<T> => {
      assertCurrent();
      const pending = Promise.resolve().then(async () => {
        assertCurrent();
        await rollback?.assertCurrent();
        assertCurrent();
        const value = await task();
        assertCurrent();
        await rollback?.assertCurrent();
        assertCurrent();
        return value;
      });
      pendingReads.add(pending);
      void pending.finally(() => pendingReads.delete(pending)).catch(() => {});
      return waitForInspectionPhase(pending, cancellation.signal);
    };
    try {
      if (assertBorrowedRestoreOwner === undefined) {
        await read(async () => { lease = await input.maintenanceLease.acquire('restore'); });
      } else { assertBorrowedRestoreOwner(); }
      const assertCapturedOwner = input.maintenanceLease.captureCurrentOwner(['restore']);
      assertLease = () => { assertBorrowedRestoreOwner?.(); assertCapturedOwner(); };
      assertCurrent();
      fenceAttempted = true;
      await read(() => input.snapshotClient.beginRestoreMaintenance(operationId));
      await read(() => rollback === undefined
        ? input.snapshotClient.createProfileSnapshot(operationId, 'exactCurrentManifest')
        : input.snapshotClient.createRestoredProfileSnapshot(operationId));
      const inspected = await read(() => input.snapshotClient.validateProfileSnapshot(operationId));
      if (!inspected.profileMatchesActive || inspected.databaseHealth !== 'healthy') throw invalid();
      await read(() => input.snapshotClient.withProfileSnapshot(operationId, async (receipt, assertSnapshotCurrent) => {
        if (receipt.migrationPolicy !== policy || receipt.profileId !== inspected.profileId ||
            receipt.migrationChainIdentity !== inspected.migrationChainIdentity ||
            receipt.artifactCount !== inspected.artifactCount ||
            receipt.artifactTotalByteSize !== inspected.artifactTotalByteSize ||
            receipt.databaseHealth !== inspected.databaseHealth ||
            (rollback !== undefined && receipt.migrationChainIdentity !== rollback.expectedMigrationChainIdentity)) throw invalid();
        input.assertLineage(receipt.profileId);
        await read(() => input.snapshotClient.assertRestoreMaintenance(operationId));
        await read(assertSnapshotCurrent);
        input.assertLineage(receipt.profileId);
        validation = Object.freeze({ artifactCount: receipt.artifactCount,
          artifactTotalByteSize: receipt.artifactTotalByteSize, databaseHealth: receipt.databaseHealth,
          migrationChainIdentity: receipt.migrationChainIdentity, profileId: receipt.profileId });
      }));
      assertCurrent();
    } catch (error) { failures.push(error); }
    finally {
      clearTimeout(timer);
      cancellation.abort();
      const cleanup = new AbortController();
      const cleanupDeadline = performance.now() + 2 * profileInspectionShutdownMilliseconds;
      const cleanupTimer = setTimeout(() => cleanup.abort(), 2 * profileInspectionShutdownMilliseconds);
      const pendingCleanup = new Set<Promise<unknown>>();
      const trackCleanup = (pending: Promise<unknown>) => {
        pendingCleanup.add(pending);
        void pending.finally(() => pendingCleanup.delete(pending)).catch(() => {});
        return pending;
      };
      const assertCleanupTime = () => {
        if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) {
          throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
        }
      };
      const close = async (task: () => Promise<unknown>) => {
        try {
          return await waitForInspectionPhase(trackCleanup(
            Promise.resolve().then(() => { assertCleanupTime(); return task(); })
              .then(value => { assertCleanupTime(); return value; }),
          ), cleanup.signal);
        } catch (error) {
          if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) {
            throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED', { cause: error });
          }
          throw error;
        }
      };
      let invalidation: Promise<unknown> | undefined;
      const invalidate = () => {
        if (!fenceAttempted || invalidation !== undefined) return;
        try { invalidation = trackCleanup(input.snapshotClient.invalidateRestoreMaintenance(operationId)); }
        catch (error) { invalidation = Promise.reject(error); }
        void invalidation.catch(() => {});
      };
      if (failures.length !== 0) invalidate();
      let settled = pendingReads.size === 0;
      if (!settled) {
        try { await close(() => Promise.allSettled([...pendingReads])); settled = pendingReads.size === 0; }
        catch (error) { failures.push(error); }
      }
      if (failures.length === 0) {
        try {
          input.assertAuthority(); assertLease();
          await close(() => rollback?.assertCurrent() ?? Promise.resolve());
          input.assertAuthority(); assertLease();
          await close(() => input.snapshotClient.removeProfileSnapshot(operationId));
          input.assertAuthority(); assertLease();
          await close(() => rollback?.assertCurrent() ?? Promise.resolve());
          input.assertAuthority(); assertLease();
          input.assertLineage(validation!.profileId);
          // Releasing the fence is terminal; do not start another asynchronous C read afterward.
          await close(() => input.snapshotClient.endRestoreMaintenance(operationId));
          input.assertAuthority(); assertLease();
          input.assertLineage(validation!.profileId);
        } catch (error) { failures.push(error); invalidate(); }
      }
      if (invalidation !== undefined) {
        try { await close(() => invalidation!); } catch (error) { failures.push(error); }
      }
      // The client keeps failed snapshots tracked. Uncertain work or fence release requires restart.
      if (failures.length === 0 && settled && pendingCleanup.size === 0) {
        try { await lease?.release(); } catch (error) { failures.push(error); }
      }
      clearTimeout(cleanupTimer);
      cleanup.abort();
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length !== 0) throw new AggregateError(failures, 'ACTIVE_PROFILE_VALIDATION_FAILED');
    if (validation === undefined) throw invalid();
    return validation;
  });
}

function invalid(): Error { return new Error('ACTIVE_PROFILE_VALIDATION_FAILED'); }
