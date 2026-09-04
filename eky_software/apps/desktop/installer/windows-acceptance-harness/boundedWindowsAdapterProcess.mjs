import { spawn } from 'node:child_process';

const MAX_TIMEOUT_MILLISECONDS = 600_000;

function requireTimeout(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_TIMEOUT_MILLISECONDS
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_ADAPTER_TIMEOUT_INVALID');
  }
}

export function runBoundedWindowsAdapterProcess({
  arguments: arguments_,
  command,
  cwd,
  spawnProcess = spawn,
  terminationTimeoutMilliseconds,
  timeoutMilliseconds,
}) {
  if (
    typeof command !== 'string' ||
    command.length < 1 ||
    command.includes('\0') ||
    !Array.isArray(arguments_) ||
    arguments_.some(
      (argument) =>
        typeof argument !== 'string' || argument.includes('\0'),
    ) ||
    typeof cwd !== 'string' ||
    cwd.length < 1 ||
    cwd.includes('\0')
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_ADAPTER_REQUEST_INVALID');
  }
  requireTimeout(timeoutMilliseconds);
  requireTimeout(terminationTimeoutMilliseconds);

  return new Promise((resolvePromise) => {
    let child;
    let deadlineTimer = null;
    let settled = false;
    let terminationTimer = null;
    let timedOut = false;

    function complete(result) {
      if (settled) {
        return;
      }
      settled = true;
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
      }
      if (terminationTimer !== null) {
        clearTimeout(terminationTimer);
      }
      resolvePromise(Object.freeze(result));
    }

    try {
      child = spawnProcess(command, arguments_, {
        cwd,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      complete({
        status: 'failed',
        resultCode: 'startFailed',
        exitCode: null,
        directProcessAbsent: true,
      });
      return;
    }

    child.once('error', () => {
      complete({
        status: 'failed',
        resultCode: 'startFailed',
        exitCode: null,
        directProcessAbsent: true,
      });
    });
    child.once('close', (exitCode, signal) => {
      if (timedOut) {
        complete({
          status: 'failed',
          resultCode: 'timedOut',
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          directProcessAbsent: true,
        });
        return;
      }
      if (signal !== null || !Number.isInteger(exitCode)) {
        complete({
          status: 'failed',
          resultCode: 'exitInvalid',
          exitCode: null,
          directProcessAbsent: true,
        });
        return;
      }
      complete({
        status: 'completed',
        resultCode: 'processCompleted',
        exitCode,
        directProcessAbsent: true,
      });
    });

    deadlineTimer = setTimeout(() => {
      timedOut = true;
      let terminationRequested = false;
      try {
        terminationRequested = child.kill();
      } catch {
        terminationRequested = false;
      }
      if (!terminationRequested) {
        complete({
          status: 'failed',
          resultCode: 'terminationFailed',
          exitCode: null,
          directProcessAbsent: false,
        });
        return;
      }
      terminationTimer = setTimeout(() => {
        complete({
          status: 'failed',
          resultCode: 'terminationUnconfirmed',
          exitCode: null,
          directProcessAbsent: false,
        });
      }, terminationTimeoutMilliseconds);
    }, timeoutMilliseconds);
  });
}
