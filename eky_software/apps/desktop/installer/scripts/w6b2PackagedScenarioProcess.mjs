import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cleanupScriptPath = join(
  scriptDirectory,
  'stopW6b2PackagedScenarioProcess.ps1',
);

const scenarioKinds = new Set(['faultRollback', 'success']);

export const W6B2_PACKAGED_SCENARIO_TIMEOUT_MILLISECONDS = 12 * 60 * 1000;
export const W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT_MILLISECONDS = 30_000;

const operation = 'w6b2PackagedScenario';
const allowedPhases = new Set([
  'hostStarted',
  'hostIdentityCaptured',
  'waitStarted',
  'hostExited',
  'waitTimedOut',
  'cleanupStarted',
  'cleanupCompleted',
  'processTreeAbsent',
]);
const allowedStatuses = new Set(['started', 'completed', 'failed']);
const safeErrorCodes = new Set([
  'W6B2_PACKAGED_SCENARIO_CLEANUP_FAILED',
  'W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT',
  'W6B2_PACKAGED_SCENARIO_PROCESS_EXIT_FAILED',
  'W6B2_PACKAGED_SCENARIO_PROCESS_START_FAILED',
  'W6B2_PACKAGED_SCENARIO_PROCESS_TIMEOUT',
]);

const defaultDependencies = Object.freeze({
  clearTimeout: globalThis.clearTimeout,
  now: Date.now,
  observe: writeSafeObservation,
  setTimeout: globalThis.setTimeout,
  spawnProcess: spawn,
  terminateOwnedProcessTree,
});

export async function runW6b2PackagedScenarioProcess(input, options = {}) {
  const dependencies = {
    ...defaultDependencies,
    ...(options.dependencies ?? {}),
  };
  const configuration = validateInput(input);
  const startedAt = dependencies.now();
  const observe = (phase, status, errorCode) => {
    safelyObserve(dependencies.observe, {
      durationMs: Math.max(0, dependencies.now() - startedAt),
      elapsedMs: Math.max(0, dependencies.now() - startedAt),
      errorCode,
      operation,
      phase,
      status,
    });
  };

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
    observe(
      'hostStarted',
      'failed',
      'W6B2_PACKAGED_SCENARIO_PROCESS_START_FAILED',
    );
    throw new Error('W6B2_PACKAGED_SCENARIO_PROCESS_START_FAILED');
  }
  observe('hostStarted', 'completed');
  observe('hostIdentityCaptured', 'completed');
  observe('waitStarted', 'started');

  const terminal = await waitForTerminalProcess({
    child,
    clearTimeout: dependencies.clearTimeout,
    setTimeout: dependencies.setTimeout,
    timeoutMilliseconds: configuration.timeoutMilliseconds,
  });
  if (terminal.kind === 'timeout') {
    observe(
      'waitTimedOut',
      'failed',
      'W6B2_PACKAGED_SCENARIO_PROCESS_TIMEOUT',
    );
  } else if (terminal.kind === 'startError') {
    observe(
      'hostExited',
      'failed',
      'W6B2_PACKAGED_SCENARIO_PROCESS_START_FAILED',
    );
  } else if (terminal.exitCode === 0 && terminal.signal === null) {
    observe('waitStarted', 'completed');
    observe('hostExited', 'completed');
  } else {
    observe(
      'hostExited',
      'failed',
      'W6B2_PACKAGED_SCENARIO_PROCESS_EXIT_FAILED',
    );
  }

  const terminalErrorCode = resolveTerminalErrorCode(terminal);
  let cleanupError;
  try {
    await cleanupOwnedProcessTree({
      child,
      cleanupTimeoutMilliseconds: configuration.cleanupTimeoutMilliseconds,
      observe,
      proofToken: configuration.proofToken,
      scenarioKind: configuration.scenarioKind,
      terminateOwnedProcessTree: dependencies.terminateOwnedProcessTree,
    });
  } catch (error) {
    cleanupError = error;
  }

  if (terminalErrorCode !== undefined) {
    throw new Error(terminalErrorCode);
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }

  return Object.freeze({ exitCode: 0, status: 'completed' });
}

function resolveTerminalErrorCode(terminal) {
  if (terminal.kind === 'timeout') {
    return 'W6B2_PACKAGED_SCENARIO_PROCESS_TIMEOUT';
  }
  if (terminal.kind === 'startError') {
    return 'W6B2_PACKAGED_SCENARIO_PROCESS_START_FAILED';
  }
  if (terminal.exitCode !== 0 || terminal.signal !== null) {
    return 'W6B2_PACKAGED_SCENARIO_PROCESS_EXIT_FAILED';
  }
  return undefined;
}

async function cleanupOwnedProcessTree(input) {
  input.observe('cleanupStarted', 'started');
  let result;
  try {
    result = await input.terminateOwnedProcessTree({
      cleanupTimeoutMilliseconds: input.cleanupTimeoutMilliseconds,
      processId: input.child?.pid,
      proofToken: input.proofToken,
      scenarioKind: input.scenarioKind,
    });
  } catch (error) {
    const errorCode =
      error instanceof Error &&
      error.message === 'W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT'
        ? error.message
        : 'W6B2_PACKAGED_SCENARIO_CLEANUP_FAILED';
    input.observe('cleanupCompleted', 'failed', errorCode);
    throw new Error(errorCode);
  }
  if (result?.status !== 'absent' && result?.status !== 'stopped') {
    input.observe(
      'cleanupCompleted',
      'failed',
      'W6B2_PACKAGED_SCENARIO_CLEANUP_FAILED',
    );
    throw new Error('W6B2_PACKAGED_SCENARIO_CLEANUP_FAILED');
  }
  input.observe('cleanupCompleted', 'completed');
  input.observe('processTreeAbsent', 'completed');
}

function waitForTerminalProcess(input) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
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
    timer = input.setTimeout(
      () => finish(Object.freeze({ kind: 'timeout' })),
      input.timeoutMilliseconds,
    );
  });
}

function terminateOwnedProcessTree(input) {
  if (
    !Number.isSafeInteger(input.processId) ||
    input.processId < 1 ||
    !/^[0-9a-f]{64}$/u.test(input.proofToken) ||
    !scenarioKinds.has(input.scenarioKind)
  ) {
    return Promise.reject(
      new Error('W6B2_PACKAGED_SCENARIO_CLEANUP_FAILED'),
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
        '-ScenarioKind',
        input.scenarioKind,
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
      finish(new Error('W6B2_PACKAGED_SCENARIO_CLEANUP_FAILED'));
    const onExit = (exitCode, signal) => {
      if (exitCode === 0 && signal === null) {
        finish();
        return;
      }
      finish(new Error('W6B2_PACKAGED_SCENARIO_CLEANUP_FAILED'));
    };
    child.once('error', onError);
    child.once('exit', onExit);
    timer = globalThis.setTimeout(() => {
      child.kill();
      finish(new Error('W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT'));
    }, input.cleanupTimeoutMilliseconds);
  });
}

function validateInput(input) {
  if (
    typeof input?.command !== 'string' ||
    input.command === '' ||
    !Array.isArray(input.arguments) ||
    !input.arguments.every((value) => typeof value === 'string') ||
    typeof input.cwd !== 'string' ||
    input.cwd === '' ||
    typeof input.environment !== 'object' ||
    input.environment === null ||
    !/^[0-9a-f]{64}$/u.test(input.proofToken) ||
    !scenarioKinds.has(input.scenarioKind) ||
    !Number.isSafeInteger(input.timeoutMilliseconds) ||
    input.timeoutMilliseconds < 1 ||
    !Number.isSafeInteger(input.cleanupTimeoutMilliseconds) ||
    input.cleanupTimeoutMilliseconds < 1
  ) {
    throw new Error('W6B2_PACKAGED_SCENARIO_INPUT_INVALID');
  }
  return Object.freeze({ ...input });
}

function safelyObserve(observer, event) {
  if (
    event.operation !== operation ||
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
    // Test observability cannot change the scenario result.
  }
}

function writeSafeObservation(event) {
  console.log(JSON.stringify(event));
}
