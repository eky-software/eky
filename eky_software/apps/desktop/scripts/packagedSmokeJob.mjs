import { spawn } from 'node:child_process';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as waitForRetry } from 'node:timers/promises';

import { capturePackagedSmokeJobPhase, createPackagedSmokeJobRequest,
  packagedSmokeJobCleanupReserveMilliseconds } from './packagedSmokeJobWorker.mjs';
import { packagedSmokeTimeoutMilliseconds, packagedSmokeWorkflowTimeoutMilliseconds,
  packagedSmokeJobCallerReserveMilliseconds, packagedSmokeJobPublicationReserveMilliseconds,
  packagedSmokeJobTerminationReserveMilliseconds } from './packagedSmokeLimits.mjs';
import { capturePackagedSmokePhaseOutput } from './packagedSmokeFailureEvidence.mjs';
import { inspectPackageArtifactInventory } from './package-artifact-inventory.mjs';
import { inspectPackagedPilotSeries, requirePackagedSeriesPin } from './packagedPilotSeries.mjs';
import { packagedSelectorVerificationPhase, readPackagedSmokeBackend,
  writePackagedSmokeResult } from '../dist/main/packagedSmoke.js';
import { loopbackPortReleaseTimeoutMilliseconds, waitForLoopbackPortRelease }
  from '../../e2e/src/environment/waitForLoopbackPortRelease.ts';
import { ordinaryPath } from '../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { readCommandPhaseJson } from '../installer/windows-acceptance-harness/acceptanceCommandPhaseInput.mjs';
import { captureBoundedWindowsAdapterProcessResult, runBoundedWindowsAdapterProcess } from '../installer/windows-acceptance-harness/boundedWindowsAdapterProcess.mjs';
import { validateWindowsAcceptanceSupervisorResult } from '../installer/windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { createRunnerFailureSink } from '../../../test-reporters/runnerFailureEvidence.mjs';
import { createE2eFixtureLifetime } from '../../e2e/src/environment/e2eFixtureLifetime.ts';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../out/Eky-win32-x64');
const supervisor = resolve(here, '../installer/bin/windows-process-supervisor/Release/net10.0/Eky.WindowsProcessSupervisor.dll');
const invalid = () => new Error('PACKAGED_SMOKE_JOB_UNVERIFIED');
const exact = (value, keys) => value !== null && typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));

function readOutput(value, selected) {
  if (!exact(value, ['schemaVersion', 'binding', 'phase', 'phases', 'cleanup']) || value.schemaVersion !== 1 ||
      !isDeepStrictEqual(value.binding, selected.binding) || value.phase !== selected.phase || value.cleanup !== 'notVerified' ||
      !Array.isArray(value.phases) || value.phases.length !== (selected.phase === 'workspaceDeletion' ? 4 : 1)) throw invalid();
  if (selected.phase === 'workspaceDeletion') return Object.freeze({ status: 'verified',
    phases: Object.freeze(value.phases.map((phase, index) =>
      capturePackagedSmokePhaseOutput(phase, index === 0 ? 'restoreRestart' : 'shutdown'))) });
  return Object.freeze({ status: 'verified', phase: capturePackagedSmokePhaseOutput(value.phases[0], selected.expectedStage) });
}

// Job completion and a fresh port observation are separate, point-in-time
// receipts. Neither owns the profile or the retaining companion's lifetime.
export async function runOwnedPackagedSmokePhase(input, options) {
  return runOwnedPackagedSmokeJob(input, options, false);
}

export async function runOwnedPackagedSmokeWorkflow(input, options) {
  return runOwnedPackagedSmokeJob(input, options, true);
}

async function runOwnedPackagedSmokeJob(input, { environment = process.env, signal, lifetime,
  runProcess = runBoundedWindowsAdapterProcess, sink = createRunnerFailureSink({ env: environment,
    tempRoot: environment.RUNNER_TEMP }),
} = {}, workflow) {
  const env = { ...environment };
  const maximum = workflow ? packagedSmokeWorkflowTimeoutMilliseconds : packagedSmokeTimeoutMilliseconds;
  const work = lifetime ?? createE2eFixtureLifetime(maximum);
  let selected, metadata, firstObserved, report, directResult, listening = false;
  let portRelease = Object.freeze({ status: 'unverified' });
  let cleanup = workflow ? Object.freeze({ status: 'notAttempted' }) : undefined;
  const roots = new Map();
  const record = (error, phase) => {
    try { sink.record({ runner: 'node', phase, attempt: 0, testId: selected?.binding.scenario ?? null, error }); }
    catch { /* Reporting cannot replace the owned process result. */ }
  };
  const observe = error => { firstObserved ??= { error }; record(error, 'packagedJobOriginal'); };
  const cancelled = () => { firstObserved ??= { error: signal.reason }; record(signal.reason, 'packagedJobCancellation'); };
  const remainingWork = () => {
    const remaining = work.readRemainingWorkMilliseconds();
    if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > maximum) throw invalid();
    return remaining;
  };
  const current = () => {
    signal?.throwIfAborted();
    if (workflow && remainingWork() <= 0) throw new Error('PACKAGED_SMOKE_WORKFLOW_DEADLINE_EXCEEDED');
  };
  const assertRoots = async (includeJobs = true) => {
    current();
    const paths = [selected.root, join(selected.root, 'result'), ...(includeJobs ? [dirname(selected.phaseRoot)] : [])];
    for (const path of paths) {
      const info = await ordinaryPath(selected.temp, path, true); current();
      const observed = { dev: info.dev, ino: info.ino };
      if (roots.has(path) && !isDeepStrictEqual(roots.get(path), observed)) throw invalid();
      roots.set(path, observed);
    }
  };
  let failure, value;
  try {
    if (process.platform !== 'win32' || signal !== undefined && !(signal instanceof AbortSignal)) throw invalid();
    selected = capturePackagedSmokeJobPhase(input, env);
    metadata = Object.freeze({ ...input });
    if ((selected.phase === 'workspaceDeletion') !== workflow) throw invalid();
    signal?.addEventListener('abort', cancelled, { once: true });
    listening = signal !== undefined;
    current();
    if (workflow) {
      await mkdir(dirname(selected.root), { recursive: true, mode: 0o700 }); current();
      await ordinaryPath(selected.temp, dirname(selected.root), true); current();
      await mkdir(selected.root, { mode: 0o700 }); current();
      await mkdir(join(selected.root, 'result'), { mode: 0o700 }); current();
    }
    await assertRoots(false);
    const inventory = await inspectPackageArtifactInventory({ root: packageRoot, stage: 'packagedApp' }); current();
    if (inventory.identity !== selected.binding.artifactDescriptorSha256) throw invalid();
    if (workflow) {
      const pilot = await inspectPackagedPilotSeries(requirePackagedSeriesPin(env), {
        assertCurrent: current, inspectInventory: async () => inventory,
      });
      if (pilot.manifest.inventoryIdentity !== selected.binding.artifactDescriptorSha256) throw invalid();
    }
    await assertRoots(false);
    try { await mkdir(dirname(selected.phaseRoot), { mode: 0o700 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    await assertRoots();
    // A reused nonce must not reset or overwrite the preceding phase's state.
    await mkdir(selected.phaseRoot, { mode: 0o700 }); current();
    const phaseIdentity = await ordinaryPath(selected.temp, selected.phaseRoot, true); current();
    const assertSelected = async () => {
      await assertRoots();
      const info = await ordinaryPath(selected.temp, selected.phaseRoot, true); current();
      if (info.dev !== phaseIdentity.dev || info.ino !== phaseIdentity.ino) throw invalid();
    };
    const resultPath = join(selected.root, 'result', 'desktop-smoke-result.json');
    try { await lstat(resultPath); await ordinaryPath(selected.root, resultPath); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await assertSelected();
    await writePackagedSmokeResult({ enabled: true, phase: 'initial', root: selected.root, userDataPath: undefined },
      { stage: 'startup', status: 'started' });
    await assertSelected();
    if (!isDeepStrictEqual(await readCommandPhaseJson(resultPath), { stage: 'startup', status: 'started' })) throw invalid();
    await assertSelected();
    const requestPath = join(selected.phaseRoot, 'request.json');
    const remaining = remainingWork;
    const nativeBudget = remaining() - packagedSmokeJobCallerReserveMilliseconds;
    if (nativeBudget <= packagedSmokeJobCleanupReserveMilliseconds) throw new Error('PACKAGED_SMOKE_WORKFLOW_DEADLINE_EXCEEDED');
    const request = createPackagedSmokeJobRequest(metadata, env, nativeBudget);
    await writeFile(requestPath, JSON.stringify(request) + '\n', { flag: 'wx', mode: 0o600 });
    await assertSelected();
    const processBudget = remaining();
    // The native clock starts later. Keep request publication/startup, native
    // cleanup, result publication/exit and the last-resort kill inside one cap.
    if (processBudget <= request.timeoutMilliseconds + packagedSmokeJobPublicationReserveMilliseconds +
        packagedSmokeJobTerminationReserveMilliseconds) throw new Error('PACKAGED_SMOKE_WORKFLOW_DEADLINE_EXCEEDED');
    directResult = captureBoundedWindowsAdapterProcessResult(await runProcess({ command: env.EKY_DOTNET_EXE || 'dotnet',
      arguments: [supervisor, '--request', requestPath], cwd: selected.phaseRoot,
      timeoutMilliseconds: processBudget - packagedSmokeJobTerminationReserveMilliseconds,
      terminationTimeoutMilliseconds: packagedSmokeJobTerminationReserveMilliseconds, signal,
      observe(phase, status) {
        if (phase === 'deadline' && status === 'failed') {
          const error = new Error('PACKAGED_SMOKE_JOB_DEADLINE_EXCEEDED');
          firstObserved ??= { error }; record(error, 'packagedJobDeadline');
        }
      },
      spawnProcess(command, args, options) {
        let child;
        try { child = spawn(command, args, { ...options, env, shell: false }); }
        catch (error) { observe(error); throw error; }
        child.on('error', observe); return child;
      } }));
    if (directResult.status !== 'completed' || directResult.directProcessAbsent !== true ||
        ![0, 1].includes(directResult.exitCode)) {
      const error = new Error('PACKAGED_SMOKE_JOB_PROCESS_FAILED:' + JSON.stringify(directResult));
      record(error, 'packagedJobProcess'); throw error;
    }
    current();
    await assertSelected();
    const terminalPath = join(selected.phaseRoot, 'result.json');
    await ordinaryPath(selected.phaseRoot, terminalPath);
    report = validateWindowsAcceptanceSupervisorResult(await readCommandPhaseJson(terminalPath),
      { ...selected.binding, supervisorExitCode: directResult.exitCode });
    await assertSelected();
    if (report.status !== 'completed') throw new Error('PACKAGED_SMOKE_JOB_SUPERVISOR_FAILED:' + JSON.stringify({
      processResultCode: report.processResultCode, workerResultCode: report.workerResultCode,
      cleanupResultCode: report.cleanupResultCode, processTreeAbsent: report.processTreeAbsent,
      childExitCode: report.childExitCode, processWin32ErrorCode: report.processWin32ErrorCode,
      cleanupWin32ErrorCode: report.cleanupWin32ErrorCode }));
    const workerPath = join(selected.phaseRoot, 'worker-result.json');
    await ordinaryPath(selected.phaseRoot, workerPath);
    const worker = await readCommandPhaseJson(workerPath);
    if (!isDeepStrictEqual(worker, { ...selected.binding, status: 'completed',
      resultCode: workflow ? 'packagedWorkflowCompleted' : 'packagedPhaseCompleted', errorCode: null })) throw invalid();
    await assertSelected();
    let diagnostic;
    try {
      const path = join(selected.phaseRoot, 'phase-output.private.json');
      await ordinaryPath(selected.phaseRoot, path);
      diagnostic = readOutput(await readCommandPhaseJson(path), selected);
    } catch (error) { record(error, 'packagedJobOutput'); diagnostic = Object.freeze({ status: 'unavailable' }); }
    await assertSelected();
    let observation;
    const observedPhases = diagnostic.status === 'verified' ? (workflow ? diagnostic.phases : [diagnostic.phase]) : [];
    if (observedPhases.length > 0 && observedPhases.every(phase => !phase.stdout.partial)) {
      try {
        const phases = workflow ? ['initial', 'restoredProfile', 'selectorRecovery', 'selectorRestart'] : [selected.phase];
        observation = { ports: observedPhases.map((phase, index) => readPackagedSmokeBackend(phase.stdout.text,
          phases[index].startsWith('selector') ? packagedSelectorVerificationPhase : phases[index]))
          .filter(port => port !== undefined) };
      } catch (error) { record(error, 'packagedJobPortObservation'); }
    } else record(new Error('PACKAGED_SMOKE_JOB_PORT_OBSERVATION_UNAVAILABLE'), 'packagedJobPortObservation');
    if (observation !== undefined) {
      if (observation.ports.length === 0) portRelease = Object.freeze({ status: 'notStarted' });
      else {
        try {
          for (const port of observation.ports) {
            const budget = remaining();
            if (budget <= 0) throw new Error('PACKAGED_SMOKE_JOB_PORT_DEADLINE_EXCEEDED');
            await waitForLoopbackPortRelease(port, Math.min(loopbackPortReleaseTimeoutMilliseconds, budget));
            current(); await assertSelected();
            if (remaining() <= 0) throw new Error('PACKAGED_SMOKE_JOB_PORT_DEADLINE_EXCEEDED');
          }
          portRelease = Object.freeze({ status: 'verified' });
        } catch (error) { portRelease = Object.freeze({ status: 'failed' }); observe(error); throw error; }
      }
    }
    await assertSelected();
    if (remaining() <= 0) {
      portRelease = Object.freeze({ status: 'failed' });
      const error = new Error('PACKAGED_SMOKE_JOB_PORT_DEADLINE_EXCEEDED');
      observe(error); throw error;
    }
    if (workflow) {
      if (diagnostic.status === 'verified' && portRelease.status === 'verified') {
        await assertSelected(); current();
        cleanup = Object.freeze({ status: 'started' });
        // Retry only between settled calls. Node's internal retry delays cannot
        // observe this workflow's remaining budget or cancellation.
        for (let attempt = 0; ; attempt++) {
          current();
          const info = await ordinaryPath(selected.temp, selected.root, true); current();
          if (!isDeepStrictEqual({ dev: info.dev, ino: info.ino }, roots.get(selected.root))) throw invalid();
          try { await rm(selected.root, { recursive: true, maxRetries: 0 }); }
          catch (error) {
            current();
            if (attempt >= 20 || !['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
            const budget = remaining();
            if (budget <= 0) throw new Error('PACKAGED_SMOKE_WORKFLOW_DEADLINE_EXCEEDED');
            await waitForRetry(Math.min((attempt + 1) * 100, budget), undefined, { signal });
            current(); continue;
          }
          break;
        }
        current(); cleanup = Object.freeze({ status: 'verified' });
      }
    }
    value = Object.freeze({ binding: selected.binding, supervisorResult: report, diagnostic, portRelease,
      ...(workflow ? { cleanup } : {}) });
  } catch (error) {
    if (cleanup?.status === 'started') cleanup = Object.freeze({ status: 'failed' });
    failure = { error: firstObserved === undefined || firstObserved.error === error ? error :
      new AggregateError([firstObserved.error, error], 'PACKAGED_SMOKE_JOB_FAILED', { cause: firstObserved.error }) };
    if (report !== undefined || directResult !== undefined) {
      const message = portRelease.status === 'failed' ? 'PACKAGED_SMOKE_JOB_UNVERIFIED:' + JSON.stringify({
        portRelease: portRelease.status, applicationPhase: 'completed', supervisorStatus: report?.status,
      }) : 'PACKAGED_SMOKE_JOB_UNVERIFIED';
      const wrapped = new AggregateError([failure.error], message,
        { cause: firstObserved === undefined ? failure.error : firstObserved.error });
      if (report !== undefined) Object.defineProperty(wrapped, 'supervisorResult', { value: report });
      if (directResult !== undefined) Object.defineProperty(wrapped, 'directProcessResult', { value: directResult });
      Object.defineProperty(wrapped, 'portRelease', { value: portRelease });
      if (workflow) Object.defineProperty(wrapped, 'cleanup', { value: cleanup });
      failure = { error: wrapped };
    }
    record(failure.error, 'packagedJob');
  }
  if (listening) signal.removeEventListener('abort', cancelled);
  try { await sink.flush(); } catch { /* Delivery is separate from the phase. */ }
  if (failure !== undefined) throw failure.error;
  return value;
}
