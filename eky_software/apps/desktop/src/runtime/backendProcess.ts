import {
  utilityProcess,
  type MessagePortMain,
  type UtilityProcess,
} from 'electron';

import {
  desktopBackendReadinessTimeoutMilliseconds,
  parseDesktopBackendStatus,
  type DesktopBackendStartMessage,
} from './backendMessages.js';
import { createDesktopBackendEnvironment } from './backendEnvironment.js';
import { isOperationId } from '../profileBackup/profileSnapshotBrokerProtocol.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import {
  noOpDesktopOperationalLogger,
  type DesktopOperationalLogger,
} from '../observability/desktopOperationalLogger.js';
import {
  BackendShutdownExitError,
  waitForBackendShutdown,
  type BackendShutdownOutcome,
} from './backendShutdown.js';
import {
  DesktopBackendStartupError,
  DesktopBackendStartupStoppedError,
  type DesktopBackendStartupFailureCode,
} from './backendStartupFailure.js';
import type { WorkspaceProcessReservationTransfer } from './workspaceProcessReservation.js';
import {
  matchesWorkspaceProcessReservationDescriptor,
  parseWorkspaceProcessReservationDescriptor,
} from './workspaceProcessReservationDescriptor.js';

export { DesktopBackendStartupStoppedError } from './backendStartupFailure.js';

const backendMigrationGateTimeoutMilliseconds = 5 * 60_000;
const backendShutdownTimeoutMilliseconds = 3_000;

export interface StartDesktopBackendOptions {
  beforeMigrations(inspection: {
    appliedMigrationCount: number;
    migrationChainIdentity: string;
    pendingMigrationCount: number;
    profileState: 'empty' | 'existing';
  }, control: DesktopBackendStartupControl): Promise<void>;
  config: DesktopBackendStartMessage['config'];
  invoicePdfArchiveBrokerPort: MessagePortMain;
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger?: DesktopOperationalLogger;
  observeStartupException?(error: unknown): void;
  profileSnapshotBrokerPort: MessagePortMain;
  reservationTransfer: WorkspaceProcessReservationTransfer;
  runnerPath: string;
  secretBrokerPort: MessagePortMain;
}

export interface DesktopBackendStartupControl {
  stopStartupRuntime(): Promise<void>;
}

export interface DesktopBackendHandle {
  onUnexpectedExit(callback: () => void): void;
  port: number;
  stop(): Promise<BackendShutdownOutcome>;
  stopForUpdate(operationId: string): Promise<void>;
}

export function startDesktopBackend(
  options: StartDesktopBackendOptions,
): Promise<DesktopBackendHandle> {
  const operationalLogger =
    options.operationalLogger ?? noOpDesktopOperationalLogger;
  const startedAt = Date.now();
  operationalLogger.write(
    createDesktopOperationalEvent(
      { eventName: 'backendProcess.starting' },
      options.operationalIdentity,
    ),
  );

  return new Promise((resolveStart, rejectStart) => {
    const observePrivateException = (error: unknown): void => {
      try { options.observeStartupException?.(error); } catch { /* Optional private evidence. */ }
    };
    let processHandle: UtilityProcess;
    const reservation = parseWorkspaceProcessReservationDescriptor(options.reservationTransfer.descriptor);
    let forkAttempted = false;
    try {
      if (reservation === undefined) throw new Error('BACKEND_PROCESS_RESERVATION_FAILED');
      const env = createDesktopBackendEnvironment();
      forkAttempted = true;
      processHandle = utilityProcess.fork(options.runnerPath, [], {
        env, serviceName: 'Eky Local Backend', stdio: 'ignore',
      });
    } catch (error) {
      observePrivateException(error);
      const cancellation = new AbortController();
      void Promise.resolve().then(async () => {
        let reclaimed = false;
        try {
          if (!forkAttempted && reservation !== undefined) {
            reclaimed = await waitWithinDeadline(
              options.reservationTransfer.reclaimAfterExit(cancellation.signal),
              performance.now() + backendShutdownTimeoutMilliseconds,
            );
          }
        } finally {
          cancellation.abort();
          if (!reclaimed) {
            try { options.reservationTransfer.invalidate(); } catch { /* Remain closed. */ }
          }
          rejectStart(new DesktopBackendStartupError('DESKTOP_START_FAILED', {
            processState: forkAttempted ? 'unknown' : 'absent',
            migrationGateSettled: true,
            reservationReclaimed: reclaimed,
          }));
        }
      }).catch(observePrivateException);
      return;
    }
    let phase: 'starting' | 'controlledStop' | 'failed' | 'stopped' | 'ready' = 'starting';
    let stopping = false;
    let observedExitCode: number | undefined;
    let controlledStopCompleted = false;
    let migrationGateState: 'notStarted' | 'pending' | 'completed' | 'failed' = 'notStarted';
    let unexpectedExitCallback: (() => void) | undefined;
    let handoff: 'waitingSpawn' | 'preparing' | 'waitingReservation' | 'authorizing' | 'granted' = 'waitingSpawn';
    const startupCancellation = new AbortController();
    const startupDeadline = performance.now() + desktopBackendReadinessTimeoutMilliseconds;
    let preparationTask: Promise<void> | undefined;
    let grantTask: Promise<void> | undefined;
    let reclaimTask: Promise<boolean> | undefined;
    let reservationReclaimed = false;
    let transferInvalidated = false;
    const handleReadinessTimeout = () => failStartup('BACKEND_READINESS_TIMEOUT');
    let readinessTimer = setTimeout(
      handleReadinessTimeout,
      desktopBackendReadinessTimeoutMilliseconds,
    );

    function invalidateTransfer(): void {
      if (transferInvalidated) return;
      transferInvalidated = true;
      try { options.reservationTransfer.invalidate(); } catch { /* Remain closed. */ }
    }

    function canGrant(expected: typeof handoff): boolean {
      if (phase !== 'starting' || handoff !== expected || startupCancellation.signal.aborted) return false;
      if (performance.now() >= startupDeadline) {
        failStartup('BACKEND_READINESS_TIMEOUT');
        return false;
      }
      return true;
    }

    function reclaimAfterExit(deadline: number): Promise<boolean> {
      if (reclaimTask !== undefined) return reclaimTask;
      reclaimTask = Promise.resolve().then(async () => {
        const cancellation = new AbortController();
        try {
          const settled = await waitWithinDeadline(
            Promise.all([preparationTask, grantTask]).then(() => {}), deadline,
          );
          if (observedExitCode === undefined || !settled || transferInvalidated || performance.now() >= deadline) {
            invalidateTransfer();
            return false;
          }
          if (!(await waitWithinDeadline(
            options.reservationTransfer.reclaimAfterExit(cancellation.signal), deadline,
          ))) {
            invalidateTransfer();
            return false;
          }
          if (transferInvalidated) return false;
          reservationReclaimed = true;
          return true;
        } catch {
          invalidateTransfer();
          return false;
        } finally {
          cancellation.abort();
        }
      });
      return reclaimTask;
    }

    function failStartup(code: DesktopBackendStartupFailureCode, abortStartup = false): void {
      if (phase === 'failed' || phase === 'stopped' || phase === 'ready') return;
      // Lock the first cause before any request that can synchronously emit exit.
      phase = 'failed';
      startupCancellation.abort();
      clearTimeout(readinessTimer);
      const deadline = performance.now() + backendShutdownTimeoutMilliseconds;
      const exited = observedExitCode === undefined
        ? waitForBackendShutdown(processHandle, {
            forceAfterTimeout: false,
            timeoutMilliseconds: backendShutdownTimeoutMilliseconds,
          }).then(() => undefined, () => undefined)
        : Promise.resolve();
      void exited.then(async () => {
        if (observedExitCode === undefined) invalidateTransfer();
        else await reclaimAfterExit(deadline);
        rejectStart(new DesktopBackendStartupError(code, {
          processState: observedExitCode === undefined ? 'unknown' : 'absent',
          migrationGateSettled: migrationGateState !== 'pending',
          reservationReclaimed,
        }));
      });
      if (abortStartup && observedExitCode === undefined) {
        try { processHandle.postMessage({ type: 'abortStartup' }); }
        catch (error) { observePrivateException(error); }
      }
      if (observedExitCode === undefined) {
        try { processHandle.kill(); }
        catch (error) { observePrivateException(error); }
      }
      operationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - startedAt,
            errorCode: code,
            eventName: code === 'BACKEND_EXITED_BEFORE_READY'
              ? 'backendProcess.unexpectedExit' : 'backendProcess.healthFailed',
            retryable: code === 'BACKEND_READINESS_TIMEOUT' || code === 'BACKEND_EXITED_BEFORE_READY',
            sideEffectState: 'unknown',
            stage: code === 'BACKEND_READINESS_TIMEOUT' ? 'readiness' : 'startup',
          },
          options.operationalIdentity,
        ),
      );
    }

    processHandle.once('exit', (exitCode) => {
      observedExitCode = exitCode;
      if (phase === 'controlledStop') {
        // The original migration deadline still bounds its remaining callback.
        return;
      }
      if (phase === 'starting') {
        failStartup('BACKEND_EXITED_BEFORE_READY');
        return;
      }
      if (phase === 'ready' && !stopping) {
        operationalLogger.write(
          createDesktopOperationalEvent({
            errorCode: 'BACKEND_UNEXPECTED_EXIT',
            eventName: 'backendProcess.unexpectedExit',
            retryable: true, sideEffectState: 'unknown', stage: 'runtime',
          }, options.operationalIdentity),
        );
        unexpectedExitCallback?.();
      }
    });

    async function stopBackend(
      forceAfterTimeout: boolean,
      operationId?: string,
    ): Promise<BackendShutdownOutcome> {
      if (stopping) {
        throw new Error('BACKEND_STOP_ALREADY_STARTED');
      }

      stopping = true;
      startupCancellation.abort();
      if (phase !== 'controlledStop') clearTimeout(readinessTimer);
      const stopStartedAt = Date.now();
      const stopDeadline = performance.now() + backendShutdownTimeoutMilliseconds;
      if (observedExitCode !== undefined) {
        // An unsolicited exit is absence, not this caller's graceful shutdown.
        await reclaimAfterExit(stopDeadline);
        throw new BackendShutdownExitError();
      }
      const exitTask = waitForBackendShutdown(processHandle, {
        forceAfterTimeout, timeoutMilliseconds: backendShutdownTimeoutMilliseconds,
      });
      let requestFailed = false;
      try {
        processHandle.postMessage(operationId === undefined
          ? { type: 'shutdown' }
          : { type: 'shutdownForUpdate', operationId });
      }
      catch (error) {
        requestFailed = true;
        observePrivateException(error);
      }
      let exitOutcome: BackendShutdownOutcome;
      try {
        exitOutcome = await exitTask;
      } catch (error) {
        if (observedExitCode === undefined) invalidateTransfer();
        else await reclaimAfterExit(stopDeadline);
        throw error;
      }
      if (!(await reclaimAfterExit(exitOutcome === 'forced'
        ? stopDeadline + backendShutdownTimeoutMilliseconds : stopDeadline))) {
        throw new Error('BACKEND_PROCESS_RESERVATION_FAILED');
      }
      if (exitOutcome === 'forced') {
        operationalLogger.write(
          createDesktopOperationalEvent(
            {
              durationMs: Date.now() - stopStartedAt,
              errorCode: 'BACKEND_STOP_FAILED',
              eventName: 'backendProcess.stopFailed',
              retryable: false,
              sideEffectState: 'unknown',
              stage: 'shutdown',
            },
            options.operationalIdentity,
          ),
        );
      }
      if (requestFailed) throw new Error('BACKEND_STOP_FAILED');
      return exitOutcome;
    }

    processHandle.once('spawn', () => {
      if (!canGrant('waitingSpawn')) return;
      handoff = 'preparing';
      preparationTask = Promise.resolve().then(async () => {
        if (!canGrant('preparing')) return;
        await options.reservationTransfer.prepare(startupCancellation.signal);
        if (!canGrant('preparing')) return;
        handoff = 'waitingReservation';
        processHandle.postMessage({ reservation, type: 'prepare' });
      }).catch((error: unknown) => {
        observePrivateException(error);
        invalidateTransfer();
        failStartup('BACKEND_PROCESS_RESERVATION_FAILED');
      });
    });
    processHandle.on('message', (value) => {
      const status = parseDesktopBackendStatus(value);

      if (phase !== 'starting') return;
      if (status === undefined) {
        invalidateTransfer();
        failStartup('BACKEND_PROCESS_RESERVATION_FAILED');
        return;
      }

      if (status.type === 'reservationReady') {
        if (handoff !== 'waitingReservation' ||
            !matchesWorkspaceProcessReservationDescriptor(status.reservation, reservation)) {
          invalidateTransfer();
          failStartup('BACKEND_PROCESS_RESERVATION_FAILED');
          return;
        }
        handoff = 'authorizing';
        grantTask = Promise.resolve().then(async () => {
          if (!canGrant('authorizing')) return;
          await options.reservationTransfer.assertGrant(startupCancellation.signal);
          if (!canGrant('authorizing')) return;
          options.reservationTransfer.assertCurrent();
          if (!canGrant('authorizing')) return;
          handoff = 'granted';
          processHandle.postMessage({ config: options.config,
            generationId: reservation.generationId, type: 'start' },
          [options.secretBrokerPort, options.invoicePdfArchiveBrokerPort, options.profileSnapshotBrokerPort]);
        }).catch((error: unknown) => {
          observePrivateException(error);
          invalidateTransfer();
          failStartup('BACKEND_PROCESS_RESERVATION_FAILED');
        });
        return;
      }

      if (status.type === 'failed') {
        failStartup(status.code);
        return;
      }
      if (handoff !== 'granted') {
        invalidateTransfer();
        failStartup('BACKEND_PROCESS_RESERVATION_FAILED');
        return;
      }

      if (status.type === 'migrationGateReady') {
        if (migrationGateState !== 'notStarted') {
          failStartup('BACKEND_MIGRATION_STARTUP_GATE_FAILED', true);
          return;
        }
        migrationGateState = 'pending';
        clearTimeout(readinessTimer);
        readinessTimer = setTimeout(
          handleReadinessTimeout,
          backendMigrationGateTimeoutMilliseconds,
        );
        void Promise.resolve().then(async () => {
          if (phase !== 'starting') return;
          await options.beforeMigrations(status.inspection, {
            async stopStartupRuntime() {
              if (phase !== 'starting' || migrationGateState !== 'pending' || stopping) {
                throw new Error('BACKEND_STARTUP_STOP_INVALID');
              }
              phase = 'controlledStop';
              try {
                await stopBackend(false);
                if (phase !== 'controlledStop') throw new Error('BACKEND_STARTUP_STOP_INVALID');
                controlledStopCompleted = true;
              } catch (error) {
                failStartup('BACKEND_MIGRATION_STARTUP_GATE_FAILED');
                throw error;
              }
            },
          });
        }).then(() => {
          migrationGateState = 'completed';
          if (phase === 'controlledStop' && controlledStopCompleted) {
            phase = 'stopped';
            clearTimeout(readinessTimer);
            rejectStart(new DesktopBackendStartupStoppedError());
            return;
          }
          if (phase !== 'starting') return;
          clearTimeout(readinessTimer);
          readinessTimer = setTimeout(
            handleReadinessTimeout,
            desktopBackendReadinessTimeoutMilliseconds,
          );
          processHandle.postMessage({ type: 'continueStartup' });
        }).catch((error: unknown) => {
          migrationGateState = 'failed';
          observePrivateException(error);
          failStartup('BACKEND_MIGRATION_STARTUP_GATE_FAILED', true);
        });
        return;
      }

      if (migrationGateState === 'pending') return;
      phase = 'ready';
      clearTimeout(readinessTimer);
      operationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - startedAt,
            eventName: 'backendProcess.started',
          },
          options.operationalIdentity,
        ),
      );
      resolveStart({
        onUnexpectedExit(callback) {
          unexpectedExitCallback = callback;
        },
        port: status.port,
        stop() {
          return stopBackend(true);
        },
        async stopForUpdate(operationId) {
          if (!isOperationId(operationId)) throw new Error('BACKEND_STOP_OPERATION_INVALID');
          await stopBackend(false, operationId);
        },
      });
    });
  });
}

function waitWithinDeadline(task: Promise<void>, deadline: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, deadline - performance.now()));
    void task.then(() => {
      clearTimeout(timer);
      resolve(performance.now() < deadline);
    }, () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
