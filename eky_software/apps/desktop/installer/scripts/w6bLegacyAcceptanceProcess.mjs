import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cleanupScriptPath = join(
  scriptDirectory,
  'stopW6bLegacyAcceptanceProcess.ps1',
);

export const W6B_LEGACY_ACCEPTANCE_TIMEOUT_MILLISECONDS = 18 * 60 * 1000;
export const W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS = 30_000;
export const W6B_LEGACY_ACCEPTANCE_HEARTBEAT_MILLISECONDS = 60_000;

const processContracts = Object.freeze({
  acceptance: Object.freeze({
    cleanupFailed: 'W6B_LEGACY_ACCEPTANCE_CLEANUP_FAILED',
    cleanupTimeout: 'W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT',
    operation: 'w6bLegacyAcceptance',
    processExitFailed: 'W6B_LEGACY_ACCEPTANCE_PROCESS_EXIT_FAILED',
    processStartFailed: 'W6B_LEGACY_ACCEPTANCE_PROCESS_START_FAILED',
    processTimeout: 'W6B_LEGACY_ACCEPTANCE_PROCESS_TIMEOUT',
  }),
  command: Object.freeze({
    cleanupFailed: 'W6B_LEGACY_COMMAND_CLEANUP_FAILED',
    cleanupTimeout: 'W6B_LEGACY_COMMAND_CLEANUP_TIMEOUT',
    operation: 'w6bLegacyCommandProcess',
    processExitFailed: 'W6B_LEGACY_COMMAND_PROCESS_EXIT_FAILED',
    processStartFailed: 'W6B_LEGACY_COMMAND_PROCESS_START_FAILED',
    processTimeout: 'W6B_LEGACY_COMMAND_PROCESS_TIMEOUT',
  }),
});
const processKinds = new Set(Object.keys(processContracts));
const allowedPhases = new Set([
  'command',
  'hostStarted',
  'hostIdentityCaptured',
  'waitStarted',
  'waitHeartbeat',
  'hostExited',
  'waitTimedOut',
  'cleanupStarted',
  'cleanupCompleted',
  'processTreeAbsent',
]);
const allowedStatuses = new Set([
  'started',
  'completed',
  'heartbeat',
  'failed',
]);
const safeErrorCodes = new Set([
  'W6B_LEGACY_ACCEPTANCE_CLEANUP_FAILED',
  'W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT',
  'W6B_LEGACY_ACCEPTANCE_PROCESS_EXIT_FAILED',
  'W6B_LEGACY_ACCEPTANCE_PROCESS_START_FAILED',
  'W6B_LEGACY_ACCEPTANCE_PROCESS_TIMEOUT',
  'W6B_LEGACY_COMMAND_CLEANUP_FAILED',
  'W6B_LEGACY_COMMAND_CLEANUP_TIMEOUT',
  'W6B_LEGACY_COMMAND_PROCESS_EXIT_FAILED',
  'W6B_LEGACY_COMMAND_PROCESS_START_FAILED',
  'W6B_LEGACY_COMMAND_PROCESS_TIMEOUT',
]);

const defaultDependencies = Object.freeze({
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  now: Date.now,
  observe: writeSafeObservation,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
  spawnProcess: spawn,
  terminateOwnedProcessTree,
});

export async function runW6bLegacyAcceptanceProcess(input, options = {}) {
  const dependencies = {
    ...defaultDependencies,
    ...(options.dependencies ?? {}),
  };
  const configuration = validateInput(input);
  const contract = processContracts[configuration.processKind];
  const startedAt = dependencies.now();
  const observe = (phase, status, errorCode) => {
    safelyObserve(dependencies.observe, {
      durationMs: Math.max(0, dependencies.now() - startedAt),
      elapsedMs: Math.max(0, dependencies.now() - startedAt),
      errorCode,
      operation: contract.operation,
      phase,
      status,
    });
  };

  observe('command', 'started');
  observe('hostStarted', 'started');
  let child;
  try {
    child = dependencies.spawnProcess(
      configuration.command,
      configuration.arguments,
      {
        cwd: configuration.cwd,
        env: { ...configuration.environment },
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
  } catch {
    observe('hostStarted', 'failed', contract.processStartFailed);
    observe('command', 'failed', contract.processStartFailed);
    throw new Error(contract.processStartFailed);
  }
  observe('hostStarted', 'completed');
  observe('hostIdentityCaptured', 'completed');
  observe('waitStarted', 'started');

  const terminal = await waitForTerminalProcess({
    child,
    clearInterval: dependencies.clearInterval,
    clearTimeout: dependencies.clearTimeout,
    heartbeatMilliseconds: configuration.heartbeatMilliseconds,
    observe,
    setInterval: dependencies.setInterval,
    setTimeout: dependencies.setTimeout,
    timeoutMilliseconds: configuration.timeoutMilliseconds,
  });
  let terminalErrorCode;
  if (terminal.kind === 'timeout') {
    terminalErrorCode = contract.processTimeout;
    observe('waitTimedOut', 'failed', terminalErrorCode);
  } else if (terminal.kind === 'startError') {
    terminalErrorCode = contract.processStartFailed;
    observe('hostExited', 'failed', terminalErrorCode);
  } else if (terminal.exitCode === 0 && terminal.signal === null) {
    observe('waitStarted', 'completed');
    observe('hostExited', 'completed');
  } else {
    terminalErrorCode = contract.processExitFailed;
    observe('hostExited', 'failed', terminalErrorCode);
  }

  try {
    await cleanupOwnedProcessTree({
      child,
      cleanupTimeoutMilliseconds: configuration.cleanupTimeoutMilliseconds,
      contract,
      observe,
      processKind: configuration.processKind,
      proofToken: configuration.proofToken,
      terminateOwnedProcessTree: dependencies.terminateOwnedProcessTree,
    });
  } catch (error) {
    terminalizeFailedOwnedProcessHandle(child);
    throw error;
  }

  if (terminalErrorCode !== undefined) {
    terminalizeFailedOwnedProcessHandle(child);
    observe('command', 'failed', terminalErrorCode);
    throw new Error(terminalErrorCode);
  }

  observe('command', 'completed');
  return Object.freeze({ exitCode: 0, status: 'completed' });
}

async function cleanupOwnedProcessTree(input) {
  input.observe('cleanupStarted', 'started');
  let result;
  try {
    result = await input.terminateOwnedProcessTree({
      cleanupTimeoutMilliseconds: input.cleanupTimeoutMilliseconds,
      processKind: input.processKind,
      processId: input.child?.pid,
      proofToken: input.proofToken,
    });
  } catch (error) {
    const errorCode =
      error instanceof Error &&
      error.message === input.contract.cleanupTimeout
        ? error.message
        : input.contract.cleanupFailed;
    input.observe('cleanupCompleted', 'failed', errorCode);
    input.observe('command', 'failed', errorCode);
    throw new Error(errorCode);
  }
  if (result?.status !== 'absent' && result?.status !== 'stopped') {
    input.observe('cleanupCompleted', 'failed', input.contract.cleanupFailed);
    input.observe('command', 'failed', input.contract.cleanupFailed);
    throw new Error(input.contract.cleanupFailed);
  }
  input.observe('cleanupCompleted', 'completed');
  input.observe('processTreeAbsent', 'completed');
}

export function terminalizeFailedOwnedProcessHandle(child) {
  if (child === undefined || child === null) return;
  try {
    child.once?.('error', () => undefined);
  } catch {
    // Exact tree cleanup remains authoritative.
  }
  try {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill?.();
    }
  } catch {
    // The original process or cleanup result remains authoritative.
  }
  try {
    child.unref?.();
  } catch {
    // The original process or cleanup result remains authoritative.
  }
}

function waitForTerminalProcess(input) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let heartbeat;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (heartbeat !== undefined) input.clearInterval(heartbeat);
      if (timer !== undefined) input.clearTimeout(timer);
      input.child.removeListener('error', onError);
      input.child.removeListener('exit', onExit);
      resolvePromise(result);
    };
    const onError = () => finish(Object.freeze({ kind: 'startError' }));
    const onExit = (exitCode, signal) =>
      finish(Object.freeze({ exitCode, kind: 'exit', signal }));
    input.child.once('error', onError);
    input.child.once('exit', onExit);
    heartbeat = input.setInterval(
      () => input.observe('waitHeartbeat', 'heartbeat'),
      input.heartbeatMilliseconds,
    );
    timer = input.setTimeout(
      () => finish(Object.freeze({ kind: 'timeout' })),
      input.timeoutMilliseconds,
    );
  });
}

function terminateOwnedProcessTree(input) {
  const contract = processContracts[input.processKind];
  if (
    !Number.isSafeInteger(input.processId) ||
    input.processId < 1 ||
    contract === undefined ||
    !/^[0-9a-f]{64}$/u.test(input.proofToken)
  ) {
    return Promise.reject(
      new Error(contract?.cleanupFailed ?? 'W6B_LEGACY_ACCEPTANCE_CLEANUP_FAILED'),
    );
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        cleanupScriptPath,
        '-RootProcessId',
        String(input.processId),
        '-ProofToken',
        input.proofToken,
        '-ProcessKind',
        input.processKind,
      ],
      {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    let settled = false;
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (error !== undefined) {
        rejectPromise(error);
        return;
      }
      resolvePromise(Object.freeze({ status: 'stopped' }));
    };
    const onError = () =>
      finish(new Error(contract.cleanupFailed));
    const onExit = (exitCode, signal) => {
      if (exitCode === 0 && signal === null) {
        finish();
        return;
      }
      finish(new Error(contract.cleanupFailed));
    };
    child.once('error', onError);
    child.once('exit', onExit);
    timer = globalThis.setTimeout(() => {
      terminalizeFailedOwnedProcessHandle(child);
      finish(new Error(contract.cleanupTimeout));
    }, input.cleanupTimeoutMilliseconds);
  });
}

function validateInput(input) {
  const processKind = input?.processKind ?? 'acceptance';
  if (
    typeof input?.command !== 'string' ||
    input.command === '' ||
    !Array.isArray(input.arguments) ||
    !input.arguments.every((value) => typeof value === 'string') ||
    typeof input.cwd !== 'string' ||
    input.cwd === '' ||
    typeof input.environment !== 'object' ||
    input.environment === null ||
    !processKinds.has(processKind) ||
    !/^[0-9a-f]{64}$/u.test(input.proofToken) ||
    !Number.isSafeInteger(input.timeoutMilliseconds) ||
    input.timeoutMilliseconds < 1 ||
    !Number.isSafeInteger(input.cleanupTimeoutMilliseconds) ||
    input.cleanupTimeoutMilliseconds < 1 ||
    !Number.isSafeInteger(input.heartbeatMilliseconds) ||
    input.heartbeatMilliseconds < 1 ||
    input.heartbeatMilliseconds >= input.timeoutMilliseconds
  ) {
    throw new Error('W6B_LEGACY_ACCEPTANCE_PROCESS_INPUT_INVALID');
  }
  return Object.freeze({ ...input, processKind });
}

function safelyObserve(observer, event) {
  if (
    !Object.values(processContracts).some(
      ({ operation }) => event.operation === operation,
    ) ||
    !allowedPhases.has(event.phase) ||
    !allowedStatuses.has(event.status) ||
    (event.errorCode !== undefined && !safeErrorCodes.has(event.errorCode))
  ) {
    return;
  }
  const safeEvent = {
    operation: event.operation,
    phase: event.phase,
    status: event.status,
    durationMs: event.durationMs,
    elapsedMs: event.elapsedMs,
    ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
  };
  try {
    observer(Object.freeze(safeEvent));
  } catch {
    // Observability is evidence only and cannot change the process result.
  }
}

function writeSafeObservation(event) {
  console.log(JSON.stringify(event));
}
