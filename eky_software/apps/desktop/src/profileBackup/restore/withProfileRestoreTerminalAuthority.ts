import { randomUUID } from 'node:crypto';

import type { InMemoryWorkspaceMaintenanceLease } from '../../workspaces/maintenance/workspaceMaintenanceLease.js';
import { profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds } from '../../runtime/profileInspectionMessages.js';
import { waitForInspectionPhase } from '../inspectOwnedEncryptedProfileBackup.js';
import type { OwnedProfileBackupInspectionReservation } from '../inspectOwnedEncryptedProfileBackup.js';
import type { ProfileSnapshotInspectionClient } from '../profileSnapshotInspectionClient.js';
import {
  assertProfileRestoreActivationJournalMatches,
  captureProfileRestoreActivationJournal,
  type ProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';
import type {
  ProfileRestoreActivationTransaction, ProfileRestoreTerminalMutationAuthority,
} from './profileRestoreActivationTransaction.js';
import { assertSynchronousProfileRestoreMutationAuthority } from './profileRestoreMutationAuthority.js';

type TerminalReservation = OwnedProfileBackupInspectionReservation & { assertMainCurrent(): void };

/** Live terminal only: the current backend fences writes, never transfers to main. */
export async function withProfileRestoreTerminalAuthority(input: {
  readonly journal: Readonly<ProfileRestoreActivationJournal>;
  readonly transaction: Pick<ProfileRestoreActivationTransaction,
    'readTerminalCleanupCensus' | 'assertTerminalCleanupCensus'>;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'acquire' | 'captureCurrentOwner'>;
  readonly snapshotClient: Pick<ProfileSnapshotInspectionClient, 'beginRestoreMaintenance' |
    'assertRestoreMaintenance' | 'endRestoreMaintenance' | 'invalidateRestoreMaintenance' |
    'createProfileSnapshot' | 'createRestoredProfileSnapshot' | 'validateProfileSnapshot' | 'withProfileSnapshot' | 'removeProfileSnapshot'>;
  readonly assertAuthority: () => void;
  readonly assertLineage: (profileId: string) => void;
  readonly acquireReservation: (root: string, identity: string, signal: AbortSignal) => Promise<TerminalReservation>;
  readonly operationSelection?: {
    assertOperationSelection(assertCurrent: () => void): Promise<void>;
    onUnsettledWork(cause: unknown): void;
  };
  readonly beforeUpdateRollbackMigrations?: {
    readonly expectedMigrationChainIdentity: string;
    assertCurrent(): Promise<void>;
  };
}, use: (authority: ProfileRestoreTerminalMutationAuthority) => Promise<void>): Promise<void> {
  const suppliedSelection = input.operationSelection;
  if (suppliedSelection !== undefined && (suppliedSelection === null ||
      typeof suppliedSelection.assertOperationSelection !== 'function' || typeof suppliedSelection.onUnsettledWork !== 'function')) throw required();
  const selection = suppliedSelection === undefined ? undefined : Object.freeze({
    assertOperationSelection: suppliedSelection.assertOperationSelection.bind(suppliedSelection),
    onUnsettledWork: suppliedSelection.onUnsettledWork.bind(suppliedSelection),
  });
  const selectedOwner = selection === undefined ? undefined : input.assertAuthority.bind(input);
  const selectedLineage = selection === undefined ? undefined : input.assertLineage.bind(input);
  const selected = captureProfileRestoreActivationJournal(input.journal);
  if (selected.phase !== 'validationStarting' && selected.phase !== 'accepted') throw required();
  const rollback = input.beforeUpdateRollbackMigrations === undefined || selection === undefined
    ? input.beforeUpdateRollbackMigrations : Object.freeze({
      expectedMigrationChainIdentity: input.beforeUpdateRollbackMigrations.expectedMigrationChainIdentity,
      assertCurrent: input.beforeUpdateRollbackMigrations.assertCurrent.bind(input.beforeUpdateRollbackMigrations),
    });
  if (rollback !== undefined && !/^[a-f0-9]{64}$/.test(rollback.expectedMigrationChainIdentity)) throw required();
  const migrationPolicy = rollback === undefined ? 'exactCurrentManifest' : 'restoreCompatible';
  const snapshotId = randomUUID();
  const cancellation = new AbortController();
  const deadline = performance.now() + profileInspectionWorkMilliseconds;
  let closed = false;
  const timer = setTimeout(() => { closed = true; cancellation.abort(); }, profileInspectionWorkMilliseconds);
  const claims: { root: string; owner: TerminalReservation }[] = [];
  const pendingWork = new Set<Promise<unknown>>();
  const failures: unknown[] = [];
  let firstFailure: { cause: unknown } | undefined;
  const recordFailure = (cause: unknown) => {
    if (selection === undefined || closed) return;
    firstFailure ??= { cause };
    closed = true;
    cancellation.abort();
  };
  const track = <T>(pending: Promise<T>): Promise<T> => {
    pendingWork.add(pending);
    void pending.then(() => pendingWork.delete(pending), error => { recordFailure(error); pendingWork.delete(pending); });
    return pending;
  };
  const assertLineage = (id: string) => {
    if (selectedLineage === undefined) input.assertLineage(id);
    else assertSynchronousProfileRestoreMutationAuthority(() => selectedLineage(id));
  };
  let lease: Awaited<ReturnType<typeof input.maintenanceLease.acquire>> | undefined;
  let assertLease = () => {};
  let fenceAttempted = false;
  let workUnsettled = false;
  let retainClaims = false;
  let mutationFailure: unknown;
  let validatedProfileId: string | undefined;
  const assertCleanupOwner = () => {
    if (selection === undefined) return;
    assertSynchronousProfileRestoreMutationAuthority(selectedOwner!);
    assertLease();
    if (validatedProfileId !== undefined) assertLineage(validatedProfileId);
  };
  const assertAuthority = () => {
    try {
      if (selection !== undefined && closed) throw required();
      assertLease();
      if (selectedOwner === undefined) input.assertAuthority();
      else assertSynchronousProfileRestoreMutationAuthority(selectedOwner);
      if (cancellation.signal.aborted || performance.now() >= deadline) throw new Error('PROFILE_INSPECTION_TIMEOUT');
      for (const claim of claims) claim.owner.assertMainCurrent();
    } catch (error) { recordFailure(error); throw error; }
  };
  const read = async <T>(task: () => Promise<T>): Promise<T> => {
    assertAuthority();
    let settled = false;
    const pending = track(Promise.resolve().then(async () => {
      assertAuthority();
      await rollback?.assertCurrent();
      assertAuthority();
      const value = await task();
      await rollback?.assertCurrent();
      assertAuthority();
      return value;
    }).finally(() => { settled = true; }));
    try {
      const value = await waitForInspectionPhase(pending, cancellation.signal);
      assertAuthority();
      return value;
    } finally {
      if (!settled) {
        workUnsettled = true;
        if (selection === undefined) for (const claim of claims) claim.owner.invalidate();
      }
    }
  };
  const assertSelection = async () => {
    if (selection !== undefined) await read(() => selection.assertOperationSelection(assertAuthority));
  };
  let terminalStarted = false;
  let terminalCompleted = false;
  try {
    await read(async () => { lease = await input.maintenanceLease.acquire('restore'); });
    assertLease = input.maintenanceLease.captureCurrentOwner(['restore']);
    if (selection !== undefined) await assertSelection();
    fenceAttempted = true;
    await read(() => input.snapshotClient.beginRestoreMaintenance(snapshotId));
    await read(() => rollback === undefined
      ? input.snapshotClient.createProfileSnapshot(snapshotId, 'exactCurrentManifest')
      : input.snapshotClient.createRestoredProfileSnapshot(snapshotId));
    const validation = await read(() => input.snapshotClient.validateProfileSnapshot(snapshotId));
    if (!validation.profileMatchesActive || validation.databaseHealth !== 'healthy') throw required();
    if (rollback !== undefined && validation.migrationChainIdentity !== rollback.expectedMigrationChainIdentity) throw required();
    assertLineage(validation.profileId);
    validatedProfileId = validation.profileId;
    await read(() => input.snapshotClient.withProfileSnapshot(snapshotId, (receipt, assertSnapshotCurrent) => {
      const original = (async () => {
      if (selection !== undefined && terminalStarted) throw required();
      terminalStarted = true;
      if (receipt.profileId !== validation.profileId || receipt.migrationPolicy !== migrationPolicy ||
          (rollback !== undefined && receipt.migrationChainIdentity !== rollback.expectedMigrationChainIdentity)) throw required();
      const census = await read(() => input.transaction.readTerminalCleanupCensus(selected));
      for (const root of census.roots) {
        if (root.identity === undefined) continue;
        await read(async () => {
          const owner = await input.acquireReservation(root.root, root.identity!, cancellation.signal);
          claims.push({ root: root.root, owner });
          if (selection === undefined ? cancellation.signal.aborted || workUnsettled : retainClaims) owner.invalidate();
        });
      }
      await read(() => input.transaction.assertTerminalCleanupCensus(census));
      let active = true;
      let grants = 0;
      const assertMutationCurrent = () => {
        try {
          if (!active || grants !== 0) throw required();
          assertAuthority(); assertLineage(receipt.profileId);
        } catch (error) { recordFailure(error); throw error; }
      };
      const assertCurrent = async (journal: Readonly<ProfileRestoreActivationJournal>, removed: ReadonlySet<string>) => {
        const expected = selected.phase === 'validationStarting' && journal.phase === 'accepted'
          ? { ...selected, phase: 'accepted' as const, revision: selected.revision + 1 } : selected;
        assertProfileRestoreActivationJournalMatches(expected, journal);
        assertLineage(receipt.profileId);
        if (selection !== undefined) await assertSelection();
        await read(() => input.snapshotClient.assertRestoreMaintenance(snapshotId));
        await read(assertSnapshotCurrent);
        for (const claim of claims) {
          // The stationary snapshot survives root deletion; a deleted-root identity cannot certify journal removal.
          if (!removed.has(claim.root)) await read(() => claim.owner.assertMainOwned());
        }
        assertAuthority();
      };
      const guardedCurrent: typeof assertCurrent = (journal, removed) => {
        const pending = track((async () => {
          try {
            assertMutationCurrent(); grants++;
            try { await assertCurrent(journal, removed); }
            finally { grants--; }
            assertMutationCurrent();
          } catch (error) { recordFailure(error); throw error; }
        })());
        void pending.catch(() => {});
        return pending;
      };
      const authority = Object.freeze({ census, assertCurrent: selection === undefined ? assertCurrent : guardedCurrent,
        ...(selection === undefined ? {} : { assertMutationCurrent }) });
      try {
        await authority.assertCurrent(selected, new Set());
        try { await use(authority); }
        catch (error) { mutationFailure = error; recordFailure(error); throw error; }
        if (selection !== undefined) assertMutationCurrent();
        assertAuthority();
        terminalCompleted = true;
      } finally { active = false; }
      })();
      if (selection === undefined) return original;
      return track(original.catch(error => { recordFailure(error); throw error; }));
    }));
    if (selection !== undefined && !terminalCompleted) throw required();
  } catch (error) {
    failures.push(firstFailure === undefined ? error : firstFailure.cause);
  } finally {
    clearTimeout(timer);
    closed = true;
    cancellation.abort();
    const cleanup = new AbortController();
    const cleanupTimer = setTimeout(() => cleanup.abort(), profileInspectionShutdownMilliseconds);
    const cleanupDeadline = performance.now() + profileInspectionShutdownMilliseconds;
    let cleanupFailed = false;
    const pendingCleanup = new Set<Promise<unknown>>();
    const trackCleanup = (pending: Promise<unknown>) => {
      pendingCleanup.add(pending);
      void pending.finally(() => pendingCleanup.delete(pending)).catch(() => {});
      return pending;
    };
    const close = async (task: () => Promise<unknown>) => {
      try {
        const result = await waitForInspectionPhase(trackCleanup(Promise.resolve().then(() => {
          if (cleanup.signal.aborted || (selection !== undefined && performance.now() >= cleanupDeadline)) {
            throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
          }
          return task();
        })), cleanup.signal);
        if (selection !== undefined && (cleanup.signal.aborted || performance.now() >= cleanupDeadline)) {
          throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
        }
        return result;
      } catch (error) {
        if (selection !== undefined && (cleanup.signal.aborted || performance.now() >= cleanupDeadline)) {
          throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED', { cause: error });
        }
        throw error;
      }
    };
    let invalidation: Promise<unknown> | undefined;
    const invalidateFence = () => {
      if (invalidation !== undefined || !fenceAttempted) return;
      // Send fail-closed invalidation before a stalled claim can exhaust the cleanup budget.
      try { invalidation = trackCleanup(input.snapshotClient.invalidateRestoreMaintenance(snapshotId)); }
      catch (error) { invalidation = Promise.reject(error); }
      void invalidation.catch(() => {});
    };
    if (failures.length !== 0) invalidateFence();
    let settled = pendingWork.size === 0;
    if (selection !== undefined && !settled) {
      try { await close(() => Promise.allSettled([...pendingWork])); settled = pendingWork.size === 0; }
      catch (error) { cleanupFailed = true; failures.push(error); }
    }
    retainClaims = selection !== undefined && !settled;
    if (selection === undefined ? workUnsettled : retainClaims) for (const claim of claims) claim.owner.invalidate();
    for (const claim of [...claims].reverse()) {
      if (selection !== undefined && !settled) break;
      try { await close(() => claim.owner.close()); } catch (error) { cleanupFailed = true; failures.push(error); }
      if (failures.length !== 0) invalidateFence();
    }
    if (failures.length === 0) {
      try {
        assertCleanupOwner();
        await close(() => { assertCleanupOwner(); return input.snapshotClient.removeProfileSnapshot(snapshotId); });
        assertCleanupOwner();
      }
      catch (error) { cleanupFailed = true; failures.push(error); }
    }
    if (fenceAttempted) {
      if (failures.length === 0) {
        try {
          assertCleanupOwner();
          await close(() => { assertCleanupOwner(); return input.snapshotClient.endRestoreMaintenance(snapshotId); });
          assertCleanupOwner();
        }
        catch (error) { cleanupFailed = true; failures.push(error); }
      }
      if (failures.length !== 0) {
        invalidateFence();
        try { await close(() => invalidation!); }
        catch (error) { cleanupFailed = true; failures.push(error); }
      }
    }
    const uncertain = selection !== undefined && (!settled || pendingCleanup.size !== 0 ||
      cleanup.signal.aborted || performance.now() >= cleanupDeadline || cleanupFailed);
    const retainOwnership = () => {
      retainClaims = true;
      if (failures.length === 0) failures.push(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
      for (const claim of claims) {
        try { claim.owner.invalidate(); } catch (error) { failures.push(error); }
      }
      try { selection!.onUnsettledWork(failures[0]); } catch (error) { failures.push(error); }
    };
    if (uncertain) {
      retainOwnership();
    } else {
      try { await lease?.release(); }
      catch (error) { failures.push(error); if (selection !== undefined) retainOwnership(); }
    }
    clearTimeout(cleanupTimer);
    cleanup.abort();
  }
  if (failures.length === 1 && failures[0] === mutationFailure) throw mutationFailure;
  if (failures.length !== 0) throw required(failures.length === 1 ? failures[0] :
    new AggregateError(failures, 'PROFILE_RESTORE_RECOVERY_REQUIRED'));
}

function required(cause?: unknown): Error { return new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause }); }
