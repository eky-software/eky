import { randomUUID } from 'node:crypto';

import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import {
  profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
  type ProfileInspectionReceipt,
} from '../runtime/profileInspectionMessages.js';
import { waitForInspectionPhase } from './inspectOwnedEncryptedProfileBackup.js';
import type { ProfileSnapshotInspectionClient } from './profileSnapshotInspectionClient.js';
import { assertSynchronousProfileRestoreMutationAuthority } from './restore/profileRestoreMutationAuthority.js';

export type OwnedActiveProfileValidation = Pick<ProfileInspectionReceipt,
  'artifactCount' | 'artifactTotalByteSize' | 'databaseHealth' | 'migrationChainIdentity' | 'profileId'>;

export interface OwnedActiveProfileContinuation {
  readonly validation: Readonly<OwnedActiveProfileValidation>;
  assertCurrent(): Promise<void>;
  assertMutationCurrent(): void;
  reportFirstFailure(cause: unknown): void;
}

/** Startup validation; an optional continuation borrows the same live snapshot, never metadata alone. */
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
  readonly useValidatedProfile?: (authority: OwnedActiveProfileContinuation) => Promise<void>;
  readonly beforeUpdateRollbackMigrations?: {
    readonly expectedMigrationChainIdentity: string;
    assertCurrent(): Promise<void>;
  };
}): Promise<Readonly<OwnedActiveProfileValidation>> {
  if (input.useValidatedProfile !== undefined && typeof input.useValidatedProfile !== 'function') throw invalid();
  const useValidatedProfile = input.useValidatedProfile?.bind(input);
  const continuationOwner = useValidatedProfile === undefined ? undefined : input.assertAuthority.bind(input);
  const continuationLineage = useValidatedProfile === undefined ? undefined : input.assertLineage.bind(input);
  const assertRuntimeOwner = () => {
    if (continuationOwner === undefined) input.assertAuthority();
    else assertSynchronousProfileRestoreMutationAuthority(continuationOwner);
  };
  const assertLineage = (profileId: string) => {
    if (continuationLineage === undefined) input.assertLineage(profileId);
    else assertSynchronousProfileRestoreMutationAuthority(() => continuationLineage(profileId));
  };
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
    let closeContinuation: (() => void) | undefined;
    let continuationStarted = false;
    const timer = setTimeout(() => { closeContinuation?.(); cancellation.abort(); }, profileInspectionWorkMilliseconds);
    const pendingReads = new Set<Promise<unknown>>();
    const failures: unknown[] = [];
    let lease: Awaited<ReturnType<typeof input.maintenanceLease.acquire>> | undefined;
    let assertLease = () => {};
    let fenceAttempted = false;
    let validation: Readonly<OwnedActiveProfileValidation> | undefined;
    let continuationFailure: { readonly cause: unknown } | undefined;
    const assertCurrent = () => {
      assertRuntimeOwner();
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
      } else if (useValidatedProfile === undefined) { assertBorrowedRestoreOwner(); }
      else assertSynchronousProfileRestoreMutationAuthority(assertBorrowedRestoreOwner);
      const assertCapturedOwner = input.maintenanceLease.captureCurrentOwner(['restore']);
      assertLease = () => {
        if (useValidatedProfile === undefined) assertBorrowedRestoreOwner?.();
        else if (assertBorrowedRestoreOwner !== undefined) assertSynchronousProfileRestoreMutationAuthority(assertBorrowedRestoreOwner);
        assertCapturedOwner();
      };
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
        assertLineage(receipt.profileId);
        await read(() => input.snapshotClient.assertRestoreMaintenance(operationId));
        await read(assertSnapshotCurrent);
        assertLineage(receipt.profileId);
        validation = Object.freeze({ artifactCount: receipt.artifactCount,
          artifactTotalByteSize: receipt.artifactTotalByteSize, databaseHealth: receipt.databaseHealth,
          migrationChainIdentity: receipt.migrationChainIdentity, profileId: receipt.profileId });
        if (useValidatedProfile !== undefined) {
          if (continuationStarted) throw invalid();
          continuationStarted = true;
          let active = true;
          let grants = 0;
          closeContinuation = () => { active = false; };
          const reportFirstFailure = (cause: unknown) => {
            if (!active) return;
            active = false;
            continuationFailure ??= { cause };
            cancellation.abort();
          };
          const assertContinuationCurrent = () => {
            try {
              if (!active) throw invalid();
              assertCurrent();
              assertLineage(receipt.profileId);
            } catch (error) { reportFirstFailure(error); throw error; }
          };
          const assertMutationCurrent = () => {
            try {
              assertContinuationCurrent();
              if (grants !== 0) throw invalid();
            } catch (error) { reportFirstFailure(error); throw error; }
          };
          const authority: OwnedActiveProfileContinuation = Object.freeze({
            validation, reportFirstFailure, assertMutationCurrent,
            assertCurrent() {
              const pending = (async () => {
                try {
                  assertContinuationCurrent();
                  if (grants !== 0) throw invalid();
                  grants++;
                  try {
                    // Track the whole grant, including the snapshot reader's eventual close.
                    await read(async () => {
                      assertContinuationCurrent();
                      await input.snapshotClient.assertRestoreMaintenance(operationId);
                      assertContinuationCurrent();
                      await assertSnapshotCurrent();
                      assertContinuationCurrent();
                    });
                  } finally { grants--; }
                } catch (error) { reportFirstFailure(error); throw error; }
              })();
              // The caller must await the grant, but a dropped promise must not escape unobserved.
              void pending.catch(() => {});
              return pending;
            },
          });
          try {
            await read(() => useValidatedProfile(authority));
            assertMutationCurrent();
            if (grants !== 0) throw invalid();
          } catch (error) { reportFirstFailure(error); throw error; }
          finally { active = false; }
        }
      }));
      assertCurrent();
    } catch (error) { failures.push(continuationFailure === undefined ? error : continuationFailure.cause); }
    finally {
      clearTimeout(timer);
      closeContinuation?.();
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
          assertRuntimeOwner(); assertLease();
          await close(() => rollback?.assertCurrent() ?? Promise.resolve());
          assertRuntimeOwner(); assertLease();
          await close(() => input.snapshotClient.removeProfileSnapshot(operationId));
          assertRuntimeOwner(); assertLease();
          await close(() => rollback?.assertCurrent() ?? Promise.resolve());
          assertRuntimeOwner(); assertLease();
          assertLineage(validation!.profileId);
          // Releasing the fence is terminal; do not start another asynchronous C read afterward.
          await close(() => input.snapshotClient.endRestoreMaintenance(operationId));
          assertRuntimeOwner(); assertLease();
          assertLineage(validation!.profileId);
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
