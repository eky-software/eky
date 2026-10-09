import type { utilityProcess, UtilityProcess } from 'electron';

import type {
  DesktopBackendHandle,
  StartDesktopBackendOptions,
} from '../src/runtime/backendProcess.js';
import { desktopBackendReadinessTimeoutMilliseconds, parseDesktopBackendStatus } from '../src/runtime/backendMessages.js';
import {
  matchesWorkspaceProcessReservationDescriptor,
  parseWorkspaceProcessReservationDescriptor,
} from '../src/runtime/workspaceProcessReservationDescriptor.js';
import {
  waitForBackendShutdown,
  type BackendShutdownOutcome,
} from '../src/runtime/backendShutdown.js';
import { createDesktopOperationalEvent } from '../src/observability/createDesktopOperationalEvent.js';
import type { ElectronE2eConfig } from './electronE2eConfig.js';
import type { ElectronE2eStartupCheckpoint } from './electronE2eStartupObservation.js';
import {
  parseElectronE2eBackendProgress,
  parseElectronE2eBackendStatus,
  readElectronE2eBackendFailureCode,
  type ElectronE2eBackendFailureObservation,
  type ElectronE2eBackendStartupStage,
} from './electronE2eBackendStatus.js';

export interface ElectronE2eBackendController {
  getStartCount(): number;
  getStartupFailure(): ElectronE2eBackendFailureObservation | undefined;
  isRunning(): boolean;
  killUnexpectedly(): void;
  startBackend(
    options: StartDesktopBackendOptions,
  ): Promise<DesktopBackendHandle>;
}

const shutdownTimeoutMilliseconds = 3_000;

export function createElectronE2eBackendController(
  config: ElectronE2eConfig,
  runnerPath: string,
  runtime: {
    fork: typeof utilityProcess.fork;
    observeStartup(checkpoint: ElectronE2eStartupCheckpoint): void;
    observeBackendStartupStage?(stage: ElectronE2eBackendStartupStage): void;
  },
): ElectronE2eBackendController {
  let processHandle: UtilityProcess | undefined;
  let startCount = 0;
  let startupFailure: ElectronE2eBackendFailureObservation | undefined;

  function observe(checkpoint: ElectronE2eStartupCheckpoint): void {
    try {
      runtime.observeStartup(checkpoint);
    } catch {
      // Optional memory evidence cannot change the owned process outcome.
    }
  }

  return {
    getStartCount: () => startCount,
    getStartupFailure: () => startupFailure,
    isRunning: () => processHandle !== undefined,
    killUnexpectedly() {
      processHandle?.kill();
    },
    startBackend(options) {
      const reservation = parseWorkspaceProcessReservationDescriptor(options.reservationTransfer.descriptor);
      if (
        processHandle !== undefined ||
        options.config.runtimeSessionSecret !== config.backend.sessionSecret || reservation === undefined
      ) {
        throw new Error(
          'DESKTOP_SMOKE_E2E_BACKEND_CONTROLLER_BOUNDARY_FAILED',
        );
      }

      return new Promise((resolveStart, rejectStart) => {
        startCount += 1;
        startupFailure = undefined;
        options.operationalLogger?.write(
          createDesktopOperationalEvent(
            { eventName: 'backendProcess.starting' },
            options.operationalIdentity,
          ),
        );
        observe('backendForkRequested');
        let child: UtilityProcess;
        try {
          child = runtime.fork(runnerPath, [], {
            env: createE2eUtilityEnvironment(),
            serviceName: 'Eky E2E Fake Backend',
            stdio: 'ignore',
          });
        } catch (error) {
          options.reservationTransfer.invalidate();
          throw error;
        }
        processHandle = child;
        observe('backendForkReturned');
        let ready = false;
        let startupSettled = false;
        let stopping = false;
        const startupCancellation = new AbortController();
        let handoff: 'spawn' | 'preparing' | 'reserved' | 'authorizing' | 'granted' = 'spawn';
        let unexpectedExitCallback: (() => void) | undefined;
        function failStartup(error: Error): void {
          if (startupSettled) return;
          startupSettled = true;
          clearTimeout(timer);
          startupCancellation.abort();
          options.reservationTransfer.invalidate();
          rejectStart(error);
          try { child.kill(); } catch { /* The fixture still owns the process tree. */ }
        }
        const timer = setTimeout(() => {
          observe('backendReadinessTimedOut');
          failStartup(
            new Error('DESKTOP_SMOKE_E2E_BACKEND_READY_TIMEOUT_FAILED'),
          );
        }, desktopBackendReadinessTimeoutMilliseconds);
        observe('backendReadinessWaitStarted');

        child.once('spawn', () => {
          observe('backendProcessSpawned');
          if (startupSettled) return;
          handoff = 'preparing';
          void Promise.resolve().then(async () => {
            if (startupSettled) return;
            await options.reservationTransfer.prepare(startupCancellation.signal);
            if (startupSettled) return;
            handoff = 'reserved';
            child.postMessage({ type: 'prepare', reservation });
          }).catch(() => failStartup(new Error('BACKEND_PROCESS_RESERVATION_FAILED')));
        });
        child.on('message', (value) => {
          const reservationStatus = parseDesktopBackendStatus(value);
          if (reservationStatus?.type === 'reservationReady' && !startupSettled) {
            if (handoff !== 'reserved' || !matchesWorkspaceProcessReservationDescriptor(reservation, reservationStatus.reservation)) {
              failStartup(new Error('BACKEND_PROCESS_RESERVATION_FAILED'));
              return;
            }
            handoff = 'authorizing';
            void Promise.resolve().then(async () => {
              if (startupSettled) return;
              await options.reservationTransfer.assertGrant(startupCancellation.signal);
              if (startupSettled) return;
              options.reservationTransfer.assertCurrent();
              handoff = 'granted';
              child.postMessage({
                config: options.config, configPath: config.backend.configPath,
                generationId: reservation.generationId, type: 'start',
              }, [options.secretBrokerPort, options.invoicePdfArchiveBrokerPort, options.profileSnapshotBrokerPort]);
              observe('backendStartMessageSent');
            }).catch(() => failStartup(new Error('BACKEND_PROCESS_RESERVATION_FAILED')));
            return;
          }
          const progress = parseElectronE2eBackendProgress(value);
          if (progress !== undefined) {
            if (!startupSettled) {
              try {
                runtime.observeBackendStartupStage?.(progress.stage);
              } catch {
                // Optional progress never changes readiness or its deadline.
              }
            }
            return;
          }
          const status = parseElectronE2eBackendStatus(value);
          if (status === undefined || startupSettled) {
            return;
          }
          if (status.type === 'failed') {
            startupFailure = Object.freeze({ backendAttempt: startCount, status });
            failStartup(
              new Error(readElectronE2eBackendFailureCode(status.stage)),
            );
            return;
          }
          if (handoff !== 'granted') {
            failStartup(new Error('BACKEND_PROCESS_RESERVATION_FAILED'));
            return;
          }
          if (status.port !== config.backend.port) {
            failStartup(
              new Error('DESKTOP_SMOKE_E2E_BACKEND_PORT_MISMATCH_FAILED'),
            );
            return;
          }

          ready = true;
          startupSettled = true;
          clearTimeout(timer);
          observe('backendReadyReceived');
          options.operationalLogger?.write(
            createDesktopOperationalEvent(
              {
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
            async stopForUpdate(_operationId: string) {
              // This fake runner has no operation-bound update shutdown contract.
              // Installer acceptance must use the real packaged backend.
              throw new Error('ELECTRON_E2E_BACKEND_UPDATE_SHUTDOWN_UNSUPPORTED');
            },
          });

          async function stopBackend(
            forceAfterTimeout: boolean,
          ): Promise<BackendShutdownOutcome> {
            if (stopping) {
              throw new Error('ELECTRON_E2E_BACKEND_STOP_ALREADY_STARTED');
            }
            stopping = true;
            const deadline = performance.now() + shutdownTimeoutMilliseconds;
            const stopped = waitForBackendShutdown(child, {
              forceAfterTimeout,
              timeoutMilliseconds: shutdownTimeoutMilliseconds,
            });
            try {
              child.postMessage({ type: 'shutdown' });
            } catch (error) {
              options.reservationTransfer.invalidate();
              await stopped.catch(() => undefined);
              throw error;
            }
            try {
              const outcome = await stopped;
              await reclaimBeforeDeadline(outcome === 'forced'
                ? deadline + shutdownTimeoutMilliseconds : deadline);
              return outcome;
            } catch (error) {
              options.reservationTransfer.invalidate();
              throw error;
            }
          }
          async function reclaimBeforeDeadline(deadline: number): Promise<void> {
            const cancellation = new AbortController();
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
              const remaining = deadline - performance.now();
              if (remaining <= 0) throw new Error('BACKEND_PROCESS_RESERVATION_FAILED');
              await Promise.race([
                options.reservationTransfer.reclaimAfterExit(cancellation.signal),
                new Promise<never>((_, reject) => {
                  timeout = setTimeout(() => {
                    cancellation.abort();
                    reject(new Error('BACKEND_PROCESS_RESERVATION_FAILED'));
                  }, remaining);
                }),
              ]);
            } finally {
              clearTimeout(timeout);
              cancellation.abort();
            }
          }
        });
        child.once('exit', () => {
          startupSettled = true;
          clearTimeout(timer);
          processHandle = undefined;
          if (!ready) {
            startupCancellation.abort();
            options.reservationTransfer.invalidate();
            rejectStart(
              new Error(
                'DESKTOP_SMOKE_E2E_BACKEND_EXITED_BEFORE_READY_FAILED',
              ),
            );
            return;
          }
          if (!stopping) {
            options.reservationTransfer.invalidate();
            options.operationalLogger?.write(
              createDesktopOperationalEvent(
                {
                  errorCode: 'BACKEND_UNEXPECTED_EXIT',
                  eventName: 'backendProcess.unexpectedExit',
                  retryable: true,
                  sideEffectState: 'unknown',
                  stage: 'runtime',
                },
                options.operationalIdentity,
              ),
            );
            unexpectedExitCallback?.();
          }
        });
      });
    },
  };
}

function createE2eUtilityEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    EKY_E2E: '1',
    NODE_ENV: 'test',
  };
  for (const key of [
    'EKY_ELECTRON_E2E_RUN_ROOT',
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
    'WINDIR',
  ]) {
    const entry = Object.entries(process.env).find(
      ([sourceKey, value]) =>
        sourceKey.toLowerCase() === key.toLowerCase() && value !== undefined,
    );
    if (entry?.[1] !== undefined) {
      environment[key] = entry[1];
    }
  }
  return environment;
}
