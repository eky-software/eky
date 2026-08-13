import { spawn } from 'node:child_process';

export const packagedUpdateTerminationOutcomes = Object.freeze([
  'notRequired',
  'alreadyExited',
  'terminated',
  'remains',
  'failed',
]);

const terminationOutcomeSet = new Set(packagedUpdateTerminationOutcomes);
const defaultCaptureLimitBytes = 64 * 1024;

export function createPackagedUpdateProcessRunner({
  clearTimeoutFn = clearTimeout,
  setTimeoutFn = setTimeout,
  spawnProcess = spawn,
} = {}) {
  return Object.freeze({ capture, run });

  function run(command, args, options) {
    return execute(command, args, { ...options, captureOutput: false });
  }

  function capture(command, args, options) {
    return execute(command, args, {
      ...options,
      captureOutput: true,
      maxOutputBytes:
        options?.maxOutputBytes ?? defaultCaptureLimitBytes,
    });
  }

  function execute(command, args, options) {
    requireInvocation(command, args, options);
    let child;
    try {
      child = spawnProcess(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: options.captureOutput
          ? ['ignore', 'pipe', 'ignore']
          : 'ignore',
        windowsHide: true,
      });
    } catch {
      return Promise.reject(
        new Error('PACKAGED_UPDATE_E2E_PROCESS_START_FAILED'),
      );
    }

    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let timeout;
      let outputBytes = 0;
      const outputChunks = [];

      const claimTerminalState = () => {
        if (settled) {
          return false;
        }
        settled = true;
        if (timeout !== undefined) {
          clearTimeoutFn(timeout);
        }
        return true;
      };

      const rejectAfterTermination = async (errorCode) => {
        const terminationOutcome = await terminateSafely(
          options.terminateProcess,
          child,
        );
        rejectPromise(createProcessError(errorCode, terminationOutcome));
      };

      timeout = setTimeoutFn(() => {
        if (!claimTerminalState()) {
          return;
        }
        void rejectAfterTermination('PACKAGED_UPDATE_E2E_PROCESS_TIMEOUT');
      }, options.timeoutMs);
      timeout?.unref?.();

      if (options.captureOutput) {
        child.stdout.on('data', (chunk) => {
          if (settled) {
            return;
          }
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          outputBytes += buffer.length;
          if (outputBytes > options.maxOutputBytes) {
            if (claimTerminalState()) {
              void rejectAfterTermination(
                'PACKAGED_UPDATE_E2E_PROCESS_OUTPUT_LIMIT',
              );
            }
            return;
          }
          outputChunks.push(buffer);
        });
      }

      child.once('error', () => {
        if (!claimTerminalState()) {
          return;
        }
        rejectPromise(new Error('PACKAGED_UPDATE_E2E_PROCESS_START_FAILED'));
      });
      child.once('exit', (code, signal) => {
        if (!claimTerminalState()) {
          return;
        }
        if (options.captureOutput) {
          if (code === 0 && signal === null) {
            resolvePromise(Buffer.concat(outputChunks).toString('utf8'));
          } else {
            rejectPromise(new Error('PACKAGED_UPDATE_E2E_PROCESS_FAILED'));
          }
          return;
        }
        resolvePromise({ code: code ?? -1, signal });
      });
    });
  }
}

function requireInvocation(command, args, options) {
  if (
    typeof command !== 'string' ||
    command.length < 1 ||
    !Array.isArray(args) ||
    !options ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    typeof options.terminateProcess !== 'function' ||
    (options.captureOutput &&
      (!Number.isSafeInteger(options.maxOutputBytes) ||
        options.maxOutputBytes < 1))
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_PROCESS_ARGUMENTS_INVALID');
  }
}

async function terminateSafely(terminateProcess, child) {
  try {
    const outcome = await terminateProcess(child);
    return terminationOutcomeSet.has(outcome) ? outcome : 'failed';
  } catch {
    return 'failed';
  }
}

function createProcessError(errorCode, terminationOutcome) {
  const error = new Error(errorCode);
  Object.defineProperty(error, 'terminationOutcome', {
    configurable: false,
    enumerable: true,
    value: terminationOutcome,
    writable: false,
  });
  return error;
}
