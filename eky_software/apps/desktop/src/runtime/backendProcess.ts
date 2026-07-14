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

const backendReadinessTimeoutMilliseconds = 30_000;
const backendShutdownTimeoutMilliseconds = 3_000;

export interface StartDesktopBackendOptions {
  config: DesktopBackendStartMessage['config'];
  runnerPath: string;
  secretBrokerPort: MessagePortMain;
}

export interface DesktopBackendHandle {
  onUnexpectedExit(callback: () => void): void;
  port: number;
  stop(): Promise<void>;
}

function waitForExit(processHandle: UtilityProcess, timeout: number): Promise<void> {
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      processHandle.kill();
      resolveExit();
    }, timeout);

    processHandle.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

export function startDesktopBackend(
  options: StartDesktopBackendOptions,
): Promise<DesktopBackendHandle> {
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
        rejectStart(new Error(status.code));
        return;
      }

      ready = true;
      clearTimeout(readinessTimer);
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
          processHandle.postMessage({ type: 'shutdown' });
          await waitForExit(processHandle, backendShutdownTimeoutMilliseconds);
        },
      });
    });
    processHandle.once('exit', () => {
      clearTimeout(readinessTimer);

      if (!ready) {
        rejectStart(new Error('BACKEND_EXITED_BEFORE_READY'));
        return;
      }

      if (!stopping) {
        unexpectedExitCallback?.();
      }
    });
  });
}
