import { randomBytes, randomUUID } from 'node:crypto';

import { readProfileInspectionFailureCause } from '../runtime/profileInspectionFailure.js';
import {
  isProfileInspectionOperationId,
  profileInspectionProtocolVersion, profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
  resolveProfileInspectionCopyRoot, type ProfileInspectionRequestIdentity,
} from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import type { WorkspaceProcessReservationTransfer } from '../runtime/workspaceProcessReservation.js';
import { WorkspaceCandidateInspectionCopy } from '../workspaces/runtime/workspaceCandidateInspectionCopy.js';
import type { ProfileSnapshotInspectionReservation } from './runProfileSnapshotInspection.js';

export interface OwnedProfileInspectionControl {
  readonly deadline: number;
  readonly signal: AbortSignal;
  assertCurrent(): void;
  assertMainOwned(): Promise<void>;
  read<T>(task: () => Promise<T>): Promise<T>;
}

/** Shared copy/exit ownership only; named callers own content and lineage admission. */
export async function runOwnedProfileInspection<Preparation, Receipt, Result>(input: {
  readonly operationId: string;
  readonly reservation: ProfileSnapshotInspectionReservation;
  readonly assertAuthority: () => void;
  readonly signal: AbortSignal;
  readonly deadline?: number;
  readonly copyKind?: 'coldRestoreContent';
  prepare(control: OwnedProfileInspectionControl): Promise<Preparation>;
  inspect(preparation: Preparation, input: {
    readonly identity: ProfileInspectionRequestIdentity;
    readonly reservationTransfer: WorkspaceProcessReservationTransfer;
    readonly deadline: number;
    readonly signal: AbortSignal;
    readonly assertAuthority: () => void;
  }): Promise<Receipt>;
  afterExit?(receipt: Receipt, inspectionRoot: string, control: OwnedProfileInspectionControl): Promise<void | 'empty'>;
  accept(preparation: Preparation, receipt: Receipt, control: OwnedProfileInspectionControl): Promise<Result>;
}): Promise<Result> {
  const started = performance.now();
  const deadline = input.deadline ?? started + profileInspectionWorkMilliseconds;
  const cancellation = new AbortController();
  let mainOwned = false;
  let inspectionCopy: WorkspaceCandidateInspectionCopy | undefined;
  let copyPreparationAttempted = false;
  let copyPrepared = false;
  let copyCleanupAttempted = false;
  let captureAttempted = false;
  let captureCompleted = false;
  let requireEmptyCopy = false;
  const aborted = () => cancellation.abort();
  input.signal.addEventListener('abort', aborted, { once: true });
  const timer = setTimeout(aborted, Math.max(0, deadline - started));
  const assertCurrent = () => {
    if (input.signal.aborted || cancellation.signal.aborted || performance.now() >= deadline) {
      throw new Error('PROFILE_INSPECTION_TIMEOUT');
    }
    input.assertAuthority();
  };
  const invalidate = () => {
    try { input.reservation.invalidate(); } catch { /* Preserve the first cause and uncertain cleanup. */ }
  };
  const verifyCleanupOwnership = async () => {
    if (!mainOwned) return;
    // Native absence does not prove that a main-owned file read/close settled.
    if (captureAttempted && !captureCompleted) { mainOwned = false; return; }
    if (copyPreparationAttempted && copyCleanupAttempted && inspectionCopy !== undefined) {
      mainOwned = false;
      return;
    }
    mainOwned = false;
    const cleanupDeadline = Math.min(performance.now() + profileInspectionShutdownMilliseconds,
      deadline + 2 * profileInspectionShutdownMilliseconds);
    const remaining = cleanupDeadline - performance.now();
    if (remaining <= 0) return;
    const cleanup = new AbortController();
    const cleanupTimer = setTimeout(() => cleanup.abort(), remaining);
    try {
      await waitForPreparation(input.reservation.assertMainOwned(), cleanup.signal);
      if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) return;
      if (copyPreparationAttempted && inspectionCopy !== undefined) {
        copyCleanupAttempted = true;
        await waitForPreparation(inspectionCopy.discardAfterExit(
          () => input.reservation.assertMainOwned(), cleanup.signal, requireEmptyCopy,
        ), cleanup.signal);
        if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) return;
        inspectionCopy = undefined;
      }
      mainOwned = true;
    } catch { /* An earlier ownership assertion is not current cleanup evidence. */ }
    finally { clearTimeout(cleanupTimer); cleanup.abort(); }
  };
  const assertMainOwned = async () => {
    mainOwned = false;
    await waitForPreparation(input.reservation.assertMainOwned(), cancellation.signal);
    mainOwned = true;
    assertCurrent();
  };
  const control: OwnedProfileInspectionControl = Object.freeze({
    deadline, signal: cancellation.signal, assertCurrent, assertMainOwned,
    async read<T>(task: () => Promise<T>) {
      assertCurrent();
      const value = await waitForPreparation(Promise.resolve().then(task), cancellation.signal);
      assertCurrent();
      return value;
    },
  });
  try {
    if (!Number.isFinite(deadline) || deadline > started + profileInspectionWorkMilliseconds ||
        !isProfileInspectionOperationId(input.operationId)) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    assertCurrent();
    const preparation = await input.prepare(control);
    assertCurrent();
    const identity = Object.freeze({
      protocolVersion: profileInspectionProtocolVersion,
      generationId: randomUUID(), operationId: input.operationId,
      runtimeSession: randomBytes(32).toString('base64url'),
    });
    const reservationTransfer = input.reservation.bind(identity.generationId, assertCurrent,
      async signal => {
        copyPreparationAttempted = true;
        assertCurrent();
        await inspectionCopy!.prepare(signal);
        assertCurrent();
        copyPrepared = true;
      });
    inspectionCopy = new WorkspaceCandidateInspectionCopy(resolveProfileInspectionCopyRoot(reservationTransfer.descriptor), input.copyKind);
    mainOwned = false;
    const returned = await input.inspect(preparation, {
      identity, reservationTransfer, deadline, signal: cancellation.signal, assertAuthority: assertCurrent,
    });
    mainOwned = true; // The named process port requires actual exit and a reclaimed reservation.
    if (!copyPrepared) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    if (input.afterExit !== undefined) {
      captureAttempted = true;
      requireEmptyCopy = await input.afterExit(returned, inspectionCopy.root, control) === 'empty';
      captureCompleted = true;
    }
    await verifyCleanupOwnership();
    if (!mainOwned) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    assertCurrent();
    return await input.accept(preparation, returned, control);
  } catch (error) {
    if (error instanceof ProfileInspectionProcessError) {
      mainOwned = error.cleanup.processAbsent && error.cleanup.reservationReclaimed;
      if (mainOwned && copyPreparationAttempted) await verifyCleanupOwnership();
      if (mainOwned) throw error;
      invalidate();
      if (!error.cleanup.processAbsent || !error.cleanup.reservationReclaimed) throw error;
      throw new ProfileInspectionProcessError(error.causeCode,
        Object.freeze({ ...error.cleanup, reservationReclaimed: false }));
    }
    await verifyCleanupOwnership();
    if (!mainOwned) invalidate();
    throw new ProfileInspectionProcessError(readProfileInspectionFailureCause(error) ?? 'unknown',
      Object.freeze({ processAbsent: true, reservationReclaimed: mainOwned, forced: false }));
  } finally {
    clearTimeout(timer);
    cancellation.abort();
    input.signal.removeEventListener('abort', aborted);
  }
}

function waitForPreparation<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolveTask, rejectTask) => {
    const aborted = () => rejectTask(new Error('PROFILE_INSPECTION_TIMEOUT'));
    signal.addEventListener('abort', aborted, { once: true });
    void task.then(resolveTask, rejectTask).finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) aborted();
  });
}
