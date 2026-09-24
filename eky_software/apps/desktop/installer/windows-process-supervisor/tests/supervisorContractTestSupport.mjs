import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  readWindowsAcceptanceSupervisorResult,
  validateWindowsAcceptanceSupervisorResult,
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
  const testRoot = await mkdtemp(join(await realpath(tmpdir()), 'eky supervisor '));
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

export function registerSupervisorProcess(context, child) {
  activeSupervisorProcesses.add(child);
  context.supervisorProcesses.add(child);
  child.once('close', () => {
    activeSupervisorProcesses.delete(child);
    context.supervisorProcesses.delete(child);
  });
}

export function startSupervisor(
  context,
  {
    captureOutput = true,
    unreadOutput = false,
    dotnetArguments = ['--request', context.requestPath],
    dotnetAssembly = SUPERVISOR_DLL,
    environment = process.env,
    observeEvidence,
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
      stdio: captureOutput || unreadOutput || observeEvidence ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      windowsHide: true,
      env: environment,
    },
  );
  registerSupervisorProcess(context, child);

  if (captureOutput || observeEvidence) {
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (captureOutput) standardOutput += chunk;
      if (standardOutput.length > 65_536) {
        evidenceFailure = new Error(
          'WINDOWS_ACCEPTANCE_SUPERVISOR_EVIDENCE_TOO_LARGE',
        );
        return;
      }
      pending += chunk;
      if (!captureOutput && pending.length > 65_536) {
        pending = '';
        return;
      }
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (line === '') {
          continue;
        }
        try {
          const value = parseEvidenceLine(line, context);
          if (captureOutput) evidence.push(value);
          try { observeEvidence?.(value); } catch { /* Optional observation cannot change completion. */ }
          emitter.emit('evidence', value);
        } catch (error) {
          if (captureOutput) evidenceFailure = error;
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (captureOutput) standardError += chunk;
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

export async function readWindowsShortPathFixture(root, { directory, hold = false }) {
  const inputPath = join(root, 'short-path-input.json');
  await writeFile(inputPath, JSON.stringify({ schemaVersion: 1, directory, hold }), { flag: 'wx' });
  // Replace only the old synchronous alias lookup, retaining its exact bound.
  // This fixed fixture creates no descendants; spawnSync waits for its exit.
  const completed = spawnSync(DOTNET_EXECUTABLE,
    [PROGRAM_FAILURE_FIXTURE_DLL, '--mode', 'shortPathLookup', '--request', inputPath],
    { cwd: root, stdio: 'ignore', windowsHide: true, timeout: 10_000 });
  if (completed.error?.code === 'ETIMEDOUT' && completed.signal === 'SIGTERM') {
    throw new Error('WINDOWS_ACCEPTANCE_ALIAS_PREPARATION_TIMED_OUT');
  }
  if (completed.error || completed.signal || completed.status !== 0) {
    throw new Error('WINDOWS_ACCEPTANCE_ALIAS_PREPARATION_FAILED');
  }
  try {
    const value = JSON.parse(await readFile(join(root, 'short-path-result.json'), 'utf8'));
    if (value?.schemaVersion !== 1 || typeof value.shortPath !== 'string' ||
        value.shortPath.length === 0 ||
        Object.keys(value).sort().join(',') !== 'schemaVersion,shortPath') {
      throw new Error('invalidResult');
    }
    return value.shortPath;
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_ALIAS_RESULT_INVALID');
  }
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

// Only for postcompletion inspection, never a replacement for live readiness.
export async function readCompletedMarker(context, role) {
  if (!['root', 'grandchild', 'sentinel'].includes(role)) {
    throw new Error('WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID');
  }
  let serialized;
  try {
    serialized = await readFile(join(context.runRoot, role + '.ready.json'), 'utf8');
  } catch (error) {
    throw new Error(error?.code === 'ENOENT'
      ? 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING'
      : 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_READ_FAILED');
  }
  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'processId,role,runNonce,schemaVersion' ||
      value.schemaVersion !== 1 || value.runNonce !== context.runNonce || value.role !== role ||
      !Number.isSafeInteger(value.processId) || value.processId <= 0) {
    throw new Error('WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID');
  }
  return value;
}

const DEADLINE_FAILURE_CODES = new Set([
  'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING',
  'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID',
  'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_READ_FAILED',
  'WINDOWS_ACCEPTANCE_FIXTURE_PROCESS_REMAINS',
  'WINDOWS_ACCEPTANCE_FIXTURE_HANDLE_CLEANUP_TIMEOUT',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_SCHEMA_INVALID',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_BINDING_INVALID',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_EVIDENCE_INVALID',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_EVIDENCE_TOO_LARGE',
  'WINDOWS_ACCEPTANCE_SUPERVISOR_STDERR_NOT_EMPTY',
  'WINDOWS_ACCEPTANCE_DEADLINE_TERMINAL_UNEXPECTED',
  'WINDOWS_ACCEPTANCE_DEADLINE_PROCESS_PROOF_INVALID',
  'WINDOWS_ACCEPTANCE_DEADLINE_WRITER_PROOF_INVALID',
  'WINDOWS_ACCEPTANCE_DEADLINE_PROOF_PUBLICATION_INVALID',
]);

function deadlineFailureCode(error, fallback) {
  return DEADLINE_FAILURE_CODES.has(error?.message) ? error.message : fallback;
}

export function verifyDeadlineRun(context, execute) {
  return verifyDeadlineContract(context, execute);
}

export function verifyControlledDeadlineRun(context, contract, execute) {
  if (!['rootBeforeGrandchild', 'bothLive'].includes(contract)) {
    throw new Error('WINDOWS_ACCEPTANCE_DEADLINE_CONTRACT_INVALID');
  }
  return verifyDeadlineContract(context, execute, contract);
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

export async function readControlledDeadlineProof(context, contract) {
  return readControlledDeadlineProofFile(context, contract, 'deadline-process-proof.json');
}

async function readControlledDeadlineProofFile(context, contract, fileName) {
  try {
    const content = await readFile(join(context.testRoot, fileName), 'utf8');
    if (content.length > 4_096) throw new Error('invalidProof');
    const proof = JSON.parse(content);
    const memberKeys = ['ready', 'member', 'aliveBeforeDeadline', 'exitedAfterCleanup'];
    const sentinelKeys = ['outsideJob', 'aliveBeforeDeadline', 'aliveAfterCleanup'];
    if (!['rootBeforeGrandchild', 'bothLive'].includes(contract) ||
        !hasExactKeys(proof, ['schemaVersion', 'clockKind', 'runNonce', 'scenario',
          'artifactDescriptorSha256', 'contract', 'root', 'grandchild', 'sentinel',
          'creationWithheld', 'deadlineTriggered', 'setupFailure']) ||
        proof.schemaVersion !== 1 || proof.clockKind !== 'controlled' || proof.contract !== contract ||
        proof.runNonce !== context.runNonce || proof.scenario !== context.scenario ||
        proof.artifactDescriptorSha256 !== context.artifactDescriptorSha256 ||
        proof.deadlineTriggered !== true || proof.setupFailure !== null ||
        !hasExactKeys(proof.root, memberKeys) || !memberKeys.every(key => proof.root[key] === true) ||
        !hasExactKeys(proof.sentinel, sentinelKeys) || !sentinelKeys.every(key => proof.sentinel[key] === true) ||
        !hasExactKeys(proof.grandchild, memberKeys) ||
        !memberKeys.every(key => proof.grandchild[key] === (contract === 'bothLive')) ||
        proof.creationWithheld !== (contract === 'rootBeforeGrandchild')) {
      throw new Error('invalidProof');
    }
    return Object.freeze({ contract, nativeProcessProof: 'verified' });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_DEADLINE_PROCESS_PROOF_INVALID');
  }
}

export async function readDeadlineProofPublicationFailure(context) {
  try {
    const content = await readFile(join(context.testRoot, 'deadline-proof-write-failure.json'), 'utf8');
    if (content.length > 4_096) throw new Error('invalidProof');
    const proof = JSON.parse(content);
    if (!hasExactKeys(proof, ['schemaVersion', 'runNonce', 'scenario', 'artifactDescriptorSha256',
      'resultCode', 'writePhase']) || proof.schemaVersion !== 1 || proof.runNonce !== context.runNonce ||
        proof.scenario !== context.scenario || proof.artifactDescriptorSha256 !== context.artifactDescriptorSha256 ||
        proof.resultCode !== 'proofWriteFailed' || proof.writePhase !== 'publish') {
      throw new Error('invalidProof');
    }
    // The failed atomic publication must retain the genuine, fully serialized
    // both-live observations. A setup failure cannot stand in for this case.
    await readControlledDeadlineProofFile(context, 'bothLive', 'deadline-process-proof.json.next');
    return Object.freeze({ resultCode: 'proofWriteFailed', writePhase: 'publish', nativeProcessProof: 'verified' });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_DEADLINE_PROOF_PUBLICATION_INVALID');
  }
}

export async function readDeadlineWriterFailureProof(context) {
  try {
    const content = await readFile(join(context.testRoot, 'deadline-writer-proof.json'), 'utf8');
    if (content.length > 4_096) throw new Error('invalidProof');
    const proof = JSON.parse(content);
    if (!hasExactKeys(proof, ['schemaVersion', 'runNonce', 'scenario', 'artifactDescriptorSha256',
      'resultCode', 'writePhase', 'lastCompletedPhase', 'processResultCode', 'cleanupResultCode', 'processTreeAbsent']) ||
        proof.schemaVersion !== 1 || proof.runNonce !== context.runNonce ||
        proof.scenario !== context.scenario || proof.artifactDescriptorSha256 !== context.artifactDescriptorSha256 ||
        proof.resultCode !== 'resultWriteFailed' || proof.writePhase !== 'publish' ||
        proof.lastCompletedPhase !== 'close' || proof.processResultCode !== 'deadlineExceeded' ||
        proof.cleanupResultCode !== 'processTreeAbsent' || proof.processTreeAbsent !== true) {
      throw new Error('invalidProof');
    }
    return Object.freeze({ resultCode: 'resultWriteFailed', writePhase: 'publish', lastCompletedPhase: 'close' });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_DEADLINE_WRITER_PROOF_INVALID');
  }
}

// Clock/startup and negative-fixture checks share the same cleanup owner as
// deadline process checks, including assertions made after reading evidence.
export async function verifyDeadlineFixture(context, verify, { preserveEvidence = false } = {}) {
  const diagnostic = {
    operation: 'deadlineFixture', failure: null, cleanup: 'notAttempted',
    cleanupFailure: null, retention: 'notRequested', diagnosticWrite: 'notRequired',
  };
  try {
    await verify();
  } catch (error) {
    diagnostic.failure = {
      phase: 'verification',
      reason: deadlineFailureCode(error, 'WINDOWS_ACCEPTANCE_DEADLINE_CHECK_FAILED'),
    };
  }
  return finishDeadlineVerification(context, diagnostic, preserveEvidence);
}

async function verifyDeadlineContract(context, execute, controlledContract = null) {
  const diagnostic = {
    operation: 'deadlineContract',
    terminal: null,
    rootMarker: 'notRead',
    grandchildMarker: 'notRead',
    rootProcess: 'notChecked',
    grandchildProcess: 'notChecked',
    failure: null,
    cleanup: 'notAttempted',
    cleanupFailure: null,
    retention: 'notRequested',
    diagnosticWrite: 'notRequired',
  };
  if (controlledContract !== null) {
    diagnostic.contract = controlledContract;
    diagnostic.nativeProcessProof = 'notChecked';
  }
  let phase = 'execution';
  try {
    const execution = await execute();
    phase = 'terminal';
    // Reuse the owner validator before projecting even a test-injected result.
    const result = validateWindowsAcceptanceSupervisorResult(execution.result, {
      artifactDescriptorSha256: context.artifactDescriptorSha256,
      runNonce: context.runNonce,
      scenario: context.scenario,
      supervisorExitCode: execution.exitCode,
    });
    diagnostic.terminal = {
      processResultCode: result.processResultCode,
      cleanupResultCode: result.cleanupResultCode,
      processTreeAbsent: result.processTreeAbsent,
    };
    if (execution.exitCode !== 1 || result.processResultCode !== 'deadlineExceeded' ||
        result.workerResultCode !== 'notChecked' ||
        result.cleanupResultCode !== 'processTreeAbsent' || result.processTreeAbsent !== true) {
      throw new Error('WINDOWS_ACCEPTANCE_DEADLINE_TERMINAL_UNEXPECTED');
    }
    if (controlledContract !== null) {
      phase = 'nativeProcessProof';
      await readControlledDeadlineProof(context, controlledContract);
      diagnostic.nativeProcessProof = 'verified';
    }
    const markers = {};
    const roles = controlledContract === 'rootBeforeGrandchild' ? ['root'] : ['root', 'grandchild'];
    if (controlledContract === 'rootBeforeGrandchild') {
      phase = 'grandchildMarker';
      try {
        await readCompletedMarker(context, 'grandchild');
        throw new Error('WINDOWS_ACCEPTANCE_DEADLINE_PROCESS_PROOF_INVALID');
      } catch (error) {
        if (error.message !== 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING') throw error;
      }
      diagnostic.grandchildMarker = 'creationWithheld';
      diagnostic.grandchildProcess = 'creationWithheld';
    }
    for (const role of roles) {
      phase = role + 'Marker';
      try {
        markers[role] = await readCompletedMarker(context, role);
        diagnostic[phase] = 'valid';
      } catch (error) {
        diagnostic[phase] = error.message === 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING'
          ? 'missing' : error.message === 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID'
            ? 'invalid' : 'readFailed';
        throw error;
      }
    }
    for (const role of roles) {
      phase = role + 'Process';
      await waitForProcessAbsent(markers[role].processId);
      diagnostic[phase] = 'absent';
    }
    if (controlledContract !== null) {
      phase = 'sentinel';
      const sentinel = await readCompletedMarker(context, 'sentinel');
      const handle = [...context.fixtureProcesses].find(child => child.pid === sentinel.processId);
      if (!handle || handle.exitCode !== null || handle.signalCode !== null ||
          !isProcessAlive(sentinel.processId)) {
        throw new Error('WINDOWS_ACCEPTANCE_DEADLINE_PROCESS_PROOF_INVALID');
      }
    }
  } catch (error) {
    diagnostic.failure = {
      phase,
      reason: deadlineFailureCode(error, 'WINDOWS_ACCEPTANCE_DEADLINE_CHECK_FAILED'),
    };
  }

  return finishDeadlineVerification(context, diagnostic);
}

async function finishDeadlineVerification(context, diagnostic, preserveEvidence = false) {
  const retain = preserveEvidence || diagnostic.failure !== null;
  diagnostic.retention = retain ? 'requested' : 'notRequested';
  const supervisedHandles = [...context.supervisorProcesses];
  try {
    await cleanupRunContext(context, { preserveEvidence: retain });
    diagnostic.cleanup = 'completed';
  } catch (error) {
    diagnostic.cleanup = 'failed';
    diagnostic.retention = 'requested';
    diagnostic.cleanupFailure = deadlineFailureCode(error, 'WINDOWS_ACCEPTANCE_DEADLINE_CLEANUP_FAILED');
  } finally {
    // This run already attempted every owned handle. Do not retry outside its
    // diagnostic boundary in the global afterEach; failed cleanup stays failed.
    for (const child of supervisedHandles) activeSupervisorProcesses.delete(child);
  }
  if (diagnostic.failure || diagnostic.cleanupFailure) {
    try {
      diagnostic.diagnosticWrite = 'completed';
      await writeFile(join(context.testRoot, 'deadline-contract-diagnostic.json'),
        JSON.stringify(diagnostic) + '\n', { encoding: 'utf8', flag: 'wx' });
    } catch {
      diagnostic.diagnosticWrite = 'failed';
    }
    // Never attach the raw exception/cause: filesystem errors contain local paths.
    const failure = new Error(diagnostic.failure?.reason ?? diagnostic.cleanupFailure);
    failure.stack = failure.message;
    failure.diagnostic = diagnostic;
    throw failure;
  }
  return diagnostic;
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

export async function cleanupRunContext(context, { preserveEvidence = false } = {}) {
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
      const marker = await readCompletedMarker(context, role);
      await waitForProcessAbsent(marker.processId);
    } catch (error) {
      if (error.message === 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING') continue;
      cleanupFailure ??= error;
    }
  }

  if (cleanupFailure) {
    throw cleanupFailure;
  }
  if (!preserveEvidence) {
    await rm(context.testRoot, { force: true, recursive: true });
  }
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
