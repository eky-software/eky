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

export interface ProfileRestoreColdContentContext {
  readonly journal: Readonly<ProfileRestoreActivationJournal>;
  readonly reservation: ColdForwardReservation;
  readonly signal: AbortSignal;
  readonly deadline: number;
  assertCurrent(): Promise<void>;
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
  const failures: unknown[] = [];
  try {
    lease = await input.maintenanceLease.acquire('restore');
    const assertLease = input.maintenanceLease.captureCurrentOwner(['restore']);
    const assertAuthority = () => {
      assertLease();
      input.assertAuthority();
      if (cancellation.signal.aborted || (deadline !== undefined && performance.now() >= deadline)) {
        throw new Error('PROFILE_INSPECTION_TIMEOUT');
      }
    };
    const assertCurrent = async () => {
      assertAuthority();
      reservation?.assertMainCurrent();
      await waitForInspectionPhase(input.assertMainOwned(), cancellation.signal);
      assertLease();
      if (reservation !== undefined) {
        await waitForInspectionPhase(reservation.assertMainOwned(), cancellation.signal);
        assertLease();
        await waitForInspectionPhase(input.assertMainOwned(), cancellation.signal);
        assertLease();
      }
      assertAuthority();
      reservation?.assertMainCurrent();
    };
    await assertCurrent();
    assertProfileRestoreActivationJournalMatches(journal, await input.journalStore.peek());
    await assertCurrent();
    reservation = await input.acquireReservation(join(input.stagingRoot, journal.operationId));
    await assertCurrent();
    assertProfileRestoreActivationJournalMatches(journal, await input.journalStore.peek());
    await assertCurrent();
    deadline = performance.now() + profileInspectionWorkMilliseconds;
    timer = setTimeout(() => cancellation.abort(), profileInspectionWorkMilliseconds);
    const assertContent = (current: Readonly<ProfileRestoreActivationJournal>) => input.assertContent({
      journal: current, reservation: reservation!, signal: cancellation.signal, deadline: deadline!,
      assertAuthority, assertCurrent,
    });
    await assertContent(journal);
    recoveryStarted = true;
    result = await input.recovery.prepareBeforeBackend({ journal, assertCurrent, assertContent });
    await assertCurrent();
  } catch (error) {
    failures.push(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    cancellation.abort();
    // Both releases are attempted; cleanup never replaces the first operation cause.
    try { await reservation?.close(); } catch (error) { failures.push(error); }
    try { await lease?.release(); } catch (error) { failures.push(error); }
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
