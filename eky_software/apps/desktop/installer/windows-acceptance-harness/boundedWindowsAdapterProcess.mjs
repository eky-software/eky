import { spawn } from 'node:child_process';

const MAX_TIMEOUT_MILLISECONDS = 725_000;

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
  now = () => performance.now(),
  observe = () => {},
  signal,
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
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new Error('WINDOWS_ACCEPTANCE_ADAPTER_REQUEST_INVALID');
  }
  if (signal?.aborted) {
    return Promise.resolve(Object.freeze({
      status: 'failed', resultCode: 'cancelled', exitCode: null, directProcessAbsent: true,
    }));
  }
  const deadline = now() + timeoutMilliseconds;
  const notify = (phase, status) => {
    try { observe(phase, status); } catch { /* Observations do not settle ownership. */ }
  };

  return new Promise((resolvePromise) => {
    let child;
    let deadlineTimer = null;
    let settled = false;
    let terminationTimer = null;
    let timedOut = false;
    let started = false;
    let processError = false;
    let startRejected = false;
    let terminationStarted = false;
    let cancelled = false;

    function complete(result) {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', cancel);
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
      }
      if (terminationTimer !== null) {
        clearTimeout(terminationTimer);
      }
      if (!result.directProcessAbsent) child?.unref?.();
      resolvePromise(Object.freeze(result));
    }

    function terminateDirectProcess() {
      if (settled || terminationStarted) {
        return;
      }
      terminationStarted = true;
      let terminationRequested = false;
      notify('termination', 'started');
      try {
        terminationRequested = child.kill();
      } catch { /* Only close can confirm absence after a failed signal. */ }
      notify('termination', terminationRequested ? 'completed' : 'failed');
      if (settled) {
        return;
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
    }

    function cancel() {
      cancelled = true;
      terminateDirectProcess();
    }

    try {
      notify('launch', 'started');
      child = spawnProcess(command, arguments_, {
        cwd,
        stdio: 'ignore',
        windowsHide: true,
      });
      notify('launch', 'completed');
    } catch {
      notify('launch', 'failed');
      complete({
        status: 'failed',
        resultCode: 'startFailed',
        exitCode: null,
        directProcessAbsent: true,
      });
      return;
    }

    started = Number.isInteger(child.pid);
    child.once('spawn', () => { started = true; notify('spawn', 'completed'); });
    child.on('error', () => {
      if (settled) {
        return;
      }
      if (!started && !Number.isInteger(child.pid) && child.spawnPending !== true && !terminationStarted) {
        startRejected = true;
        return;
      }
      // Node also emits error for failed kill/send operations on a live child.
      // Retain the exact ChildProcess handle; an error is not an exit receipt.
      processError = true;
      terminateDirectProcess();
    });
    child.once('close', (exitCode, signal) => {
      if (startRejected && !timedOut && !cancelled) {
        complete({ status: 'failed', resultCode: 'startFailed', exitCode: null, directProcessAbsent: true });
        return;
      }
      if (timedOut) {
        complete({
          status: 'failed',
          resultCode: 'timedOut',
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          directProcessAbsent: true,
        });
        return;
      }
      if (processError) {
        complete({
          status: 'failed',
          resultCode: 'processError',
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          directProcessAbsent: true,
        });
        return;
      }
      if (cancelled) {
        complete({
          status: 'failed', resultCode: 'cancelled',
          exitCode: Number.isInteger(exitCode) ? exitCode : null, directProcessAbsent: true,
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

    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    if (settled || terminationStarted) return;

    function expireDeadline() {
      timedOut = true;
      notify('deadline', 'failed');
      terminateDirectProcess();
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      expireDeadline();
    } else {
      deadlineTimer = setTimeout(expireDeadline, remaining);
      notify('deadline', 'started');
    }
  });
}
