import {
  utilityProcess,
  type MessagePortMain,
  type UtilityProcess,
} from 'electron';

import {
  parseDesktopBackendStatus,
  type DesktopBackendStartMessage,
} from './backendMessages.js';
import { createDesktopBackendEnvironment } from './backendEnvironment.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import {
  noOpDesktopOperationalLogger,
  type DesktopOperationalLogger,
} from '../observability/desktopOperationalLogger.js';

const backendReadinessTimeoutMilliseconds = 30_000;
const backendShutdownTimeoutMilliseconds = 3_000;

export interface StartDesktopBackendOptions {
  appVersion?: string;
  config: DesktopBackendStartMessage['config'];
  operationalLogger?: DesktopOperationalLogger;
  runnerPath: string;
  secretBrokerPort: MessagePortMain;
}

export interface DesktopBackendHandle {
  onUnexpectedExit(callback: () => void): void;
  port: number;
  stop(): Promise<void>;
}

function waitForExit(
  processHandle: UtilityProcess,
  timeout: number,
): Promise<'exited' | 'killedAfterTimeout'> {
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      processHandle.kill();
      resolveExit('killedAfterTimeout');
    }, timeout);

    processHandle.once('exit', () => {
      clearTimeout(timer);
      resolveExit('exited');
    });
  });
}

export function startDesktopBackend(
  options: StartDesktopBackendOptions,
): Promise<DesktopBackendHandle> {
  const appVersion = options.appVersion ?? '0.0.0';
  const operationalLogger =
    options.operationalLogger ?? noOpDesktopOperationalLogger;
  const startedAt = Date.now();
  operationalLogger.write(
    createDesktopOperationalEvent(
      { eventName: 'backendProcess.starting' },
      { appVersion },
    ),
  );

  return new Promise((resolveStart, rejectStart) => {
    const processHandle = utilityProcess.fork(options.runnerPath, [], {
      env: createDesktopBackendEnvironment(),
      serviceName: 'Eky Local Backend',
      stdio: 'ignore',
    });
    let ready = false;
    let stopping = false;
    let unexpectedExitCallback: (() => void) | undefined;
    const readinessTimer = setTimeout(() => {
      processHandle.kill();
      operationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - startedAt,
            errorCode: 'BACKEND_READINESS_TIMEOUT',
            eventName: 'backendProcess.healthFailed',
            retryable: true,
            sideEffectState: 'unknown',
            stage: 'readiness',
          },
          { appVersion },
        ),
      );
      rejectStart(new Error('BACKEND_READINESS_TIMEOUT'));
    }, backendReadinessTimeoutMilliseconds);

    processHandle.once('spawn', () => {
      processHandle.postMessage(
        { config: options.config, type: 'start' },
        [options.secretBrokerPort],
      );
    });
    processHandle.on('message', (value) => {
      const status = parseDesktopBackendStatus(value);

      if (status === undefined || ready) {
        return;
      }

      if (status.type === 'failed') {
        clearTimeout(readinessTimer);
        processHandle.kill();
        operationalLogger.write(
          createDesktopOperationalEvent(
            {
              durationMs: Date.now() - startedAt,
              errorCode: status.code,
              eventName: 'backendProcess.healthFailed',
              retryable: false,
              sideEffectState: 'unknown',
              stage: 'startup',
            },
            { appVersion },
          ),
        );
        rejectStart(new Error(status.code));
        return;
      }

      ready = true;
      clearTimeout(readinessTimer);
      operationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - startedAt,
            eventName: 'backendProcess.started',
          },
          { appVersion },
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
          const stopStartedAt = Date.now();
          processHandle.postMessage({ type: 'shutdown' });
          const exitOutcome = await waitForExit(
            processHandle,
            backendShutdownTimeoutMilliseconds,
          );
          if (exitOutcome === 'killedAfterTimeout') {
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
                { appVersion },
              ),
            );
          }
        },
      });
    });
    processHandle.once('exit', () => {
      clearTimeout(readinessTimer);

      if (!ready) {
        operationalLogger.write(
          createDesktopOperationalEvent(
            {
              durationMs: Date.now() - startedAt,
              errorCode: 'BACKEND_EXITED_BEFORE_READY',
              eventName: 'backendProcess.unexpectedExit',
              retryable: true,
              sideEffectState: 'unknown',
              stage: 'startup',
            },
            { appVersion },
          ),
        );
        rejectStart(new Error('BACKEND_EXITED_BEFORE_READY'));
        return;
      }

      if (!stopping) {
        operationalLogger.write(
          createDesktopOperationalEvent(
            {
              errorCode: 'BACKEND_UNEXPECTED_EXIT',
              eventName: 'backendProcess.unexpectedExit',
              retryable: true,
              sideEffectState: 'unknown',
              stage: 'runtime',
            },
            { appVersion },
          ),
        );
        unexpectedExitCallback?.();
      }
    });
  });
}
