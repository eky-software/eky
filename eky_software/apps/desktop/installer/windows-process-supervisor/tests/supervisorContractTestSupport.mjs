import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  readWindowsAcceptanceSupervisorResult,
} from '../windowsAcceptanceSupervisorResult.mjs';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const TOOL_DIRECTORY = resolve(TEST_DIRECTORY, '..');
const SUPERVISOR_DLL = resolve(
  TOOL_DIRECTORY,
  '..',
  'bin',
  'windows-process-supervisor',
  'Release',
  'net10.0',
  'Eky.WindowsProcessSupervisor.dll',
);
const PROGRAM_FAILURE_FIXTURE_DLL = resolve(
  TOOL_DIRECTORY,
  '..',
  'bin',
  'windows-process-supervisor-contract-fixture',
  'Release',
  'net10.0',
  'Eky.WindowsProcessSupervisor.ContractFixture.dll',
);
const FIXTURE_PATH = resolve(TEST_DIRECTORY, 'processTreeFixture.mjs');
const DOTNET_EXECUTABLE = process.env.EKY_DOTNET_EXE || 'dotnet';
const activeSupervisorProcesses = new Set();
const EVIDENCE_KEYS = new Set([
  'durationMs',
  'elapsedMs',
  'errorCode',
  'operation',
  'phase',
  'resultCode',
  'scenario',
  'schemaVersion',
  'status',
  'win32ErrorCode',
]);

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function createRunContext(label) {
  const testRoot = await mkdtemp(join(tmpdir(), 'eky supervisor '));
  const runNonce = randomBytes(32).toString('hex');
  const runRoot = join(testRoot, runNonce);
  const requestPath = join(testRoot, 'request.json');
  const resultPath = join(testRoot, 'result.json');
  const workerResultPath = join(testRoot, 'worker-result.json');
  const artifactDescriptorSha256 = createHash('sha256')
    .update('fixture:' + label, 'utf8')
    .digest('hex');
  return {
    artifactDescriptorSha256,
    requestPath,
    resultPath,
    runNonce,
    runRoot,
    scenario: 'jobObjectFeasibility',
    fixtureProcesses: new Set(),
    supervisorProcesses: new Set(),
    testRoot,
    workerResultPath,
  };
}

export function createRequest(
  context,
  mode,
  {
    cleanupReserveMilliseconds = 1_000,
    timeoutMilliseconds = 10_000,
  } = {},
) {
  return {
    schemaVersion: 1,
    runNonce: context.runNonce,
    scenario: context.scenario,
    artifactDescriptorSha256: context.artifactDescriptorSha256,
    command: process.execPath,
    arguments: [
      FIXTURE_PATH,
      '--mode=' + mode,
      '--role=root',
      '--scenario=' + context.scenario,
      '--artifactDescriptorSha256=' + context.artifactDescriptorSha256,
      '--runNonce=' + context.runNonce,
      '--runRoot=' + context.runRoot,
      '--workerResultPath=' + context.workerResultPath,
    ],
    workingDirectory: context.testRoot,
    timeoutMilliseconds,
    cleanupReserveMilliseconds,
  };
}

export async function writeRequest(context, request) {
  await writeFile(context.requestPath, JSON.stringify(request) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function parseEvidenceLine(line, context) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_EVIDENCE_INVALID');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !EVIDENCE_KEYS.has(key)) ||
    value.schemaVersion !== 1 ||
    value.operation !== 'windowsAcceptanceSupervisor' ||
    typeof value.phase !== 'string' ||
    typeof value.status !== 'string' ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    !Number.isSafeInteger(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    line.includes(context.testRoot) ||
    line.includes(process.execPath)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_EVIDENCE_INVALID');
  }
  return value;
}

export function startSupervisor(
  context,
  {
    captureOutput = true,
    dotnetArguments = ['--request', context.requestPath],
    dotnetAssembly = SUPERVISOR_DLL,
  } = {},
) {
  const evidence = [];
  const emitter = new EventEmitter();
  let evidenceFailure;
  let standardError = '';
  let standardOutput = '';

  const child = spawn(
    DOTNET_EXECUTABLE,
    [dotnetAssembly, ...dotnetArguments],
    {
      cwd: context.testRoot,
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      windowsHide: true,
    },
  );
  activeSupervisorProcesses.add(child);
  context.supervisorProcesses.add(child);
  child.once('close', () => {
    activeSupervisorProcesses.delete(child);
    context.supervisorProcesses.delete(child);
  });

  if (captureOutput) {
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      standardOutput += chunk;
      if (standardOutput.length > 65_536) {
        evidenceFailure = new Error(
          'WINDOWS_ACCEPTANCE_SUPERVISOR_EVIDENCE_TOO_LARGE',
        );
        return;
      }
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (line === '') {
          continue;
        }
        try {
          const value = parseEvidenceLine(line, context);
          evidence.push(value);
          emitter.emit('evidence', value);
        } catch (error) {
          evidenceFailure = error;
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      standardError += chunk;
    });
  }

  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise);
    child.once('close', (exitCode, signal) => {
      if (evidenceFailure) {
        rejectPromise(evidenceFailure);
        return;
      }
      if (captureOutput && standardError !== '') {
        rejectPromise(
          new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_STDERR_NOT_EMPTY'),
        );
        return;
      }
      resolvePromise({
        evidence,
        exitCode,
        signal,
        standardOutput,
      });
    });
  });

  async function waitForEvidence(predicate, timeoutMilliseconds = 10_000) {
    const existing = evidence.find(predicate);
    if (existing) {
      return existing;
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        emitter.off('evidence', listener);
        rejectPromise(
          new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_EVIDENCE_TIMEOUT'),
        );
      }, timeoutMilliseconds);
      const listener = (value) => {
        if (!predicate(value)) {
          return;
        }
        clearTimeout(timer);
        emitter.off('evidence', listener);
        resolvePromise(value);
      };
      emitter.on('evidence', listener);
    });
  }

  return { child, completion, evidence, waitForEvidence };
}

export function startProgramFailureFixture(context, mode) {
  return startSupervisor(context, {
    dotnetArguments: ['--mode', mode, '--request', context.requestPath],
    dotnetAssembly: PROGRAM_FAILURE_FIXTURE_DLL,
  });
}

export async function runSupervisor(
  context,
  mode,
  options,
  launchOptions,
) {
  await writeRequest(context, createRequest(context, mode, options));
  const execution = startSupervisor(context, launchOptions);
  const completion = await execution.completion;
  const result = await readWindowsAcceptanceSupervisorResult(
    context.resultPath,
    {
      artifactDescriptorSha256: context.artifactDescriptorSha256,
      runNonce: context.runNonce,
      scenario: context.scenario,
      supervisorExitCode: completion.exitCode,
    },
  );
  return { ...completion, result };
}

export async function waitForMarker(
  context,
  role,
  timeoutMilliseconds = 10_000,
) {
  const markerPath = join(context.runRoot, role + '.ready.json');
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await pathExists(markerPath)) {
      const value = JSON.parse(await readFile(markerPath, 'utf8'));
      if (
        value.schemaVersion !== 1 ||
        value.runNonce !== context.runNonce ||
        value.role !== role ||
        !Number.isInteger(value.processId) ||
        value.processId <= 0
      ) {
        throw new Error('WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID');
      }
      return value;
    }
    await delay(20);
  }
  throw new Error('WINDOWS_ACCEPTANCE_FIXTURE_MARKER_TIMEOUT');
}

export async function releaseFixture(context, role) {
  const path = join(context.runRoot, role + '.release');
  if (!(await pathExists(path))) {
    await writeFile(path, '', { flag: 'wx' });
  }
}

export function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForProcessAbsent(
  processId,
  timeoutMilliseconds = 10_000,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (!isProcessAlive(processId)) {
      return;
    }
    await delay(20);
  }
  throw new Error('WINDOWS_ACCEPTANCE_FIXTURE_PROCESS_REMAINS');
}

export async function startForeignSentinel(context) {
  await mkdir(context.runRoot);
  const child = spawn(
    process.execPath,
    [
      FIXTURE_PATH,
      '--mode=hold',
      '--role=sentinel',
      '--scenario=' + context.scenario,
      '--artifactDescriptorSha256=' + context.artifactDescriptorSha256,
      '--runNonce=' + context.runNonce,
      '--runRoot=' + context.runRoot,
      '--workerResultPath=' + context.workerResultPath,
    ],
    {
      cwd: context.testRoot,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  context.fixtureProcesses.add(child);
  child.once('close', () => {
    context.fixtureProcesses.delete(child);
  });
  const marker = await waitForMarker(context, 'sentinel');
  return { child, marker };
}

export async function cleanupRunContext(context) {
  let cleanupFailure;
  for (const processes of [
    context.supervisorProcesses,
    context.fixtureProcesses,
  ]) {
    try {
      await terminateChildHandles(processes);
    } catch (error) {
      cleanupFailure ??= error;
    }
  }

  for (const role of ['root', 'grandchild', 'sentinel']) {
    try {
      const markerPath = join(context.runRoot, role + '.ready.json');
      if (!(await pathExists(markerPath))) {
        continue;
      }
      const marker = JSON.parse(await readFile(markerPath, 'utf8'));
      if (
        marker.runNonce !== context.runNonce ||
        !Number.isInteger(marker.processId) ||
        marker.processId <= 0
      ) {
        throw new Error('WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID');
      }
      await waitForProcessAbsent(marker.processId);
    } catch (error) {
      cleanupFailure ??= error;
    }
  }

  if (cleanupFailure) {
    throw cleanupFailure;
  }
  await rm(context.testRoot, { force: true, recursive: true });
}

export async function cleanupActiveSupervisors() {
  const completions = [];
  for (const child of activeSupervisorProcesses) {
    if (child.exitCode === null && child.signalCode === null) {
      const completion = onceClose(child);
      child.kill();
      completions.push(completion);
    }
  }
  await Promise.all(completions);
}

function onceClose(child, timeoutMilliseconds = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const onClose = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    const timer = setTimeout(() => {
      child.off('close', onClose);
      rejectPromise(
        new Error('WINDOWS_ACCEPTANCE_FIXTURE_HANDLE_CLEANUP_TIMEOUT'),
      );
    }, timeoutMilliseconds);
    child.once('close', onClose);
  });
}

async function terminateChildHandles(processes) {
  let cleanupFailure;
  for (const child of [...processes]) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    const completion = onceClose(child);
    try {
      child.kill();
    } catch (error) {
      cleanupFailure ??= error;
    }
    try {
      await completion;
    } catch (error) {
      cleanupFailure ??= error;
    }
  }
  if (cleanupFailure) {
    throw cleanupFailure;
  }
}

export { SUPERVISOR_DLL };
