import { createHash } from 'node:crypto';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

import { runPackagedSmoke, runPackagedSmokePhase } from './run-packaged-smoke.mjs';
import { packagedSmokeTimeoutMilliseconds, packagedSmokeWorkflowTimeoutMilliseconds,
  packagedSmokeJobCallerReserveMilliseconds } from './packagedSmokeLimits.mjs';
import { capturePackagedSmokePhaseOutput } from './packagedSmokeFailureEvidence.mjs';
import { readDesktopElectronVersion } from './read-desktop-electron-version.mjs';
import { packagedSelectorVerificationPhase, packagedSelectorVerificationSwitch,
  readPackagedSmokeBackend, resolvePackagedSmokeTempPath } from '../dist/main/packagedSmoke.js';
import { waitForLoopbackPortRelease } from '../../e2e/src/environment/waitForLoopbackPortRelease.ts';
import { STARTUP_EXCEPTION_SWITCH, STARTUP_EXCEPTION_TOKEN_ENV } from '../src/main/startupExceptionEvidence.ts';
import { ordinaryPath } from '../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { readCommandPhaseJson } from '../installer/windows-acceptance-harness/acceptanceCommandPhaseInput.mjs';
import { createRunnerFailureSink } from '../../../test-reporters/runnerFailureEvidence.mjs';
import { validateWindowsAcceptanceSupervisorResult } from '../installer/windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';

const phases = Object.freeze({ initial: 'packagedSmokeInitial', restoredProfile: 'packagedSmokeRestored',
  selectorRecovery: 'packagedSmokeDeleteRecovery', selectorRestart: 'packagedSmokeDeleteRestart',
  workspaceDeletion: 'packagedSmokeWorkspaceDeletion' });
const invalid = () => new Error('PACKAGED_SMOKE_JOB_INPUT_INVALID');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const workerPath = fileURLToPath(import.meta.url);
export const packagedSmokeJobCleanupReserveMilliseconds = 1_000;

function workerArguments(value) {
  return [workerPath, '--phase', value.phase, '--run-nonce', value.runNonce,
    '--artifact-descriptor-sha256', value.artifactDescriptorSha256,
    ...(value.startupException ? ['--startup-exception'] : [])];
}

export function parsePackagedSmokeJobArguments(argumentsList) {
  const { values } = parseArgs({ args: argumentsList, strict: true, allowPositionals: false, options: {
    phase: { type: 'string' }, 'run-nonce': { type: 'string' },
    'artifact-descriptor-sha256': { type: 'string' }, 'startup-exception': { type: 'boolean' },
  } });
  const value = { schemaVersion: 1, phase: values.phase, runNonce: values['run-nonce'],
    artifactDescriptorSha256: values['artifact-descriptor-sha256'], startupException: values['startup-exception'] === true };
  if (!isDeepStrictEqual(argumentsList, workerArguments(value).slice(1))) throw invalid();
  return value;
}

export function capturePackagedSmokeJobPhase(value, environment) {
  const keys = ['schemaVersion', 'phase', 'runNonce', 'artifactDescriptorSha256', 'startupException'];
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'))) throw invalid();
  const { schemaVersion, phase, runNonce, artifactDescriptorSha256, startupException } = value;
  const token = environment.EKY_DESKTOP_SMOKE_TOKEN;
  if (schemaVersion !== 1 || typeof phase !== 'string' || !Object.hasOwn(phases, phase) || !digest(runNonce) || !digest(artifactDescriptorSha256) ||
      typeof startupException !== 'boolean' || typeof token !== 'string' || !/^[a-f0-9]{32}$/u.test(token)) throw invalid();
  if (startupException && (!digest(environment[STARTUP_EXCEPTION_TOKEN_ENV]) ||
      !environment[STARTUP_EXCEPTION_TOKEN_ENV].startsWith(token))) throw invalid();
  if (phase === 'workspaceDeletion' && (startupException || environment.EKY_E2E !== '1')) throw invalid();
  const temp = resolvePackagedSmokeTempPath(tmpdir());
  const root = join(temp, 'eky-desktop-smoke', token);
  const phaseRoot = join(root, 'result', phase === 'workspaceDeletion' ? 'workflow-jobs' : 'phase-jobs', runNonce);
  const argumentsList = phase === 'workspaceDeletion' ? [] : ['--desktop-smoke',
    ...(phase === 'restoredProfile' ? ['--desktop-smoke-restored'] :
      phase.startsWith('selector') ? [`--${packagedSelectorVerificationSwitch}`] : [])];
  return Object.freeze({ temp, root, phaseRoot, phase, startupException, argumentsList: Object.freeze(argumentsList),
    expectedStage: phase === 'workspaceDeletion' ? 'workflow' : phase === 'initial' ? 'restoreRestart' : 'shutdown',
    binding: Object.freeze({ schemaVersion: 1, runNonce, scenario: phases[phase], artifactDescriptorSha256 }) });
}

function createEvidence(environment) {
  return createRunnerFailureSink({ env: environment, tempRoot: environment.RUNNER_TEMP || tmpdir() });
}

function requestFor(selected, processBudget) {
  const workflow = selected.phase === 'workspaceDeletion';
  const maximum = (workflow ? packagedSmokeWorkflowTimeoutMilliseconds : packagedSmokeTimeoutMilliseconds) -
    packagedSmokeJobCallerReserveMilliseconds;
  const budget = processBudget ?? maximum;
  if (!Number.isSafeInteger(budget) || budget <= packagedSmokeJobCleanupReserveMilliseconds ||
      budget > maximum) throw invalid();
  return Object.freeze({ ...selected.binding, command: process.execPath,
    arguments: Object.freeze(workerArguments({ ...selected.binding, phase: selected.phase, startupException: selected.startupException })),
    workingDirectory: selected.phaseRoot, timeoutMilliseconds: budget,
    cleanupReserveMilliseconds: packagedSmokeJobCleanupReserveMilliseconds });
}

export function createPackagedSmokeJobRequest(input, environment = process.env, processBudget) {
  return requestFor(capturePackagedSmokeJobPhase(input, environment), processBudget);
}

function createRootGuard(selected) {
  let identities;
  return async () => {
    const observed = [];
    for (const path of [selected.root, join(selected.root, 'result'), dirname(selected.phaseRoot), selected.phaseRoot]) {
      const value = await ordinaryPath(selected.temp, path, true);
      observed.push({ dev: value.dev, ino: value.ino });
    }
    if (identities !== undefined && observed.some((value, index) =>
      value.dev !== identities[index].dev || value.ino !== identities[index].ino)) throw invalid();
    identities ??= observed;
  };
}

// Only the existing Job owner may establish process-tree absence after this worker exits.
export async function runPackagedSmokeJobPhase(input, environment = process.env, sink = createEvidence(environment)) {
  const env = { ...environment }, outputs = [];
  let selected, failure, firstObserved, admitted = false, assertRoot;
  const record = (error, phase) => {
    try { sink.record({ runner: 'node', phase, attempt: 0, testId: selected?.binding.scenario ?? null, error }); }
    catch { /* Private reporting must not replace the phase result. */ }
  };
  const observe = error => { firstObserved ??= { error }; record(error, 'packagedPhaseOriginal'); };
  try {
    selected = capturePackagedSmokeJobPhase(input, env);
    if (selected.phase === 'workspaceDeletion') throw invalid();
    assertRoot = createRootGuard(selected);
    await assertRoot();
    const requestPath = join(selected.phaseRoot, 'request.json');
    await ordinaryPath(selected.phaseRoot, requestPath);
    const expectedRequest = requestFor(selected, (await readCommandPhaseJson(requestPath)).timeoutMilliseconds);
    const assertRequest = async () => {
      await ordinaryPath(selected.phaseRoot, requestPath);
      if (!isDeepStrictEqual(await readCommandPhaseJson(requestPath), expectedRequest)) throw invalid();
    };
    await assertRequest();
    await assertRoot();
    const expectedElectronVersion = await readDesktopElectronVersion();
    await assertRoot();
    await assertRequest();
    const smokeResultPath = join(selected.root, 'result', 'desktop-smoke-result.json');
    await ordinaryPath(selected.root, smokeResultPath);
    if (!isDeepStrictEqual(await readCommandPhaseJson(smokeResultPath), { stage: 'startup', status: 'started' })) throw invalid();
    for (const name of ['phase-output.private.json', 'worker-result.json']) {
      let absent = false;
      try { await lstat(join(selected.phaseRoot, name)); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; absent = true; }
      if (!absent) throw invalid();
    }
    await assertRoot();
    admitted = true;
    delete env.ELECTRON_RUN_AS_NODE;
    env.ELECTRON_ENABLE_SECURITY_WARNINGS = 'true';
    await runPackagedSmokePhase({ argumentsList: selected.argumentsList, expectedStage: selected.expectedStage,
      smokeResultPath,
      expectedElectronVersion, childEnvironment: env, phaseOutputs: outputs,
      observeResultReadFailure(error, priorFailure) {
        if (priorFailure === undefined) firstObserved ??= { error };
        record(error, 'packagedPhaseResultRead');
      },
      exceptionEvidence: { arguments: selected.startupException ? [`--${STARTUP_EXCEPTION_SWITCH}`] : [], capture: observe } });
    const output = outputs.length === 1 ? outputs[0]() : undefined;
    if (output?.phase !== selected.expectedStage || output.stdout.partial || !output.stdout.available ||
        !output.stdout.ended || output.stdout.changed || output.stdout.truncated || output.stdout.readFailed) throw invalid();
    const port = readPackagedSmokeBackend(output.stdout.text,
      selected.phase.startsWith('selector') ? packagedSelectorVerificationPhase : selected.phase);
    // The current Job deadline also bounds this existing independent port check.
    if (port !== undefined) {
      try { await waitForLoopbackPortRelease(port); }
      catch (error) { observe(error); throw error; }
    }
    await assertRoot();
  } catch (error) {
    failure = { error: firstObserved === undefined || firstObserved.error === error ? error :
      new AggregateError([firstObserved.error, error], 'PACKAGED_SMOKE_JOB_PHASE_FAILED', { cause: firstObserved.error }) };
    record(failure.error, 'packagedPhase');
  }
  if (admitted) {
    try {
      await assertRoot();
      // This private handoff is not a new collector path. The caller must validate it before any existing projection.
      await writeFile(join(selected.phaseRoot, 'phase-output.private.json'), JSON.stringify({
        schemaVersion: 1, binding: selected.binding, phase: selected.phase,
        phases: outputs.map(read => read()), cleanup: 'notVerified',
      }) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (error) { record(error, 'packagedPhaseOutput'); }
    try {
      await assertRoot();
      await writeFile(join(selected.phaseRoot, 'worker-result.json'), JSON.stringify({ ...selected.binding,
        status: failure === undefined ? 'completed' : 'failed',
        resultCode: failure === undefined ? 'packagedPhaseCompleted' : 'packagedPhaseFailed',
        errorCode: failure === undefined ? null : 'packagedSmokePhaseFailed',
      }) + '\n', { flag: 'wx', mode: 0o600 });
      await assertRoot();
    } catch (error) {
      record(error, 'packagedPhaseTerminal');
      failure = { error: failure === undefined ? error : new AggregateError([failure.error, error],
        'PACKAGED_SMOKE_JOB_TERMINAL_FAILED', { cause: failure.error }) };
    }
  }
  try { await sink.flush(); } catch { /* Delivery is reported separately by the existing sink. */ }
  if (failure !== undefined) throw failure.error;
}

export function createPackagedSmokeWorkflowExecution(input, environment, { signal, runPhase } = {}) {
  const env = { ...environment }, selected = capturePackagedSmokeJobPhase(input, env);
  const metadata = Object.freeze({ ...input });
  if (selected.phase !== 'workspaceDeletion' || !(signal instanceof AbortSignal) ||
      runPhase !== undefined && typeof runPhase !== 'function') throw invalid();
  const order = ['initial', 'restoredProfile', 'selectorRecovery', 'selectorRestart'];
  const outputs = [];
  let active = false, index = 0, proof, failure;
  const cancelled = () => { failure ??= { error: signal.reason }; };
  if (signal.aborted) cancelled(); else signal.addEventListener('abort', cancelled, { once: true });
  const fail = error => { failure ??= { error }; throw failure.error; };
  const current = () => { if (failure) throw failure.error; signal.throwIfAborted(); };
  return Object.freeze({
    execution: Object.freeze({ smokeToken: env.EKY_DESKTOP_SMOKE_TOKEN,
      async runPhase(command) {
        try {
          current();
          if (active || command?.phase !== order[index] || !Object.isFrozen(command) ||
              Reflect.ownKeys(command).length !== 3 ||
              ['phase', 'environment', 'startupException'].some(key =>
                !Object.hasOwn(Object.getOwnPropertyDescriptor(command, key) ?? {}, 'value')) ||
              typeof command.startupException !== 'boolean' ||
              command.environment?.EKY_DESKTOP_SMOKE_TOKEN !== env.EKY_DESKTOP_SMOKE_TOKEN) throw invalid();
          active = true; proof = undefined;
          const phaseEnvironment = Object.freeze({ ...command.environment });
          const phaseInput = Object.freeze({ ...metadata, phase: order[index], startupException: command.startupException,
            runNonce: createHash('sha256').update(JSON.stringify([metadata.runNonce, order[index]])).digest('hex') });
          const child = capturePackagedSmokeJobPhase(phaseInput, phaseEnvironment);
          const invoke = runPhase ?? (await import('./packagedSmokeJob.mjs')).runOwnedPackagedSmokePhase;
          const result = await invoke(phaseInput, { environment: phaseEnvironment, signal });
          current();
          if (!isDeepStrictEqual(result.binding, child.binding) || result.diagnostic?.status !== 'verified' ||
              !isDeepStrictEqual(result.portRelease, { status: child.phase.startsWith('selector') ? 'notStarted' : 'verified' })) throw invalid();
          const report = validateWindowsAcceptanceSupervisorResult(result.supervisorResult,
            { ...child.binding, supervisorExitCode: 0 });
          if (report.status !== 'completed') throw invalid();
          const output = capturePackagedSmokePhaseOutput(result.diagnostic.phase, child.expectedStage);
          if (output.stdout.partial) throw invalid();
          readPackagedSmokeBackend(output.stdout.text,
            child.phase.startsWith('selector') ? packagedSelectorVerificationPhase : child.phase);
          outputs.push(output);
          proof = Object.freeze({ phase: child.phase, completed: true }); index++;
          return output;
        } catch (error) { fail(error); }
        finally { active = false; }
      } }),
    async assertPreviousPhaseStopped(context, state) {
      try {
        current();
        const expected = { new: 2, prepared: 3, recovered: 4 }[state];
        if (active || expected === undefined || index !== expected ||
            proof?.phase !== order[index - 1] || proof.completed !== true ||
            context?.smokeToken !== env.EKY_DESKTOP_SMOKE_TOKEN || context.smokeRootDirectory !== selected.root ||
            !Object.isFrozen(context) || Reflect.ownKeys(context).length !== 2) throw invalid();
      } catch (error) { fail(error); }
    },
    readOutputs() { return [...outputs]; },
  });
}

async function runPackagedSmokeJobWorkflow(input, environment, sink) {
  const env = { ...environment }, controller = new AbortController();
  let selected, owner, assertRoot, failure, admitted = false;
  const record = (error, phase) => {
    try { sink.record({ runner: 'node', phase, attempt: 0, testId: selected?.binding.scenario ?? null, error }); }
    catch { /* Evidence does not replace the workflow failure. */ }
  };
  try {
    selected = capturePackagedSmokeJobPhase(input, env);
    if (selected.phase !== 'workspaceDeletion') throw invalid();
    assertRoot = createRootGuard(selected);
    const requestPath = join(selected.phaseRoot, 'request.json');
    await assertRoot();
    await ordinaryPath(selected.phaseRoot, requestPath);
    const expectedRequest = requestFor(selected, (await readCommandPhaseJson(requestPath)).timeoutMilliseconds);
    const assertRequest = async () => {
      await ordinaryPath(selected.phaseRoot, requestPath);
      const request = await readCommandPhaseJson(requestPath);
      if (!isDeepStrictEqual(request, expectedRequest)) throw invalid();
    };
    await assertRoot(); await assertRequest(); await assertRoot();
    for (const name of ['phase-output.private.json', 'worker-result.json']) {
      let absent = false;
      try { await lstat(join(selected.phaseRoot, name)); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; absent = true; }
      if (!absent) throw invalid();
    }
    await assertRequest(); await assertRoot();
    admitted = true;
    owner = createPackagedSmokeWorkflowExecution(input, env, { signal: controller.signal });
    const { createPackagedWorkspaceDeletionPreparation } = await import('./packagedWorkspaceDeletionPreparation.mjs');
    const preparation = createPackagedWorkspaceDeletionPreparation({ signal: controller.signal,
      assertPreviousPhaseStopped: owner.assertPreviousPhaseStopped });
    // Ordinary packaged CI uses localDevelopment, not a version-bumped pilot release.
    await runPackagedSmoke({ workspaceDeletionPreparation: preparation,
      workspaceDeletionExecution: owner.execution });
    if (owner.readOutputs().length !== 4) throw invalid();
    await assertRoot(); await assertRequest(); await assertRoot();
  } catch (error) { failure = { error }; controller.abort(error); record(error, 'packagedWorkflow'); }
  if (admitted) {
    try {
      await assertRoot();
      await writeFile(join(selected.phaseRoot, 'phase-output.private.json'), JSON.stringify({
        schemaVersion: 1, binding: selected.binding, phase: selected.phase,
        phases: owner?.readOutputs() ?? [], cleanup: 'notVerified',
      }) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (error) { record(error, 'packagedWorkflowOutput'); }
    try {
      await assertRoot();
      await writeFile(join(selected.phaseRoot, 'worker-result.json'), JSON.stringify({ ...selected.binding,
        status: failure === undefined ? 'completed' : 'failed',
        resultCode: failure === undefined ? 'packagedWorkflowCompleted' : 'packagedWorkflowFailed',
        errorCode: failure === undefined ? null : 'packagedSmokeWorkflowFailed',
      }) + '\n', { flag: 'wx', mode: 0o600 });
      await assertRoot();
    } catch (error) {
      record(error, 'packagedWorkflowTerminal');
      failure = { error: failure === undefined ? error : new AggregateError([failure.error, error],
        'PACKAGED_SMOKE_JOB_TERMINAL_FAILED', { cause: failure.error }) };
    }
  }
  try { await sink.flush(); } catch { /* Delivery is distinct from the workflow. */ }
  if (failure) throw failure.error;
}

export async function runPackagedSmokeJobWorker(argumentsList, environment = process.env, sink = createEvidence(environment)) {
  const env = { ...environment };
  let input;
  try {
    input = parsePackagedSmokeJobArguments(argumentsList);
    const selected = capturePackagedSmokeJobPhase(input, env);
    if (await realpath(process.cwd()) !== selected.phaseRoot) throw invalid();
  }
  catch (error) {
    try { sink.record({ runner: 'node', phase: 'packagedPhaseArguments', attempt: 0, error }); } catch { /* Keep the first error. */ }
    try { await sink.flush(); } catch { /* Delivery is separate from admission. */ }
    throw error;
  }
  if (input.phase === 'workspaceDeletion') await runPackagedSmokeJobWorkflow(input, env, sink);
  else await runPackagedSmokeJobPhase(input, env, sink);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === workerPath) {
  runPackagedSmokeJobWorker(process.argv.slice(2)).catch(() => {
    console.error('PACKAGED_SMOKE_JOB_PHASE_FAILED'); process.exitCode = 1;
    // A failed preparation may intentionally retain an OS reservation. Its
    // owning Job, not this Promise rejection, must finish the process tree.
    if (process.argv[2] === '--phase' && process.argv[3] === 'workspaceDeletion') process.exit(1);
  });
}
