import { promises as fileSystem } from 'node:fs';
import { join } from 'node:path';

import {
  profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
} from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import type { InspectedProfileBackup } from './inspectEncryptedProfileBackup.js';
import { ProfileBackupInspectionError } from './profileBackupInspectionTypes.js';
import {
  runProfileSnapshotInspection, type ProfileSnapshotInspectionReservation,
} from './runProfileSnapshotInspection.js';
import { stageValidatedProfileBackup } from './stageValidatedProfileBackup.js';

type InspectionInput = Parameters<typeof runProfileSnapshotInspection>[0];

export interface OwnedProfileBackupInspectionReservation extends ProfileSnapshotInspectionReservation {
  close(): Promise<void>;
}

export class OwnedProfileBackupInspectionError extends ProfileBackupInspectionError {
  constructor(
    primary: ProfileBackupInspectionError,
    readonly cleanupStatus: 'completed' | 'unverified',
  ) {
    super(primary.code, { cause: primary });
    this.name = 'OwnedProfileBackupInspectionError';
  }
}

/** A transient inspect consumer, not authority to stage or activate a restore. */
export async function inspectOwnedEncryptedProfileBackup(input: {
  readonly containerPath: string;
  readonly operationId: string;
  readonly password: string;
  readonly quarantineRoot: string;
  readonly stagingRoot: string;
  readonly runnerPath: string;
  readonly deployment: InspectionInput['deployment'];
  readonly readActiveContext: InspectionInput['readActiveContext'];
  readonly assertAuthority: () => void;
  readonly signal: AbortSignal;
  readonly acquireReservation: (input: {
    readonly operationRoot: string;
    readonly signal: AbortSignal;
  }) => Promise<OwnedProfileBackupInspectionReservation>;
}): Promise<InspectedProfileBackup> {
  let owner: OwnedProfileBackupInspectionReservation | undefined;
  let deadline: number | undefined;
  let cleanupVerified = false;
  let validationStarted = false;
  let mayClean = false;
  let firstFailure: ProfileBackupInspectionError | undefined;
  let result: InspectedProfileBackup | undefined;
  const cancellation = new AbortController();
  const aborted = () => cancellation.abort();
  input.signal.addEventListener('abort', aborted, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invalidateOwner = () => {
    try { owner?.invalidate(); } catch { /* Do not replace the first cause. */ }
  };
  const assertCurrent = () => {
    if (input.signal.aborted || cancellation.signal.aborted ||
        (deadline !== undefined && performance.now() >= deadline)) {
      throw new Error('PROFILE_INSPECTION_TIMEOUT');
    }
    input.assertAuthority();
  };

  try {
    assertCurrent();
    const staged = await stageValidatedProfileBackup({
      containerPath: input.containerPath, operationId: input.operationId,
      password: input.password, quarantineRoot: input.quarantineRoot, stagingRoot: input.stagingRoot,
      validator: {
        async validateProfileSnapshot(operationId) {
          validationStarted = true;
          const workDeadline = performance.now() + profileInspectionWorkMilliseconds;
          deadline = workDeadline;
          timer = setTimeout(aborted, profileInspectionWorkMilliseconds);
          assertCurrent();
          const acquisition = Promise.resolve().then(() => input.acquireReservation({
            operationRoot: join(input.stagingRoot, operationId), signal: cancellation.signal,
          }));
          void acquisition.then(acquired => {
            if (cancellation.signal.aborted || input.signal.aborted || performance.now() >= workDeadline) {
              // A late handle is not reusable ownership and must never grant work/removal.
              try { acquired.invalidate(); } catch { /* Preserve the original timeout. */ }
            }
          }, () => {});
          owner = await waitForInspectionPhase(acquisition, cancellation.signal);
          // Admission is checked after the await as well as in its observer.
          // A late handle grants neither work nor cleanup authority.
          assertCurrent();
          mayClean = true;
          try {
            const inspected = await runProfileSnapshotInspection({
              migrationPolicy: 'restoreCompatible',
              operationId, kind: 'inspect', deadline, reservation: owner,
              runnerPath: input.runnerPath, deployment: input.deployment,
              readActiveContext: input.readActiveContext, assertAuthority: input.assertAuthority,
              signal: cancellation.signal,
            });
            mayClean = true;
            return inspected.validation;
          } catch (error) {
            mayClean = error instanceof ProfileInspectionProcessError &&
              error.cleanup.processAbsent && error.cleanup.reservationReclaimed;
            throw error;
          }
        },
      },
    });
    assertCurrent();
    result = { containerSha256: staged.containerSha256, summary: staged.summary };
  } catch (error) {
    firstFailure = error instanceof ProfileBackupInspectionError
      ? error : new ProfileBackupInspectionError('BACKUP_INSPECTION_UNAVAILABLE', { cause: error });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    cancellation.abort();
    input.signal.removeEventListener('abort', aborted);
    if (owner !== undefined && mayClean && deadline !== undefined) {
      const cleanupDeadline = Math.min(performance.now() + profileInspectionShutdownMilliseconds,
        deadline + 2 * profileInspectionShutdownMilliseconds);
      try {
        await finishOwnedCleanup(owner, join(input.stagingRoot, input.operationId), cleanupDeadline);
        cleanupVerified = true;
      } catch {
        // Keep the first inspection cause. Uncertain ownership never permits removal/reuse.
        invalidateOwner();
      }
    } else if (owner !== undefined) {
      invalidateOwner();
    }
  }

  if (firstFailure !== undefined) {
    if (!validationStarted) throw firstFailure;
    throw new OwnedProfileBackupInspectionError(firstFailure, cleanupVerified ? 'completed' : 'unverified');
  }
  if (!cleanupVerified || result === undefined) {
    throw new OwnedProfileBackupInspectionError(
      new ProfileBackupInspectionError('BACKUP_INSPECTION_UNAVAILABLE', {
        cause: new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
      }), 'unverified',
    );
  }
  return result;
}

export async function finishOwnedCleanup(
  owner: OwnedProfileBackupInspectionReservation, operationRoot: string, deadline: number,
): Promise<void> {
  const cancellation = new AbortController();
  const signal = cancellation.signal;
  const timer = setTimeout(() => cancellation.abort(), Math.max(0, Math.ceil(deadline - performance.now())));
  const assertCurrent = () => {
    if (signal.aborted || performance.now() >= deadline) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
  };
  try {
    assertCurrent();
    await waitForInspectionPhase(owner.assertMainOwned(), signal);
    assertCurrent();
    await waitForInspectionPhase(fileSystem.rm(operationRoot, { force: true, recursive: true }), signal);
    assertCurrent();
    await waitForInspectionPhase(owner.close(), signal);
    assertCurrent();
  } finally {
    clearTimeout(timer);
    cancellation.abort();
  }
}

export function waitForInspectionPhase<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolveTask, rejectTask) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted);
      rejectTask(new Error('PROFILE_INSPECTION_TIMEOUT'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    void task.then(resolveTask, rejectTask).finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) aborted();
  });
}
