import { utilityProcess, type UtilityProcess } from 'electron';

import type {
  DesktopBackendHandle,
  StartDesktopBackendOptions,
} from '../src/runtime/backendProcess.js';
import { createDesktopOperationalEvent } from '../src/observability/createDesktopOperationalEvent.js';
import type { ElectronE2eConfig } from './electronE2eConfig.js';

interface E2eBackendStatus {
  code?: string;
  port?: number;
  type: 'failed' | 'ready';
}

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
        throw new Error('ELECTRON_E2E_BACKEND_BOUNDARY_INVALID');
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
          rejectStart(new Error('ELECTRON_E2E_BACKEND_TIMEOUT'));
        }, readinessTimeoutMilliseconds);

        child.once('spawn', () => {
          child.postMessage(
            {
              configPath: config.backend.configPath,
              runtimeInstanceId: config.runtimeInstanceId,
              type: 'start',
            },
            [
              options.secretBrokerPort,
              options.invoicePdfArchiveBrokerPort,
            ],
          );
        });
        child.on('message', (value) => {
          const status = parseE2eBackendStatus(value);
          if (status === undefined || ready) {
            return;
          }
          if (status.type === 'failed') {
            clearTimeout(timer);
            child.kill();
            rejectStart(
              new Error(status.code ?? 'ELECTRON_E2E_BACKEND_FAILED'),
            );
            return;
          }
          if (status.port !== config.backend.port) {
            clearTimeout(timer);
            child.kill();
            rejectStart(new Error('ELECTRON_E2E_BACKEND_PORT_MISMATCH'));
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
            async stop() {
              if (stopping) {
                return;
              }
              stopping = true;
              child.postMessage({ type: 'shutdown' });
              await waitForExit(child, shutdownTimeoutMilliseconds);
            },
          });
        });
        child.once('exit', () => {
          clearTimeout(timer);
          processHandle = undefined;
          if (!ready) {
            rejectStart(new Error('ELECTRON_E2E_BACKEND_EXITED'));
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

function parseE2eBackendStatus(value: unknown): E2eBackendStatus | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === 'ready' &&
    typeof record.port === 'number' &&
    Number.isSafeInteger(record.port)
  ) {
    return { port: record.port, type: 'ready' };
  }
  if (record.type === 'failed' && typeof record.code === 'string') {
    return { code: record.code, type: 'failed' };
  }
  return undefined;
}

function waitForExit(
  child: UtilityProcess,
  timeoutMilliseconds: number,
): Promise<void> {
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill();
      resolveExit();
    }, timeoutMilliseconds);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}
