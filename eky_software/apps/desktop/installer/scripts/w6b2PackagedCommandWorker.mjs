import { spawn } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  parseW6b2PackagedFaultCliArguments,
  runW6b2PackagedFaultRollback,
} from './runW6b2PackagedFaultRollback.mjs';
import {
  parseW6b2PackagedSuccessCliArguments,
  runW6b2PackagedSuccess,
} from './runW6b2PackagedSuccess.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..', '..');
const operation = 'w6b2PackagedCommandWorker';
const commandKinds = new Set(['faultRollback', 'success']);
const allowedPhases = new Set(['e2eBuild', 'scenario']);
const allowedStatuses = new Set(['started', 'completed', 'failed']);
const safeErrorCodes = new Set([
  'W6B2_PACKAGED_WORKER_E2E_BUILD_FAILED',
  'W6B2_PACKAGED_WORKER_SCENARIO_FAILED',
]);

const defaultDependencies = Object.freeze({
  now: Date.now,
  observe: writeSafeObservation,
  runE2eBuild,
  runFaultRollback: runW6b2PackagedFaultRollback,
  runSuccess: runW6b2PackagedSuccess,
});

export async function runW6b2PackagedCommandWorker(
  arguments_,
  options = {},
) {
  const dependencies = {
    ...defaultDependencies,
    ...(options.dependencies ?? {}),
  };
  const configuration = parseWorkerArguments(arguments_);
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

  observe('e2eBuild', 'started');
  try {
    await dependencies.runE2eBuild();
    observe('e2eBuild', 'completed');
  } catch {
    observe(
      'e2eBuild',
      'failed',
      'W6B2_PACKAGED_WORKER_E2E_BUILD_FAILED',
    );
    throw new Error('W6B2_PACKAGED_WORKER_E2E_BUILD_FAILED');
  }

  observe('scenario', 'started');
  try {
    const result =
      configuration.commandKind === 'success'
        ? await dependencies.runSuccess(configuration.scenarioOptions)
        : await dependencies.runFaultRollback(
            configuration.scenarioOptions,
          );
    observe('scenario', 'completed');
    return result;
  } catch {
    observe(
      'scenario',
      'failed',
      'W6B2_PACKAGED_WORKER_SCENARIO_FAILED',
    );
    throw new Error('W6B2_PACKAGED_WORKER_SCENARIO_FAILED');
  }
}

export function parseW6b2PackagedCommandWorkerArguments(arguments_) {
  return parseWorkerArguments(arguments_);
}

export function createW6b2PackagedE2eBuildInvocation(input) {
  if (
    typeof input?.nodeExecutable !== 'string' ||
    input.nodeExecutable.length === 0 ||
    !isAbsolute(input.nodeExecutable) ||
    typeof input.pnpmCliPath !== 'string' ||
    input.pnpmCliPath.length === 0 ||
    !isAbsolute(input.pnpmCliPath)
  ) {
    throw new Error('W6B2_PACKAGED_WORKER_PNPM_UNAVAILABLE');
  }
  return Object.freeze({
    arguments: Object.freeze([
      input.pnpmCliPath,
      '--filter',
      '@eky/desktop',
      'e2e:build',
    ]),
    command: input.nodeExecutable,
  });
}

function parseWorkerArguments(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.length < 2) {
    throw new Error('W6B2_PACKAGED_WORKER_ARGUMENTS_INVALID');
  }
  const commandKind = arguments_[0]?.slice('--kind='.length);
  const proofToken = arguments_[1]?.slice(
    '--process-proof-token='.length,
  );
  if (
    !arguments_[0]?.startsWith('--kind=') ||
    !arguments_[1]?.startsWith('--process-proof-token=') ||
    !commandKinds.has(commandKind) ||
    !/^[0-9a-f]{64}$/u.test(proofToken)
  ) {
    throw new Error('W6B2_PACKAGED_WORKER_ARGUMENTS_INVALID');
  }
  const scenarioArguments = arguments_.slice(2);
  const scenarioOptions =
    commandKind === 'success'
      ? parseW6b2PackagedSuccessCliArguments(scenarioArguments)
      : parseW6b2PackagedFaultCliArguments(scenarioArguments);
  return Object.freeze({
    commandKind,
    scenarioOptions,
  });
}

function runE2eBuild() {
  const invocation = createW6b2PackagedE2eBuildInvocation({
    nodeExecutable: process.execPath,
    pnpmCliPath: process.env.npm_execpath,
  });
  return runChildProcess(invocation.command, invocation.arguments);
}

function runChildProcess(command, arguments_) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd: desktopDirectory,
      env: { ...process.env },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (error !== undefined) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    };
    const onError = () =>
      finish(new Error('W6B2_PACKAGED_WORKER_E2E_BUILD_FAILED'));
    const onExit = (exitCode, signal) => {
      if (exitCode === 0 && signal === null) {
        finish();
        return;
      }
      finish(new Error('W6B2_PACKAGED_WORKER_E2E_BUILD_FAILED'));
    };
    child.once('error', onError);
    child.once('exit', onExit);
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
    // Test observability cannot change the worker result.
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
    const result = await runW6b2PackagedCommandWorker(
      process.argv.slice(2),
    );
    console.log(JSON.stringify(result));
  } catch {
    process.exitCode = 1;
  }
}
