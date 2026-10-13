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
  readonly beforeUpdateRollbackMigrations?: {
    readonly expectedMigrationChainIdentity: string;
    assertCurrent(): Promise<void>;
  };
}, use: (authority: ProfileRestoreTerminalMutationAuthority) => Promise<void>): Promise<void> {
  const selected = captureProfileRestoreActivationJournal(input.journal);
  if (selected.phase !== 'validationStarting' && selected.phase !== 'accepted') throw required();
  const rollback = input.beforeUpdateRollbackMigrations;
  if (rollback !== undefined && !/^[a-f0-9]{64}$/.test(rollback.expectedMigrationChainIdentity)) throw required();
  const migrationPolicy = rollback === undefined ? 'exactCurrentManifest' : 'restoreCompatible';
  const snapshotId = randomUUID();
  const cancellation = new AbortController();
  const deadline = performance.now() + profileInspectionWorkMilliseconds;
  const timer = setTimeout(() => cancellation.abort(), profileInspectionWorkMilliseconds);
  const claims: { root: string; owner: TerminalReservation }[] = [];
  const failures: unknown[] = [];
  let lease: Awaited<ReturnType<typeof input.maintenanceLease.acquire>> | undefined;
  let assertLease = () => {};
  let fenceAttempted = false;
  let workUnsettled = false;
  let mutationFailure: unknown;
  const assertAuthority = () => {
    assertLease();
    input.assertAuthority();
    if (cancellation.signal.aborted || performance.now() >= deadline) throw new Error('PROFILE_INSPECTION_TIMEOUT');
    for (const claim of claims) claim.owner.assertMainCurrent();
  };
  const read = async <T>(task: () => Promise<T>): Promise<T> => {
    assertAuthority();
    let settled = false;
    const pending = Promise.resolve().then(async () => {
      assertAuthority();
      await rollback?.assertCurrent();
      assertAuthority();
      const value = await task();
      await rollback?.assertCurrent();
      assertAuthority();
      return value;
    }).finally(() => { settled = true; });
    try {
      const value = await waitForInspectionPhase(pending, cancellation.signal);
      assertAuthority();
      return value;
    } finally {
      if (!settled) {
        workUnsettled = true;
        for (const claim of claims) claim.owner.invalidate();
      }
    }
  };
  try {
    await read(async () => { lease = await input.maintenanceLease.acquire('restore'); });
    assertLease = input.maintenanceLease.captureCurrentOwner(['restore']);
    fenceAttempted = true;
    await read(() => input.snapshotClient.beginRestoreMaintenance(snapshotId));
    await read(() => rollback === undefined
      ? input.snapshotClient.createProfileSnapshot(snapshotId, 'exactCurrentManifest')
      : input.snapshotClient.createRestoredProfileSnapshot(snapshotId));
    const validation = await read(() => input.snapshotClient.validateProfileSnapshot(snapshotId));
    if (!validation.profileMatchesActive || validation.databaseHealth !== 'healthy') throw required();
    if (rollback !== undefined && validation.migrationChainIdentity !== rollback.expectedMigrationChainIdentity) throw required();
    input.assertLineage(validation.profileId);
    await read(() => input.snapshotClient.withProfileSnapshot(snapshotId, async (receipt, assertSnapshotCurrent) => {
      if (receipt.profileId !== validation.profileId || receipt.migrationPolicy !== migrationPolicy ||
          (rollback !== undefined && receipt.migrationChainIdentity !== rollback.expectedMigrationChainIdentity)) throw required();
      const census = await read(() => input.transaction.readTerminalCleanupCensus(selected));
      for (const root of census.roots) {
        if (root.identity === undefined) continue;
        await read(async () => {
          const owner = await input.acquireReservation(root.root, root.identity!, cancellation.signal);
          claims.push({ root: root.root, owner });
          if (cancellation.signal.aborted || workUnsettled) owner.invalidate();
        });
      }
      await read(() => input.transaction.assertTerminalCleanupCensus(census));
      const assertCurrent = async (journal: Readonly<ProfileRestoreActivationJournal>, removed: ReadonlySet<string>) => {
        const expected = selected.phase === 'validationStarting' && journal.phase === 'accepted'
          ? { ...selected, phase: 'accepted' as const, revision: selected.revision + 1 } : selected;
        assertProfileRestoreActivationJournalMatches(expected, journal);
        input.assertLineage(receipt.profileId);
        await read(() => input.snapshotClient.assertRestoreMaintenance(snapshotId));
        await read(assertSnapshotCurrent);
        for (const claim of claims) {
          // The stationary snapshot survives root deletion; a deleted-root identity cannot certify journal removal.
          if (!removed.has(claim.root)) await read(() => claim.owner.assertMainOwned());
        }
        assertAuthority();
      };
      const authority = Object.freeze({ census, assertCurrent });
      await assertCurrent(selected, new Set());
      try { await use(authority); }
      catch (error) { mutationFailure = error; throw error; }
      assertAuthority();
    }));
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(timer);
    cancellation.abort();
    const cleanup = new AbortController();
    const cleanupTimer = setTimeout(() => cleanup.abort(), profileInspectionShutdownMilliseconds);
    const close = (task: () => Promise<unknown>) => waitForInspectionPhase(Promise.resolve().then(() => {
      if (cleanup.signal.aborted) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      return task();
    }), cleanup.signal);
    let invalidation: Promise<unknown> | undefined;
    const invalidateFence = () => {
      if (invalidation !== undefined || !fenceAttempted) return;
      // Send fail-closed invalidation before a stalled claim can exhaust the cleanup budget.
      try { invalidation = input.snapshotClient.invalidateRestoreMaintenance(snapshotId); }
      catch (error) { invalidation = Promise.reject(error); }
      void invalidation.catch(() => {});
    };
    if (failures.length !== 0) invalidateFence();
    if (workUnsettled) for (const claim of claims) claim.owner.invalidate();
    for (const claim of [...claims].reverse()) {
      try { await close(() => claim.owner.close()); } catch (error) { failures.push(error); }
      if (failures.length !== 0) invalidateFence();
    }
    if (failures.length === 0) {
      try { await close(() => input.snapshotClient.removeProfileSnapshot(snapshotId)); }
      catch (error) { failures.push(error); }
    }
    if (fenceAttempted) {
      if (failures.length === 0) {
        try { await close(() => input.snapshotClient.endRestoreMaintenance(snapshotId)); }
        catch (error) { failures.push(error); }
      }
      if (failures.length !== 0) {
        invalidateFence();
        try { await close(() => invalidation!); }
        catch (error) { failures.push(error); }
      }
    }
    try { await lease?.release(); } catch (error) { failures.push(error); }
    clearTimeout(cleanupTimer);
    cleanup.abort();
  }
  if (failures.length === 1 && failures[0] === mutationFailure) throw mutationFailure;
  if (failures.length !== 0) throw required(failures.length === 1 ? failures[0] :
    new AggregateError(failures, 'PROFILE_RESTORE_RECOVERY_REQUIRED'));
}

function required(cause?: unknown): Error { return new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause }); }
