import { utilityProcess, type UtilityProcess } from 'electron';

import type {
  DesktopBackendHandle,
  StartDesktopBackendOptions,
} from '../src/runtime/backendProcess.js';
import { waitForBackendShutdown } from '../src/runtime/backendShutdown.js';
import { createDesktopOperationalEvent } from '../src/observability/createDesktopOperationalEvent.js';
import type { ElectronE2eConfig } from './electronE2eConfig.js';
import {
  parseElectronE2eBackendStatus,
  readElectronE2eBackendFailureCode,
} from './electronE2eBackendStatus.js';

export interface ElectronE2eBackendController {
  getStartCount(): number;
  isRunning(): boolean;
  killUnexpectedly(): void;
  startBackend(
    options: StartDesktopBackendOptions,
  ): Promise<DesktopBackendHandle>;
}

const readinessTimeoutMilliseconds = 30_000;
const shutdownTimeoutMilliseconds = 3_000;

export function createElectronE2eBackendController(
  config: ElectronE2eConfig,
  runnerPath: string,
): ElectronE2eBackendController {
  let processHandle: UtilityProcess | undefined;
  let startCount = 0;

  return {
    getStartCount: () => startCount,
    isRunning: () => processHandle !== undefined,
    killUnexpectedly() {
      processHandle?.kill();
    },
    startBackend(options) {
      if (
        processHandle !== undefined ||
        options.config.runtimeSessionSecret !== config.backend.sessionSecret
      ) {
        throw new Error(
          'DESKTOP_SMOKE_E2E_BACKEND_CONTROLLER_BOUNDARY_FAILED',
        );
      }

      return new Promise((resolveStart, rejectStart) => {
        startCount += 1;
        options.operationalLogger?.write(
          createDesktopOperationalEvent(
            { eventName: 'backendProcess.starting' },
            options.operationalIdentity,
          ),
        );
        const child = utilityProcess.fork(runnerPath, [], {
          env: createE2eUtilityEnvironment(),
          serviceName: 'Eky E2E Fake Backend',
          stdio: 'ignore',
        });
        processHandle = child;
        let ready = false;
        let stopping = false;
        let unexpectedExitCallback: (() => void) | undefined;
        const timer = setTimeout(() => {
          child.kill();
          rejectStart(
            new Error('DESKTOP_SMOKE_E2E_BACKEND_READY_TIMEOUT_FAILED'),
          );
        }, readinessTimeoutMilliseconds);

        child.once('spawn', () => {
          child.postMessage(
            {
              config: options.config,
              configPath: config.backend.configPath,
              type: 'start',
            },
            [
              options.secretBrokerPort,
              options.invoicePdfArchiveBrokerPort,
              options.profileSnapshotBrokerPort,
            ],
          );
        });
        child.on('message', (value) => {
          const status = parseElectronE2eBackendStatus(value);
          if (status === undefined || ready) {
            return;
          }
          if (status.type === 'failed') {
            clearTimeout(timer);
            child.kill();
            rejectStart(
              new Error(readElectronE2eBackendFailureCode(status.stage)),
            );
            return;
          }
          if (status.port !== config.backend.port) {
            clearTimeout(timer);
            child.kill();
            rejectStart(
              new Error('DESKTOP_SMOKE_E2E_BACKEND_PORT_MISMATCH_FAILED'),
            );
            return;
          }

          ready = true;
          clearTimeout(timer);
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
            stopForUpdate() {
              return stopBackend(false);
            },
          });

          async function stopBackend(
            forceAfterTimeout: boolean,
          ): Promise<void> {
            if (stopping) {
              throw new Error('ELECTRON_E2E_BACKEND_STOP_ALREADY_STARTED');
            }
            stopping = true;
            child.postMessage({ type: 'shutdown' });
            await waitForBackendShutdown(child, {
              forceAfterTimeout,
              timeoutMilliseconds: shutdownTimeoutMilliseconds,
            });
          }
        });
        child.once('exit', () => {
          clearTimeout(timer);
          processHandle = undefined;
          if (!ready) {
            rejectStart(
              new Error(
                'DESKTOP_SMOKE_E2E_BACKEND_EXITED_BEFORE_READY_FAILED',
              ),
            );
            return;
          }
          if (!stopping) {
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
