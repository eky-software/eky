import { join } from 'node:path';

import type { InMemoryWorkspaceMaintenanceLease } from '../../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { OwnedProfileBackupInspectionReservation } from '../inspectOwnedEncryptedProfileBackup.js';
import { profileInspectionWorkMilliseconds } from '../../runtime/profileInspectionMessages.js';
import { waitForInspectionPhase } from '../inspectOwnedEncryptedProfileBackup.js';
import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import {
  assertProfileRestoreActivationJournalMatches,
  captureProfileRestoreActivationJournal,
  profileRestoreForwardActivationPhases,
  type ProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationJournalStore } from './profileRestoreActivationJournalStore.js';
import type { ProfileRestoreStartupMode, ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';

type ColdForwardReservation = OwnedProfileBackupInspectionReservation & { assertMainCurrent(): void };

export interface ProfileRestoreColdOperationSelection {
  readonly deadline: number;
  assertOperationSelection(assertAuthority: () => void): Promise<void>;
  onUnsettledWork(cause: unknown): void;
}

export interface ProfileRestoreColdContentContext {
  readonly journal: Readonly<ProfileRestoreActivationJournal>;
  readonly reservation: ColdForwardReservation;
  readonly signal: AbortSignal;
  readonly deadline: number;
  assertCurrent(): Promise<void>;
  /** Only internal readonly probes; never grants inspection, publication or mutation. */
  assertReadOwnership?(): Promise<void>;
  assertAuthority(): void;
}

/** Claims the existing selected operation, never creating or cleaning its evidence. */
export async function prepareProfileRestoreColdForwardRecovery(input: {
  readonly journal: Readonly<ProfileRestoreActivationJournal>;
  readonly stagingRoot: string;
  readonly journalStore: Pick<ProfileRestoreActivationJournalStore, 'peek'>;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'acquire' | 'captureCurrentOwner'>;
  readonly assertMainOwned: () => Promise<void>;
  readonly assertAuthority: () => void;
  readonly assertContent: (context: ProfileRestoreColdContentContext) => Promise<void>;
  readonly acquireReservation: (operationRoot: string) => Promise<ColdForwardReservation>;
  readonly recovery: Pick<ProfileRestoreStartupRecovery, 'prepareBeforeBackend'>;
  readonly operationSelection?: ProfileRestoreColdOperationSelection;
  readonly observer?: ProfileRecoveryOperationalObserver;
}): Promise<ProfileRestoreStartupMode> {
  const journal = captureProfileRestoreActivationJournal(input.journal);
  if (!(profileRestoreForwardActivationPhases as readonly string[]).includes(journal.phase)) {
    throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
  }
  let lease: Awaited<ReturnType<typeof input.maintenanceLease.acquire>> | undefined;
  let reservation: ColdForwardReservation | undefined;
  let result: ProfileRestoreStartupMode | undefined;
  let recoveryStarted = false;
  const cancellation = new AbortController();
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
  const failures: unknown[] = [];
  const retain = () => {
    if (retainOwnership) return;
    retainOwnership = true;
    closed = true;
    cancellation.abort();
    if (failures.length === 0) failures.push(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    try { reservation?.invalidate(); } catch (error) { failures.push(error); }
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
    lease = await input.maintenanceLease.acquire('restore');
    const assertLease = input.maintenanceLease.captureCurrentOwner(['restore'], selection === undefined ? undefined : lease);
    const assertAuthority = () => {
      if (closed) throw new Error('PROFILE_INSPECTION_TIMEOUT');
      assertLease();
      input.assertAuthority();
      if (cancellation.signal.aborted || (deadline !== undefined && performance.now() >= deadline)) {
        throw new Error('PROFILE_INSPECTION_TIMEOUT');
      }
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
    const assertOwnership = async () => {
      assertAuthority();
      reservation?.assertMainCurrent();
      await waitForInspectionPhase(run(input.assertMainOwned), cancellation.signal);
      assertLease();
      if (reservation !== undefined) {
        await waitForInspectionPhase(run(() => reservation!.assertMainOwned()), cancellation.signal);
        assertLease();
        await waitForInspectionPhase(run(input.assertMainOwned), cancellation.signal);
        assertLease();
      }
      assertAuthority();
      reservation?.assertMainCurrent();
    };
    const assertCurrent = async () => {
      await assertOwnership();
      if (selection !== undefined) {
        await run(() => selection.assertOperationSelection(assertAuthority));
        await assertOwnership();
      }
    };
    await assertCurrent();
    assertProfileRestoreActivationJournalMatches(journal, await run(() => input.journalStore.peek()));
    await assertCurrent();
    await run(async () => {
      reservation = await input.acquireReservation(join(input.stagingRoot, journal.operationId));
      if (closed) reservation.invalidate();
    });
    await assertCurrent();
    assertProfileRestoreActivationJournalMatches(journal, await run(() => input.journalStore.peek()));
    await assertCurrent();
    if (selection === undefined) {
      deadline = performance.now() + profileInspectionWorkMilliseconds;
      timer = setTimeout(() => cancellation.abort(), profileInspectionWorkMilliseconds);
    }
    const assertContent = (current: Readonly<ProfileRestoreActivationJournal>) => run(() => input.assertContent({
      journal: current, reservation: reservation!, signal: cancellation.signal, deadline: deadline!,
      assertAuthority, assertCurrent,
      ...(selection === undefined ? {} : { assertReadOwnership: assertOwnership }),
    }));
    await assertContent(journal);
    recoveryStarted = true;
    result = await run(() => input.recovery.prepareBeforeBackend({ journal, assertCurrent, assertContent }));
    await assertCurrent();
  } catch (error) {
    failures.push(error);
  } finally {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    cancellation.abort();
    if (selection !== undefined && pendingWork.size !== 0) retain();
    // Unsettled selected work retains both owners; cleanup preserves the first cause.
    if (!retainOwnership) {
      try { await reservation?.close(); } catch (error) {
        failures.push(error);
        if (selection !== undefined) retain();
      }
      if (!retainOwnership) try { await lease?.release(); } catch (error) { failures.push(error); }
    }
  }
  if (failures.length !== 0) {
    if (!recoveryStarted || result !== undefined) {
      observeProfileRecoverySafely(input.observer ?? noOpProfileRecoveryOperationalObserver, {
        correlationId: journal.operationId,
        errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        eventName: 'restore.recoveryRequired',
        retryable: false,
        sideEffectState: 'unknown',
        stage: 'startupRollback',
      });
    }
    const cause = failures.length === 1
      ? failures[0]
      : new AggregateError(failures, 'PROFILE_RESTORE_RECOVERY_REQUIRED');
    throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause });
  }
  return result!;
}
