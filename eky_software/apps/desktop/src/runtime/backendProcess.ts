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
import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import {
  noOpDesktopOperationalLogger,
  type DesktopOperationalLogger,
} from '../observability/desktopOperationalLogger.js';
import { waitForBackendShutdown } from './backendShutdown.js';

const backendReadinessTimeoutMilliseconds = 30_000;
const backendMigrationGateTimeoutMilliseconds = 5 * 60_000;
const backendShutdownTimeoutMilliseconds = 3_000;

export interface StartDesktopBackendOptions {
  beforeMigrations(inspection: {
    appliedMigrationCount: number;
    migrationChainIdentity: string;
    pendingMigrationCount: number;
    profileState: 'empty' | 'existing';
  }): Promise<void>;
  config: DesktopBackendStartMessage['config'];
  invoicePdfArchiveBrokerPort: MessagePortMain;
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger?: DesktopOperationalLogger;
  profileSnapshotBrokerPort: MessagePortMain;
  runnerPath: string;
  secretBrokerPort: MessagePortMain;
}

export interface DesktopBackendHandle {
  onUnexpectedExit(callback: () => void): void;
  port: number;
  stop(): Promise<void>;
  stopForUpdate(): Promise<void>;
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
    const processHandle = utilityProcess.fork(options.runnerPath, [], {
      env: createDesktopBackendEnvironment(),
      serviceName: 'Eky Local Backend',
      stdio: 'ignore',
    });
    let ready = false;
    let stopping = false;
    let unexpectedExitCallback: (() => void) | undefined;
    const handleReadinessTimeout = () => {
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
          options.operationalIdentity,
        ),
      );
      rejectStart(new Error('BACKEND_READINESS_TIMEOUT'));
    };
    let readinessTimer = setTimeout(
      handleReadinessTimeout,
      backendReadinessTimeoutMilliseconds,
    );
    let migrationGatePending = false;

    processHandle.once('spawn', () => {
      processHandle.postMessage(
        { config: options.config, type: 'start' },
        [
          options.secretBrokerPort,
          options.invoicePdfArchiveBrokerPort,
          options.profileSnapshotBrokerPort,
        ],
      );
    });
    processHandle.on('message', (value) => {
      const status = parseDesktopBackendStatus(value);

      if (status === undefined || ready) {
        return;
      }

      if (status.type === 'migrationGateReady') {
        if (migrationGatePending) {
          processHandle.postMessage({ type: 'abortStartup' });
          return;
        }
        migrationGatePending = true;
        clearTimeout(readinessTimer);
        readinessTimer = setTimeout(
          handleReadinessTimeout,
          backendMigrationGateTimeoutMilliseconds,
        );
        void options
          .beforeMigrations(status.inspection)
          .then(() => {
            if (!migrationGatePending || ready) {
              return;
            }
            migrationGatePending = false;
            clearTimeout(readinessTimer);
            readinessTimer = setTimeout(
              handleReadinessTimeout,
              backendReadinessTimeoutMilliseconds,
            );
            processHandle.postMessage({ type: 'continueStartup' });
          })
          .catch(() => {
            if (!migrationGatePending || ready) {
              return;
            }
            migrationGatePending = false;
            processHandle.postMessage({ type: 'abortStartup' });
          });
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
            options.operationalIdentity,
          ),
        );
        rejectStart(new Error(status.code));
        return;
      }

      migrationGatePending = false;
      ready = true;
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
        stopForUpdate() {
          return stopBackend(false);
        },
      });

      async function stopBackend(forceAfterTimeout: boolean): Promise<void> {
        if (stopping) {
          throw new Error('BACKEND_STOP_ALREADY_STARTED');
        }

        stopping = true;
        const stopStartedAt = Date.now();
        processHandle.postMessage({ type: 'shutdown' });
        const exitOutcome = await waitForBackendShutdown(processHandle, {
          forceAfterTimeout,
          timeoutMilliseconds: backendShutdownTimeoutMilliseconds,
        });
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
      }
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
            options.operationalIdentity,
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
            options.operationalIdentity,
          ),
        );
        unexpectedExitCallback?.();
      }
    });
  });
}
