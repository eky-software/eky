import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseW6b2PackagedFaultCliArguments } from './runW6b2PackagedFaultRollback.mjs';
import { parseW6b2PackagedSuccessCliArguments } from './runW6b2PackagedSuccess.mjs';
import {
  W6B2_PACKAGED_FAULT_COMMAND_TIMEOUT_MILLISECONDS,
  W6B2_PACKAGED_FAULT_FULL_COMMAND_TIMEOUT_MILLISECONDS,
} from './w6b2PackagedFaultCommandLifecycle.mjs';
import {
  W6B2_PACKAGED_SUCCESS_COMMAND_TIMEOUT_MILLISECONDS,
  W6B2_PACKAGED_SUCCESS_FULL_COMMAND_TIMEOUT_MILLISECONDS,
} from './w6b2PackagedSuccessCommandLifecycle.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..', '..', '..');
const workerScriptPath = join(
  scriptDirectory,
  'w6b2PackagedCommandWorker.mjs',
);
const cleanupScriptPath = join(
  scriptDirectory,
  'stopW6b2PackagedCommandProcess.ps1',
);

export const W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT_MILLISECONDS = 30_000;
export const W6B2_PACKAGED_COMMAND_HEARTBEAT_MILLISECONDS = 60_000;

const operation = 'w6b2PackagedCommandProcess';
const commandKinds = new Set(['faultRollback', 'success']);
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
  'W6B2_PACKAGED_COMMAND_CLEANUP_FAILED',
  'W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT',
  'W6B2_PACKAGED_COMMAND_PROCESS_EXIT_FAILED',
  'W6B2_PACKAGED_COMMAND_PROCESS_START_FAILED',
  'W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT',
]);

const defaultDependencies = Object.freeze({
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  createProofToken: () => randomBytes(32).toString('hex'),
  now: Date.now,
  observe: writeSafeObservation,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
  spawnProcess: spawn,
  connectProcessOutput: connectOwnedProcessOutput,
  terminateOwnedProcessTree,
});

export async function runW6b2PackagedCommand(
  arguments_,
  options = {},
) {
  const dependencies = {
    ...defaultDependencies,
    ...(options.dependencies ?? {}),
  };
  const configuration = parseCommandArguments(arguments_);
  const proofToken = dependencies.createProofToken();
  if (!/^[0-9a-f]{64}$/u.test(proofToken)) {
    throw new Error('W6B2_PACKAGED_COMMAND_PROOF_TOKEN_INVALID');
  }
  return runOwnedCommandProcess(
    {
      arguments: [
        workerScriptPath,
        `--kind=${configuration.commandKind}`,
        `--process-proof-token=${proofToken}`,
        ...configuration.scenarioArguments,
      ],
      cleanupTimeoutMilliseconds:
        W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT_MILLISECONDS,
      command: process.execPath,
      commandKind: configuration.commandKind,
      cwd: repositoryRoot,
      environment: process.env,
      heartbeatMilliseconds:
        W6B2_PACKAGED_COMMAND_HEARTBEAT_MILLISECONDS,
      proofToken,
      timeoutMilliseconds: configuration.timeoutMilliseconds,
    },
    dependencies,
  );
}

export function parseW6b2PackagedCommandArguments(arguments_) {
  return parseCommandArguments(arguments_);
}

async function runOwnedCommandProcess(configuration, dependencies) {
  const startedAt = dependencies.now();
  const observe = (phase, status, errorCode) => {
    safelyObserve(dependencies.observe, {
      commandKind: configuration.commandKind,
      durationMs: Math.max(0, dependencies.now() - startedAt),
      elapsedMs: Math.max(0, dependencies.now() - startedAt),
      errorCode,
      operation,
      phase,
      status,
    });
  };

  observe('command', 'started');
  observe('hostStarted', 'started');
  let child;
  let disconnectProcessOutput = () => undefined;
  try {
    child = dependencies.spawnProcess(
      configuration.command,
      configuration.arguments,
      {
        cwd: configuration.cwd,
        env: { ...configuration.environment },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    disconnectProcessOutput = dependencies.connectProcessOutput(child);
  } catch {
    const errorCode = 'W6B2_PACKAGED_COMMAND_PROCESS_START_FAILED';
    observe('hostStarted', 'failed', errorCode);
    observe('command', 'failed', errorCode);
    throw new Error(errorCode);
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
    terminalErrorCode = 'W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT';
    observe('waitTimedOut', 'failed', terminalErrorCode);
  } else if (terminal.kind === 'startError') {
    terminalErrorCode = 'W6B2_PACKAGED_COMMAND_PROCESS_START_FAILED';
    observe('hostExited', 'failed', terminalErrorCode);
  } else if (terminal.exitCode === 0 && terminal.signal === null) {
    observe('waitStarted', 'completed');
    observe('hostExited', 'completed');
  } else {
    terminalErrorCode = 'W6B2_PACKAGED_COMMAND_PROCESS_EXIT_FAILED';
    observe('hostExited', 'failed', terminalErrorCode);
  }

  let cleanupErrorCode;
  try {
    await cleanupOwnedProcessTree({
      child,
      cleanupTimeoutMilliseconds: configuration.cleanupTimeoutMilliseconds,
      commandKind: configuration.commandKind,
      observe,
      proofToken: configuration.proofToken,
      terminateOwnedProcessTree: dependencies.terminateOwnedProcessTree,
    });
  } catch (error) {
    cleanupErrorCode = resolveCleanupErrorCode(error);
  }

  const primaryErrorCode = terminalErrorCode ?? cleanupErrorCode;
  if (primaryErrorCode !== undefined) {
    terminalizeFailedOwnedProcessHandle(child);
  }
  disconnectProcessOutput();

  if (primaryErrorCode !== undefined) {
    observe('command', 'failed', primaryErrorCode);
    throw new Error(primaryErrorCode);
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
      commandKind: input.commandKind,
      processId: input.child?.pid,
      proofToken: input.proofToken,
    });
  } catch (error) {
    const errorCode = resolveCleanupErrorCode(error);
    input.observe('cleanupCompleted', 'failed', errorCode);
    throw new Error(errorCode);
  }
  if (result?.status !== 'absent' && result?.status !== 'stopped') {
    const errorCode = 'W6B2_PACKAGED_COMMAND_CLEANUP_FAILED';
    input.observe('cleanupCompleted', 'failed', errorCode);
    throw new Error(errorCode);
  }
  input.observe('cleanupCompleted', 'completed');
  input.observe('processTreeAbsent', 'completed');
}

function resolveCleanupErrorCode(error) {
  return error instanceof Error &&
    error.message === 'W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT'
    ? error.message
    : 'W6B2_PACKAGED_COMMAND_CLEANUP_FAILED';
}

export function terminalizeFailedOwnedProcessHandle(child) {
  if (child === undefined || child === null) return;
  try {
    child.once?.('error', () => undefined);
  } catch {
    // The direct child handle is still released below when possible.
  }
  try {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill?.();
    }
  } catch {
    // Exact tree cleanup remains the authority; this only terminalizes the host.
  }
  try {
    child.unref?.();
  } catch {
    // The original cleanup error remains the terminal command result.
  }
}

function waitForTerminalProcess(input) {
  return new Promise((resolvePromise) => {
    let heartbeat;
    let settled = false;
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

function connectOwnedProcessOutput(child) {
  const connections = [
    [child?.stdout, process.stdout],
    [child?.stderr, process.stderr],
  ].filter(([source]) => source !== undefined && source !== null);
  for (const [source, destination] of connections) {
    source.pipe(destination, { end: false });
  }
  let disconnected = false;
  return () => {
    if (disconnected) return;
    disconnected = true;
    for (const [source, destination] of connections) {
      try {
        source.unpipe(destination);
      } catch {
        // Exact process cleanup remains authoritative.
      }
      try {
        source.destroy();
      } catch {
        // Output release must not replace the process result.
      }
    }
  };
}

function terminateOwnedProcessTree(input) {
  if (
    !Number.isSafeInteger(input.processId) ||
    input.processId < 1 ||
    !commandKinds.has(input.commandKind) ||
    !/^[0-9a-f]{64}$/u.test(input.proofToken)
  ) {
    return Promise.reject(
      new Error('W6B2_PACKAGED_COMMAND_CLEANUP_FAILED'),
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
        '-CommandKind',
        input.commandKind,
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
      finish(new Error('W6B2_PACKAGED_COMMAND_CLEANUP_FAILED'));
    const onExit = (exitCode, signal) => {
      if (exitCode === 0 && signal === null) {
        finish();
        return;
      }
      finish(new Error('W6B2_PACKAGED_COMMAND_CLEANUP_FAILED'));
    };
    child.once('error', onError);
    child.once('exit', onExit);
    timer = globalThis.setTimeout(() => {
      terminalizeFailedOwnedProcessHandle(child);
      finish(new Error('W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT'));
    }, input.cleanupTimeoutMilliseconds);
  });
}

function parseCommandArguments(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.length < 1) {
    throw new Error('W6B2_PACKAGED_COMMAND_ARGUMENTS_INVALID');
  }
  const commandKind = arguments_[0]?.slice('--kind='.length);
  if (
    !arguments_[0]?.startsWith('--kind=') ||
    !commandKinds.has(commandKind)
  ) {
    throw new Error('W6B2_PACKAGED_COMMAND_ARGUMENTS_INVALID');
  }
  const rawScenarioArguments = arguments_.slice(1);
  const scenarioArguments = Object.freeze(
    rawScenarioArguments[0] === '--'
      ? rawScenarioArguments.slice(1)
      : rawScenarioArguments,
  );
  const scenarioOptions =
    commandKind === 'success'
      ? parseW6b2PackagedSuccessCliArguments(scenarioArguments)
      : parseW6b2PackagedFaultCliArguments(scenarioArguments);
  const selectedRunCount = scenarioOptions.runNumbers?.length;
  const timeoutMilliseconds =
    commandKind === 'success'
      ? selectedRunCount === 1
        ? W6B2_PACKAGED_SUCCESS_COMMAND_TIMEOUT_MILLISECONDS
        : W6B2_PACKAGED_SUCCESS_FULL_COMMAND_TIMEOUT_MILLISECONDS
      : selectedRunCount === 1
        ? W6B2_PACKAGED_FAULT_COMMAND_TIMEOUT_MILLISECONDS
        : W6B2_PACKAGED_FAULT_FULL_COMMAND_TIMEOUT_MILLISECONDS;
  return Object.freeze({
    commandKind,
    scenarioArguments,
    timeoutMilliseconds,
  });
}

function safelyObserve(observer, event) {
  if (
    event.operation !== operation ||
    !commandKinds.has(event.commandKind) ||
    !allowedPhases.has(event.phase) ||
    !allowedStatuses.has(event.status) ||
    !Number.isSafeInteger(event.durationMs) ||
    event.durationMs < 0 ||
    !Number.isSafeInteger(event.elapsedMs) ||
    event.elapsedMs < 0 ||
    (event.errorCode !== undefined &&
      !safeErrorCodes.has(event.errorCode))
  ) {
    return;
  }
  const safeEvent = {
    operation: event.operation,
    commandKind: event.commandKind,
    phase: event.phase,
    status: event.status,
    durationMs: event.durationMs,
    elapsedMs: event.elapsedMs,
    ...(event.errorCode === undefined
      ? {}
      : { errorCode: event.errorCode }),
  };
  try {
    observer(Object.freeze(safeEvent));
  } catch {
    // Test observability cannot change the command result.
  }
}

function writeSafeObservation(event) {
  console.log(JSON.stringify(event));
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    console.log(
      JSON.stringify(
        await runW6b2PackagedCommand(process.argv.slice(2)),
      ),
    );
  } catch {
    process.exitCode = 1;
  }
}
