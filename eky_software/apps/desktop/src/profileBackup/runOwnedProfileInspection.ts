import { randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { readProfileInspectionFailureCause } from '../runtime/profileInspectionFailure.js';
import {
  isProfileInspectionOperationId,
  profileInspectionProtocolVersion, profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
  resolveProfileInspectionCopyRoot, type ProfileInspectionRequestIdentity,
} from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import type { WorkspaceProcessReservationTransfer } from '../runtime/workspaceProcessReservation.js';
import { WorkspaceCandidateInspectionCopy } from '../workspaces/runtime/workspaceCandidateInspectionCopy.js';
import { WorkspaceRemnantBindingStore } from '../workspaces/deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding } from '../workspaces/deletion/workspaceRemnantBindingCodec.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { validateWorkspaceLineage } from '../workspaces/registry/workspaceLineageValidation.js';
import type { WorkspaceLineageIdentityV1 } from '../workspaces/registry/workspaceRegistryTypes.js';
import type { ProfileSnapshotInspectionReservation } from './runProfileSnapshotInspection.js';

export type OwnedProfileInspectionTarget = Readonly<{ kind: 'unbound' }> | Readonly<{
  kind: 'bound';
  installationRoot: string;
  workspaceId: string;
  lineageIdentity: Readonly<WorkspaceLineageIdentityV1>;
  assertSelectionCurrent(assertPhaseCurrent: () => void): Promise<void>;
}>;

/** Captures trusted Main selection, never infers ownership from the inspected content. */
export function captureOwnedProfileInspectionTarget(target: OwnedProfileInspectionTarget): OwnedProfileInspectionTarget {
  if (target?.kind === 'unbound') return Object.freeze({ kind: 'unbound' });
  if (target?.kind !== 'bound' || typeof target.installationRoot !== 'string' ||
      !isAbsolute(target.installationRoot) || typeof target.assertSelectionCurrent !== 'function') {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
  return Object.freeze({ kind: 'bound', installationRoot: target.installationRoot,
    workspaceId: validateWorkspaceId(target.workspaceId), lineageIdentity: validateWorkspaceLineage(target.lineageIdentity),
    assertSelectionCurrent: target.assertSelectionCurrent.bind(target) });
}

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
  readonly target: OwnedProfileInspectionTarget;
  readonly reservation: ProfileSnapshotInspectionReservation;
  readonly assertAuthority: () => void;
  readonly signal: AbortSignal;
  readonly deadline?: number;
  readonly observeException?: (error: unknown) => void;
  readonly copyKind?: 'coldRestoreContent';
  prepare(control: OwnedProfileInspectionControl): Promise<Preparation>;
  inspect(preparation: Preparation, input: {
    readonly identity: ProfileInspectionRequestIdentity;
    readonly reservationTransfer: WorkspaceProcessReservationTransfer;
    readonly deadline: number;
    readonly signal: AbortSignal;
    readonly assertAuthority: () => void;
    readonly observeException?: (error: unknown) => void;
  }): Promise<Receipt>;
  afterExit?(receipt: Receipt, inspectionRoot: string, control: OwnedProfileInspectionControl): Promise<void | 'empty'>;
  accept(preparation: Preparation, receipt: Receipt, control: OwnedProfileInspectionControl): Promise<Result>;
}): Promise<Result> {
  const started = performance.now();
  const suppliedObserver = input.observeException;
  let failureObserved = false;
  const observeException = suppliedObserver === undefined ? undefined : (error: unknown) => {
    if (failureObserved) return;
    failureObserved = true;
    try { suppliedObserver(error); } catch { /* Optional private test evidence. */ }
  };
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
  let target: OwnedProfileInspectionTarget | undefined;
  let bindingStore: WorkspaceRemnantBindingStore | undefined;
  let publicationAttempted = false;
  let publicationSettled = false;
  let publication: Awaited<ReturnType<WorkspaceRemnantBindingStore['publish']>> | undefined;
  let copyRemoved = false;
  let metadataCleanupAttempted = false;
  let metadataCleared = false;
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
    if ((publicationAttempted && (!publicationSettled || publication === undefined)) ||
        (metadataCleanupAttempted && !metadataCleared) ||
        (copyPreparationAttempted && copyCleanupAttempted && inspectionCopy !== undefined && !copyRemoved)) {
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
    const assertCleanupCurrent = () => {
      if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    };
    const assertCleanupSelection = async () => {
      assertCleanupCurrent();
      if (target?.kind !== 'bound') throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      await target.assertSelectionCurrent(assertCleanupCurrent);
      assertCleanupCurrent();
      await input.reservation.assertMainOwned();
      assertCleanupCurrent();
    };
    try {
      await waitForPreparation(input.reservation.assertMainOwned(), cleanup.signal);
      if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) return;
      if (publication !== undefined) await waitForPreparation(assertCleanupSelection(), cleanup.signal);
      if (copyPreparationAttempted && inspectionCopy !== undefined && !copyRemoved) {
        copyCleanupAttempted = true;
        await waitForPreparation(inspectionCopy.discardAfterExit(
          publication === undefined ? () => input.reservation.assertMainOwned() : assertCleanupSelection,
          cleanup.signal, requireEmptyCopy,
        ), cleanup.signal);
        if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) return;
        copyRemoved = true;
      }
      if (publication !== undefined && !metadataCleared) {
        if (bindingStore === undefined || inspectionCopy === undefined || !copyRemoved) return;
        metadataCleanupAttempted = true;
        const copy = inspectionCopy;
        await waitForPreparation(bindingStore.clearAfterPayloadsAbsent(publication.value, {
          mode: 'owner', bindingSha256: publication.bindingSha256, expectedCurrentIdentity: publication.identity,
          assertAuthority: assertCleanupCurrent, assertExternalSelection: assertCleanupSelection,
          assertPayloadsAbsent: () => copy.assertRemovedCreationCurrent({ signal: cleanup.signal,
            assertCurrent: assertCleanupCurrent, assertMainOwned: () => input.reservation.assertMainOwned() }),
        }), cleanup.signal);
        assertCleanupCurrent();
        metadataCleared = true;
      }
      if (copyRemoved) inspectionCopy = undefined;
      mainOwned = true;
    } catch (error) {
      // An earlier ownership assertion is not current cleanup evidence.
      observeException?.(error);
    }
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
    target = captureOwnedProfileInspectionTarget(input.target);
    const preparation = await input.prepare(control);
    assertCurrent();
    const identity = Object.freeze({
      protocolVersion: profileInspectionProtocolVersion,
      generationId: randomUUID(), operationId: input.operationId,
      runtimeSession: randomBytes(32).toString('base64url'),
    });
    const reservationTransfer = input.reservation.bind(identity.generationId, assertCurrent,
      async (signal, assertPreparationCurrent, assertPreparationOwned) => {
        copyPreparationAttempted = true;
        assertCurrent();
        await inspectionCopy!.prepare(signal);
        assertCurrent();
        if (target!.kind === 'bound') {
          const selected = target as Extract<OwnedProfileInspectionTarget, { kind: 'bound' }>;
          const assertPreparation = () => { assertCurrent(); assertPreparationCurrent(); };
          const assertSelection = async () => {
            assertPreparation();
            await selected.assertSelectionCurrent(assertPreparation);
            assertPreparation();
            await assertPreparationOwned();
            assertPreparation();
          };
          const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'profileInspection',
            operationId: identity.operationId, generationId: identity.generationId,
            workspaceId: selected.workspaceId, lineageIdentity: selected.lineageIdentity,
            ...inspectionCopy!.captureCreationIdentity() });
          bindingStore = new WorkspaceRemnantBindingStore(selected.installationRoot, {
            owner: 'profileInspection', operationId: identity.operationId, generationId: identity.generationId,
          });
          await assertSelection();
          await inspectionCopy!.assertEmptyCreationCurrent({ signal, assertCurrent: assertPreparation,
            assertMainOwned: assertPreparationOwned });
          assertPreparation();
          publicationAttempted = true;
          try {
            publication = await bindingStore.publish(binding, {
              assertAuthority: assertPreparation,
              async assertExternalSelection() {
                await assertSelection();
                await inspectionCopy!.assertEmptyCreationCurrent({ signal, assertCurrent: assertPreparation,
                  assertMainOwned: assertPreparationOwned });
                await assertSelection();
              },
            });
          } finally { publicationSettled = true; }
          await assertSelection();
        }
        copyPrepared = true;
      });
    inspectionCopy = new WorkspaceCandidateInspectionCopy(resolveProfileInspectionCopyRoot(reservationTransfer.descriptor), input.copyKind);
    // Physical transfer can await child readiness after publication. Recheck the
    // captured target there, before the process owner sends its grant message.
    const selectedTransfer: WorkspaceProcessReservationTransfer = Object.freeze({
      descriptor: reservationTransfer.descriptor,
      prepare: reservationTransfer.prepare.bind(reservationTransfer),
      async assertGrant(signal: AbortSignal) {
        await reservationTransfer.assertGrant(signal);
        const assertGrantCurrent = () => {
          if (signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
          assertCurrent();
        };
        // The process sender consumes transfer.assertCurrent() exactly once.
        // Selection reads may repeat this non-consuming operation guard.
        assertGrantCurrent();
        if (target?.kind === 'bound') await target.assertSelectionCurrent(assertGrantCurrent);
        assertGrantCurrent();
      },
      assertCurrent: reservationTransfer.assertCurrent.bind(reservationTransfer),
      reclaimAfterExit: reservationTransfer.reclaimAfterExit.bind(reservationTransfer),
      invalidate: reservationTransfer.invalidate.bind(reservationTransfer),
    });
    mainOwned = false;
    const returned = await input.inspect(preparation, {
      identity, reservationTransfer: selectedTransfer, deadline, signal: cancellation.signal, assertAuthority: assertCurrent,
      ...(observeException === undefined ? {} : { observeException }),
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
      // A child may have supplied only a safe code; cleanup is not its original cause.
      failureObserved = true;
      mainOwned = error.cleanup.processAbsent && error.cleanup.reservationReclaimed;
      if (mainOwned && copyPreparationAttempted) await verifyCleanupOwnership();
      if (mainOwned) throw error;
      invalidate();
      if (!error.cleanup.processAbsent || !error.cleanup.reservationReclaimed) throw error;
      throw new ProfileInspectionProcessError(error.causeCode,
        Object.freeze({ ...error.cleanup, reservationReclaimed: false }));
    }
    observeException?.(error);
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
