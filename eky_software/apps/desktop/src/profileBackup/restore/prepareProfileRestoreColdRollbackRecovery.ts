import type { InMemoryWorkspaceMaintenanceLease } from '../../workspaces/maintenance/workspaceMaintenanceLease.js';
import { profileInspectionWorkMilliseconds } from '../../runtime/profileInspectionMessages.js';
import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { waitForInspectionPhase } from '../inspectOwnedEncryptedProfileBackup.js';
import {
  noOpProfileRecoveryOperationalObserver, observeProfileRecoverySafely, type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import {
  assertProfileRestoreActivationJournalMatches, captureProfileRestoreActivationJournal,
  type ProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationJournalStore } from './profileRestoreActivationJournalStore.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import type { ProfileRestoreColdContentContext, ProfileRestoreColdOperationSelection } from './prepareProfileRestoreColdForwardRecovery.js';
import type { ProfileRestoreColdRollbackAdmission, ProfileRestoreStartupMode, ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';

type Reservation = ProfileRestoreColdContentContext['reservation'];

interface ProfileRestoreRollbackAuthorityInput {
  readonly journal: Readonly<ProfileRestoreActivationJournal>;
  readonly journalStore: Pick<ProfileRestoreActivationJournalStore, 'peek'>;
  readonly transaction: Pick<ProfileRestoreActivationTransaction, 'prepareColdRollbackAnchor'>;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'acquire' | 'captureCurrentOwner'>;
  /** Only the caller may release a borrowed restore owner, including on failure. */
  readonly assertBorrowedRestoreOwner?: () => void;
  readonly assertMainOwned: () => Promise<void>;
  readonly assertAuthority: () => void;
  readonly assertContent: (context: ProfileRestoreColdContentContext) => Promise<void>;
  readonly acquireReservation: (root: string, identity: string, signal: AbortSignal) => Promise<Reservation>;
  readonly observer?: ProfileRecoveryOperationalObserver;
  readonly operationSelection?: ProfileRestoreColdOperationSelection;
}

export function prepareProfileRestoreColdRollbackRecovery(input: ProfileRestoreRollbackAuthorityInput & {
  readonly recovery: Pick<ProfileRestoreStartupRecovery, 'prepareBeforeBackend'>;
}): Promise<ProfileRestoreStartupMode> {
  if (input.journal.phase !== 'rollbackStarting' && input.journal.phase !== 'rolledBack') return Promise.reject(required());
  return withProfileRestoreColdRollbackAuthority(input, admission => input.recovery.prepareBeforeBackend(admission));
}

/** Holds the same original-inspection authority for cold resume and stopped-backend rollback. */
export async function withProfileRestoreColdRollbackAuthority<T>(
  input: ProfileRestoreRollbackAuthorityInput,
  use: (admission: ProfileRestoreColdRollbackAdmission) => Promise<T>,
): Promise<T> {
  const assertBorrowedRestoreOwner = input.assertBorrowedRestoreOwner;
  const selected = captureProfileRestoreActivationJournal(input.journal);
  const phases = selected.phase === 'validationStarting' ? ['validationStarting', 'rollbackStarting', 'rolledBack']
    : selected.phase === 'rollbackStarting' ? ['rollbackStarting', 'rolledBack']
      : selected.phase === 'rolledBack' ? ['rolledBack'] : [];
  if (phases.length === 0) throw required();
  const cancellation = new AbortController();
  const sources: { role: 'staging' | 'rollback'; root: string; identity: string; reservation: Reservation; released: boolean }[] = [];
  let anchor: Reservation | undefined;
  let lease: Awaited<ReturnType<typeof input.maintenanceLease.acquire>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: number | undefined;
  const selection = input.operationSelection === undefined ? undefined : Object.freeze({
    deadline: input.operationSelection.deadline,
    assertOperationSelection: input.operationSelection.assertOperationSelection.bind(input.operationSelection),
    onUnsettledWork: input.operationSelection.onUnsettledWork.bind(input.operationSelection),
  });
  const selectionDeadline = selection?.deadline;
  const pendingWork = new Set<Promise<unknown>>();
  let closed = false;
  let retainOwnership = false;
  let result: T | undefined;
  let completed = false;
  let recoveryStarted = false;
  const failures: unknown[] = [];
  const invalidate = () => {
    anchor?.invalidate();
    for (const source of sources) if (!source.released) source.reservation.invalidate();
  };
  const retain = () => {
    if (retainOwnership) return;
    retainOwnership = true;
    closed = true;
    cancellation.abort();
    if (failures.length === 0) failures.push(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    for (const reservation of [anchor, ...sources.filter(source => !source.released).map(source => source.reservation)]) {
      try { reservation?.invalidate(); } catch (error) { failures.push(error); }
    }
    try { selection!.onUnsettledWork(failures[0]); } catch (error) { failures.push(error); }
  };
  try {
    if (selection !== undefined) {
      const remaining = selectionDeadline! - performance.now();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > profileInspectionWorkMilliseconds) {
        throw new Error('PROFILE_INSPECTION_TIMEOUT');
      }
      deadline = selectionDeadline;
      timer = setTimeout(() => { closed = true; cancellation.abort(); }, remaining);
    }
    if (assertBorrowedRestoreOwner === undefined) lease = await input.maintenanceLease.acquire('restore');
    else assertBorrowedRestoreOwner();
    const assertLease = input.maintenanceLease.captureCurrentOwner(['restore'], selection === undefined ? undefined : lease);
    const assertAuthority = () => {
      if (closed) throw new Error('PROFILE_INSPECTION_TIMEOUT');
      assertBorrowedRestoreOwner?.();
      assertLease();
      input.assertAuthority();
      if (cancellation.signal.aborted || (deadline !== undefined && performance.now() >= deadline)) {
        throw new Error('PROFILE_INSPECTION_TIMEOUT');
      }
      for (const source of sources) if (!source.released) source.reservation.assertMainCurrent();
    };
    const run = async <T>(task: () => Promise<T>): Promise<T> => {
      if (selection === undefined) return task();
      assertAuthority();
      const pending = Promise.resolve().then(() => { assertAuthority(); return task(); });
      pendingWork.add(pending);
      void pending.then(() => pendingWork.delete(pending), () => pendingWork.delete(pending));
      const value = await waitForInspectionPhase(pending, cancellation.signal);
      assertAuthority();
      return value;
    };
    const read = async <T>(task: () => Promise<T>): Promise<T> => {
      assertAuthority();
      let settled = false;
      const pending = run(task).finally(() => { settled = true; });
      try {
        const value = await waitForInspectionPhase(pending, cancellation.signal);
        assertAuthority();
        return value;
      } finally { if (!settled && selection === undefined) invalidate(); }
    };
    const assertOwnership = async () => {
      anchor?.assertMainCurrent();
      await read(input.assertMainOwned);
      for (const source of sources) if (!source.released) await read(() => source.reservation.assertMainOwned());
      if (anchor !== undefined) await read(() => anchor!.assertMainOwned());
      await read(input.assertMainOwned);
      assertAuthority();
      anchor?.assertMainCurrent();
    };
    const assertCurrent = async () => {
      await assertOwnership();
      if (selection !== undefined) {
        await run(() => selection.assertOperationSelection(assertAuthority));
        await assertOwnership();
      }
    };
    await assertCurrent();
    assertProfileRestoreActivationJournalMatches(selected, await read(() => input.journalStore.peek()));
    const roots = await run(() => input.transaction.prepareColdRollbackAnchor(selected, async selectedSources => {
      for (const source of selectedSources) {
        await assertCurrent();
        await run(async () => {
          const reservation = await input.acquireReservation(source.root, source.identity, cancellation.signal);
          sources.push({ ...source, reservation, released: false });
          if (closed) reservation.invalidate();
        });
        await assertCurrent();
      }
    }, assertCurrent, selection === undefined ? undefined : {
      assertReadOwnership: assertOwnership, assertMutationCurrent: assertAuthority,
    }));
    await assertCurrent();
    await run(async () => {
      anchor = await input.acquireReservation(roots.anchorRoot, roots.anchorIdentity, cancellation.signal);
      if (closed) anchor.invalidate();
    });
    await assertCurrent();
    assertProfileRestoreActivationJournalMatches(selected, await read(() => input.journalStore.peek()));
    if (selection === undefined) {
      deadline = performance.now() + profileInspectionWorkMilliseconds;
      timer = setTimeout(() => cancellation.abort(), profileInspectionWorkMilliseconds);
    }
    const assertContent = async (current: Readonly<ProfileRestoreActivationJournal>) => {
      const journal = captureProfileRestoreActivationJournal(current);
      const index = phases.indexOf(journal.phase);
      if (index < 0) throw required();
      const expected = { ...selected, phase: journal.phase, revision: selected.revision + index };
      assertProfileRestoreActivationJournalMatches(expected, journal);
      await run(() => input.assertContent({ journal, reservation: anchor!, signal: cancellation.signal, deadline: deadline!,
        assertAuthority, assertCurrent,
        ...(selection === undefined ? {} : { assertReadOwnership: assertOwnership }) }));
    };
    await assertContent(selected);
    recoveryStarted = true;
    result = await run(() => use({
      kind: 'rollback', journal: selected, assertCurrent, assertContent,
      ...(selection === undefined ? {} : { coldCleanupContext: Object.freeze({
        assertReadOwnership: assertOwnership,
        assertMutationCurrent() { assertAuthority(); anchor!.assertMainCurrent(); },
      }) }),
      async beforeStagingMove(current) {
        await assertContent(current);
        await assertCurrent();
        const source = sources.find(source => source.role === 'staging');
        if (source === undefined || source.released) throw required();
        // Inspection has exited/reclaimed and every content read has settled here.
        await source.reservation.close();
        source.released = true;
        await assertCurrent();
      },
      async beforeRollbackRootRemoval(current) {
        if (current.phase !== 'rolledBack') throw required();
        await assertContent(current);
        await assertCurrent();
        const source = sources.find(source => source.role === 'rollback');
        if (source === undefined || source.released) throw required();
        await source.reservation.close();
        source.released = true;
        await assertCurrent();
        if (await read(() => readWorkspaceProcessReservationIdentity(source.root)) !== source.identity) throw required();
        await assertCurrent();
        return Object.freeze({ identity: source.identity, assertCurrent() {
          assertAuthority(); anchor!.assertMainCurrent();
        } });
      },
    }));
    completed = true;
    await assertCurrent();
  } catch (error) {
    failures.push(error);
    try { anchor?.assertMainCurrent(); } catch {
      if (selection !== undefined) retain();
      else invalidate();
    }
  } finally {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    cancellation.abort();
    if (selection !== undefined && pendingWork.size !== 0) retain();
    if (!retainOwnership) {
      let closeFailed = false;
      try { await anchor?.close(); } catch (error) { failures.push(error); closeFailed = true; }
      for (const source of [...sources].reverse()) {
        if (!source.released) {
          try { await source.reservation.close(); source.released = true; } catch (error) { failures.push(error); closeFailed = true; }
        }
      }
      if (selection !== undefined && closeFailed) retain();
      if (!retainOwnership) try { await lease?.release(); } catch (error) { failures.push(error); }
    }
  }
  if (failures.length !== 0) {
    if (!recoveryStarted || completed) observeProfileRecoverySafely(input.observer ?? noOpProfileRecoveryOperationalObserver, {
      correlationId: selected.operationId, eventName: 'restore.recoveryRequired',
      errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED', retryable: false, sideEffectState: 'unknown', stage: 'startupRollback',
    });
    throw required(failures.length === 1 ? failures[0] : new AggregateError(failures, 'PROFILE_RESTORE_RECOVERY_REQUIRED'));
  }
  return result!;
}

function required(cause?: unknown): Error { return new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause }); }
