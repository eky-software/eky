import { utilityProcess } from 'electron';

import { createDesktopBackendEnvironment } from './backendEnvironment.js';
import { readProfileInspectionFailureCause, type ProfileInspectionFailureCause } from './profileInspectionFailure.js';
import {
  createProfileInspectionCommand, parseProfileInspectionStatus,
  profileInspectionShutdownMilliseconds, profileInspectionV8HeapMiB, profileInspectionWorkMilliseconds,
  type ColdProfileInspectionReceipt, type ProfileInspectionColdSources, type ProfileInspectionOriginalSources, type ProfileInspectionCommand, type ProfileInspectionStatus,
  type ProfileInspectionDeployment, type ProfileInspectionMigrationPolicy, type ProfileInspectionReceipt, type ProfileInspectionRequestIdentity,
} from './profileInspectionMessages.js';
import { matchesWorkspaceProcessReservationDescriptor } from './workspaceProcessReservationDescriptor.js';
import type { WorkspaceProcessReservationTransfer } from './workspaceProcessReservation.js';

export class ProfileInspectionProcessError extends Error {
  constructor(
    readonly causeCode: ProfileInspectionFailureCause | 'unknown',
    readonly cleanup: Readonly<{ processAbsent: boolean; reservationReclaimed: boolean; forced: boolean }>,
  ) {
    super('PROFILE_SNAPSHOT_VALIDATION_FAILED', causeCode === 'unknown' ? undefined : { cause: new Error(causeCode) });
    this.name = 'ProfileInspectionProcessError';
  }
}

interface ProfileInspectionProcessOptions {
  readonly runnerPath: string;
  readonly identity: ProfileInspectionRequestIdentity;
  readonly deployment: ProfileInspectionDeployment;
  readonly reservationTransfer: WorkspaceProcessReservationTransfer;
  /** Derived before trusted context lookup; never renewed at a later phase. */
  readonly deadline: number;
  readonly assertAuthority: () => void;
  readonly signal: AbortSignal;
}

type Preparation = Extract<ProfileInspectionCommand, { type: 'prepare' }>;
type Completed = Extract<ProfileInspectionStatus, { type: 'completed' | 'coldCompleted' | 'originalCompleted' }>;
export type OriginalProfileInspectionResult = Extract<ProfileInspectionStatus, { type: 'originalCompleted' }>;

/** The caller retains the operation's main-owned reservation after this returns. */
export function runProfileInspectionProcess(options: ProfileInspectionProcessOptions & {
  readonly kind: 'inspect' | 'prepareRestoreActivation';
  readonly migrationPolicy: ProfileInspectionMigrationPolicy;
}): Promise<ProfileInspectionReceipt> {
  return runInspectionProcess(options, () => ({ ...options.identity, type: 'prepare', kind: options.kind,
    migrationPolicy: options.migrationPolicy, deployment: options.deployment, reservation: options.reservationTransfer.descriptor }),
  (status, prepared) => status.type === 'completed' && (prepared.kind === 'inspect' || prepared.kind === 'prepareRestoreActivation') &&
    status.result.migrationPolicy === prepared.migrationPolicy ? status.result : undefined);
}

/** Keep generation/session/operation bound to this original-only result. */
export function runColdOriginalProfileInspectionProcess(options: ProfileInspectionProcessOptions & {
  readonly sources: ProfileInspectionOriginalSources;
}): Promise<OriginalProfileInspectionResult> {
  return runInspectionProcess(options, () => ({ ...options.identity, type: 'prepare', kind: 'inspectColdRestoreOriginal',
    sources: options.sources, deployment: options.deployment, reservation: options.reservationTransfer.descriptor }),
  (status, prepared) => status.type === 'originalCompleted' && prepared.kind === 'inspectColdRestoreOriginal' &&
    status.result.layout === prepared.sources.layout && status.result.databaseSlot === prepared.sources.databaseSlot &&
    status.result.documentsSlot === prepared.sources.documentsSlot ? status : undefined);
}

export function runColdProfileInspectionProcess(options: ProfileInspectionProcessOptions & {
  readonly sources: ProfileInspectionColdSources;
}): Promise<ColdProfileInspectionReceipt> {
  return runInspectionProcess(options, () => ({ ...options.identity, type: 'prepare', kind: 'inspectColdRestoreContent',
    sources: options.sources, deployment: options.deployment, reservation: options.reservationTransfer.descriptor }),
  (status, prepared) => status.type === 'coldCompleted' && prepared.kind === 'inspectColdRestoreContent' &&
    status.result.databaseSlot === prepared.sources.databaseSlot && status.result.documentsSlot === prepared.sources.documentsSlot
    ? status.result : undefined);
}

function runInspectionProcess<T extends ProfileInspectionReceipt | ColdProfileInspectionReceipt | OriginalProfileInspectionResult>(
  options: ProfileInspectionProcessOptions,
  prepareCommand: () => Preparation,
  readResult: (status: Completed, prepared: Preparation) => T | undefined,
): Promise<T> {
  return new Promise((resolveResult, rejectResult) => {
    let prepared: Preparation;
    const workCancellation = new AbortController();
    let phase: 'waitingReady' | 'preparing' | 'waitingReservation' | 'authorizing' | 'running' | 'closing' | 'finished' = 'waitingReady';
    let child: ReturnType<typeof utilityProcess.fork> | undefined;
    let forkAttempted = false;
    let exitCode: number | undefined;
    let forced = false;
    let firstCause: ProfileInspectionFailureCause | 'unknown' | undefined;
    let result: T | undefined;
    let terminalSeen = false;
    let preparation: Promise<void> | undefined;
    let authorization: Promise<void> | undefined;
    let cleanupTask: Promise<void> | undefined;
    let cleanupDeadline = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let transferInvalidated = false;

    const invalidate = () => {
      if (transferInvalidated) return;
      transferInvalidated = true;
      try { options.reservationTransfer.invalidate(); } catch { /* Keep the root unusable. */ }
    };
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const reject = (reservationReclaimed: boolean) => {
      rejectResult(new ProfileInspectionProcessError(firstCause ?? 'PROFILE_INSPECTION_PROTOCOL_INVALID',
        Object.freeze({ processAbsent: exitCode !== undefined || !forkAttempted, reservationReclaimed, forced })));
    };
    const finish = () => {
      if (cleanupTask !== undefined || phase === 'finished') return;
      // Claim the one cleanup task before any user-supplied callback can reenter.
      cleanupTask = Promise.resolve().then(async () => {
        let reclaimed = false;
        const cancellation = new AbortController();
        try {
          const settled = await withinDeadline(Promise.allSettled([preparation, authorization]).then(() => {}), cleanupDeadline);
          if ((exitCode !== undefined || !forkAttempted) && settled && !transferInvalidated) {
            reclaimed = await withinDeadline(options.reservationTransfer.reclaimAfterExit(cancellation.signal), cleanupDeadline);
          }
          if (!reclaimed) {
            firstCause ??= 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED';
            invalidate();
          }
          if (firstCause === undefined && !forced && exitCode === 0 && result !== undefined && reclaimed) {
            options.assertAuthority();
            if (firstCause !== undefined || options.signal.aborted || transferInvalidated) {
              throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
            }
            phase = 'finished';
            resolveResult(result);
          } else {
            phase = 'finished';
            reject(reclaimed);
          }
        } catch (error) {
          firstCause ??= readProfileInspectionFailureCause(error) ?? 'PROFILE_INSPECTION_PROTOCOL_INVALID';
          if (!reclaimed) invalidate();
          phase = 'finished';
          reject(reclaimed);
        } finally {
          cancellation.abort();
          clearTimer();
          options.signal.removeEventListener('abort', aborted);
        }
      });
    };
    const close = () => {
      if (phase === 'closing' || phase === 'finished') return;
      phase = 'closing';
      workCancellation.abort();
      clearTimer();
      cleanupDeadline = performance.now() + profileInspectionShutdownMilliseconds;
      if (exitCode !== undefined || !forkAttempted) { finish(); return; }
      if (child === undefined) { invalidate(); finish(); return; }
      // Publish the grace timer before shutdown can synchronously report exit.
      timer = setTimeout(() => {
        if (exitCode !== undefined) { finish(); return; }
        forced = true;
        firstCause ??= 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED';
        cleanupDeadline = performance.now() + profileInspectionShutdownMilliseconds;
        timer = setTimeout(() => finish(), profileInspectionShutdownMilliseconds);
        try { child!.kill(); } catch { /* Kill failure never establishes absence. */ }
      }, profileInspectionShutdownMilliseconds);
      try { child.postMessage(createProfileInspectionCommand({ ...requestIdentity(prepared), type: 'shutdown' })); }
      catch { firstCause ??= 'PROFILE_INSPECTION_PROTOCOL_INVALID'; }
    };
    const fail = (error: unknown) => {
      if (phase === 'finished') return;
      firstCause ??= readProfileInspectionFailureCause(error) ?? 'unknown';
      close();
    };
    const aborted = () => fail(new Error('PROFILE_INSPECTION_TIMEOUT'));
    const current = (expected: typeof phase): boolean => {
      if (phase !== expected || workCancellation.signal.aborted || exitCode !== undefined) return false;
      if (performance.now() >= options.deadline) { aborted(); return false; }
      try { options.assertAuthority(); } catch (error) { fail(error); return false; }
      return phase === expected && !workCancellation.signal.aborted && exitCode === undefined;
    };
    const message = (value: unknown) => {
      if (phase === 'finished') return;
      const status = parseProfileInspectionStatus(value);
      if (status === undefined) { fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return; }
      if (status.type === 'ready') {
        if (!current('waitingReady')) {
          fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return;
        }
        phase = 'preparing';
        preparation = Promise.resolve().then(async () => {
          if (!current('preparing')) return;
          await options.reservationTransfer.prepare(workCancellation.signal);
          if (!current('preparing')) return;
          phase = 'waitingReservation';
          child!.postMessage(prepared);
        }).catch(fail);
        return;
      }
      if (status.generationId !== prepared.generationId || status.operationId !== prepared.operationId ||
          status.runtimeSession !== prepared.runtimeSession) {
        fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return;
      }
      if (status.type === 'reservationReady') {
        if (!current('waitingReservation') ||
            !matchesWorkspaceProcessReservationDescriptor(status.reservation, prepared.reservation)) {
          fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return;
        }
        phase = 'authorizing';
        authorization = Promise.resolve().then(async () => {
          if (!current('authorizing')) return;
          await options.reservationTransfer.assertGrant(workCancellation.signal);
          if (!current('authorizing')) return;
          options.reservationTransfer.assertCurrent();
          phase = 'running';
          child!.postMessage(createProfileInspectionCommand({ ...requestIdentity(prepared), type: 'grant' }));
        }).catch(fail);
        return;
      }
      if (terminalSeen) { fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return; }
      terminalSeen = true;
      if (status.type === 'failed') {
        if ((phase !== 'waitingReservation' && phase !== 'authorizing' && phase !== 'running') || !current(phase)) {
          fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return;
        }
        firstCause ??= status.causeCode;
        close();
      } else {
        if (!current('running')) { fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return; }
        const accepted = readResult(status, prepared);
        if (accepted === undefined) {
          fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return;
        }
        result = accepted; close();
      }
    };

    try {
      const remaining = options.deadline - performance.now();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > profileInspectionWorkMilliseconds) {
        throw new Error('PROFILE_INSPECTION_TIMEOUT');
      }
      const command = createProfileInspectionCommand(prepareCommand());
      if (command.type !== 'prepare') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      prepared = command;
      options.assertAuthority();
      if (options.signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
      options.signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(aborted, remaining);
      forkAttempted = true;
      child = utilityProcess.fork(options.runnerPath, [], {
        env: createDesktopBackendEnvironment(), stdio: 'ignore', serviceName: 'Eky Profile Inspection',
        execArgv: [`--max-old-space-size=${profileInspectionV8HeapMiB}`],
      });
      child.on('message', message);
      child.once('error', () => fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')));
      child.once('exit', code => {
        exitCode = code;
        if (code !== 0 || result === undefined || !terminalSeen) firstCause ??= 'PROFILE_INSPECTION_PROTOCOL_INVALID';
        close();
        finish();
      });
    } catch (error) { fail(error); }
  });
}

function requestIdentity(prepared: ProfileInspectionRequestIdentity): ProfileInspectionRequestIdentity {
  return { protocolVersion: prepared.protocolVersion, generationId: prepared.generationId,
    operationId: prepared.operationId, runtimeSession: prepared.runtimeSession };
}

function withinDeadline(task: Promise<void>, deadline: number): Promise<boolean> {
  return new Promise(resolveTask => {
    const timer = setTimeout(() => resolveTask(false), Math.max(0, deadline - performance.now()));
    void task.then(() => {
      clearTimeout(timer);
      resolveTask(performance.now() < deadline);
    }, () => { clearTimeout(timer); resolveTask(false); });
  });
}
