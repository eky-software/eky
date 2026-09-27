import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { E2eFaultPlan } from '../../../backend/e2e/e2eBackendConfig.js';
import { assertE2eSafetyBoundary } from './assertE2eSafetyBoundary.js';
import {
  createE2eBackendStartupReporter,
  newProgress,
  waitForManagedBackendHealth,
  type E2eBackendStartupErrorCode,
} from './e2eBackendStartupLifecycle.js';
import {
  E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS,
} from './e2eServiceStartupBudgets.js';
import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';
import type { E2eFixtureLifetime } from './e2eFixtureLifetime.js';
import type { E2eBackendWorkload } from './e2eBackendWorkload.js';
import type { ProcessOutput } from './boundedProcessOutput.js';
import {
  observeChildProcessStartup,
  type E2eProcessStartupObservation,
} from './e2eProcessStartupObservation.js';
import {
  startManagedProcess,
} from './startManagedProcess.js';
import { OwnedWindowsBackendStartupFailure, startOwnedWindowsBackend } from './startOwnedWindowsBackend.js';
import { beforeBackendOwnerDeadline } from './windowsBackendServiceControl.js';
import { readProcessRssBytes } from '../stress/readProcessRssBytes.js';
import { stopManagedProcessTree } from './stopManagedProcessTree.js';
import { waitForHttpHealth } from './waitForHttpHealth.js';
import { waitForLoopbackPortRelease } from './waitForLoopbackPortRelease.js';
import { writeE2eBackendConfig } from './writeE2eBackendConfig.js';

export interface StartedE2eBackend {
  backendOrigin: string;
  managedProcess: ProcessOutput;
  readonly workload: E2eBackendWorkload;
  sessionSecret: string;
  stop(): Promise<void>;
}

export interface E2eBackendStartupFailureEvidence {
  readonly errorCode: E2eBackendStartupErrorCode;
  readonly spawnObserved: boolean;
  readonly exitedBeforeCleanup: boolean;
  readonly listeningNotice: 'observed' | 'notObserved' | 'unavailable';
  readonly cleanup: Readonly<{
    processTree: 'stopped' | 'unverified';
    port: 'released' | 'unverified';
  }>;
}

export class E2eBackendStartupFailure extends Error {
  readonly evidence: E2eBackendStartupFailureEvidence;

  constructor(evidence: E2eBackendStartupFailureEvidence) {
    super(evidence.errorCode);
    this.evidence = Object.freeze({
      errorCode: evidence.errorCode,
      spawnObserved: evidence.spawnObserved,
      exitedBeforeCleanup: evidence.exitedBeforeCleanup,
      listeningNotice: evidence.listeningNotice,
      cleanup: Object.freeze({
        processTree: evidence.cleanup.processTree,
        port: evidence.cleanup.port,
      }),
    });
  }
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

export async function startE2eBackendProcess(input: {
  backendPort: number;
  faultPlan?: E2eFaultPlan;
  readonly lifetime: E2eFixtureLifetime;
  paths: E2eWorkerPaths;
  runRoot: string;
  scenarioId: string;
}): Promise<StartedE2eBackend> {
  const observe = createE2eBackendStartupReporter();
  const backendOrigin = `http://127.0.0.1:${String(input.backendPort)}`;
  assertE2eSafetyBoundary({
    backendHost: '127.0.0.1',
    environment: { EKY_E2E: '1' },
    paths: input.paths,
    runRoot: input.runRoot,
    smtpAdapter: 'fake',
    urls: [backendOrigin],
    webHost: '127.0.0.1',
  });
  const config = writeE2eBackendConfig({
    backendPort: input.backendPort,
    ...(input.faultPlan === undefined
      ? {}
      : { faultPlan: input.faultPlan }),
    paths: input.paths,
    scenarioId: input.scenarioId,
  });
  const entrypoint = resolve(
    repositoryRoot,
    'apps/backend/e2e-dist/e2e/backendEntrypoint.js',
  );
  observe(newProgress('processSpawnRequested', 'started'));
  const startupDeadline = performance.now() + E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS;
  let managedProcess: ProcessOutput;
  let startup: E2eProcessStartupObservation;
  let workload: E2eBackendWorkload;
  let stopProcessTree: () => Promise<void>;
  try {
    if (process.platform === 'win32') {
      const owned = await startOwnedWindowsBackend({
        repositoryRoot, runRoot: input.runRoot, runtimeConfigPath: input.paths.runtimeConfigPath,
        lifetime: input.lifetime, startupDeadline, redactedValues: [config.backend.sessionSecret],
      });
      managedProcess = owned;
      startup = owned.startup;
      workload = owned.workload;
      stopProcessTree = owned.stop;
    } else {
      // This is the existing, not-yet-migrated non-Windows path. It is not
      // accepted as T3 whole-tree ownership evidence.
      const direct = startManagedProcess({
      args: [entrypoint, '--config', input.paths.runtimeConfigPath],
      command: process.execPath,
      cwd: repositoryRoot,
      environment: {
        EKY_E2E: '1',
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        WINDIR: process.env.WINDIR,
      },
      inheritEnvironment: false,
      redactedValues: [config.backend.sessionSecret],
      });
      managedProcess = direct;
      startup = observeChildProcessStartup(direct.child);
      stopProcessTree = () => stopManagedProcessTree(direct.child);
      const launchId = randomUUID();
      workload = Object.freeze({
        get instanceId() {
          if (!startup.readState().spawnObserved || direct.child.pid === undefined) {
            throw new Error('E2E_BACKEND_WORKLOAD_UNAVAILABLE');
          }
          return launchId;
        },
        async readState() {
          const state = startup.readState();
          return state.terminal === 'exited' ? 'exited'
            : state.spawnObserved && state.terminal === undefined ? 'running' : 'unavailable';
        },
        async readRssBytes() {
          if (startup.readState().terminal !== undefined || direct.child.pid === undefined) {
            throw new Error('E2E_BACKEND_RSS_UNAVAILABLE');
          }
          return readProcessRssBytes(direct.child.pid);
        },
      });
    }
  } catch (error) {
    if (error instanceof OwnedWindowsBackendStartupFailure) {
      return reportOwnedBackendStartupFailure({
        error, backendOrigin, observe,
        releasePort: () => waitForLoopbackPortRelease(input.backendPort),
      });
    }
    observe(
      newProgress(
        'processSpawned',
        'failed',
        'E2E_BACKEND_PROCESS_SPAWN_FAILED',
      ),
    );
    throw new Error('E2E_BACKEND_PROCESS_SPAWN_FAILED');
  }

  await waitForE2eBackendStartup({
    backendOrigin,
    managedProcess: { ...managedProcess, startup },
    observe,
    waitForHealth: async (signal) => {
      const remaining = Math.floor(startupDeadline - performance.now());
      if (remaining <= 0) throw new Error('E2E_BACKEND_HEALTH_TIMEOUT');
      await waitForHttpHealth(`${backendOrigin}/health`, {
        signal,
        timeoutMilliseconds: remaining,
      });
      const state = await beforeBackendOwnerDeadline(workload.readState(), startupDeadline);
      if (state !== 'running') throw new Error('E2E_BACKEND_WORKLOAD_OBSERVATION_LOST');
    },
    stopProcessTree,
    releasePort: () => waitForLoopbackPortRelease(input.backendPort),
  });

  let stopResult: Promise<void> | undefined;
  return {
    backendOrigin,
    managedProcess,
    workload,
    sessionSecret: config.backend.sessionSecret,
    stop: () => {
      stopResult ??= (async () => {
        await stopProcessTree();
        await waitForLoopbackPortRelease(input.backendPort);
      })();
      return stopResult;
    },
  };
}

export async function reportOwnedBackendStartupFailure(input: {
  readonly error: OwnedWindowsBackendStartupFailure;
  readonly backendOrigin: string;
  readonly observe: ReturnType<typeof createE2eBackendStartupReporter>;
  releasePort(): Promise<void>;
}): Promise<never> {
  const { error } = input;
  const output = readStartupOutput(error);
  const codes = {
    preparationFailed: 'E2E_BACKEND_PROCESS_SPAWN_FAILED',
    ownerSpawnFailed: 'E2E_BACKEND_PROCESS_SPAWN_FAILED',
    launchFailed: 'E2E_BACKEND_PROCESS_SPAWN_FAILED',
    startupDeadlineExceeded: 'E2E_BACKEND_HEALTH_TIMEOUT',
    observationLost: 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST',
    workloadExited: 'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH',
  } as const;
  const errorCode = resolveStartupErrorCode(new Error(codes[error.evidence.startupFailure]), output);
  input.observe(newProgress('processSpawned', error.evidence.spawnObserved ? 'completed' : 'failed',
    error.evidence.spawnObserved ? undefined : 'E2E_BACKEND_PROCESS_SPAWN_FAILED'));
  const cleanup = await cleanupFailedStartup({
    observe: input.observe, releasePort: input.releasePort,
    async stopProcessTree() {
      // The owner already attempted bounded cleanup. Never start a fresh budget.
      if (error.evidence.processTree !== 'stopped') throw new Error('E2E_BACKEND_PROCESS_TREE_CLEANUP_FAILED');
    },
  });
  throw new E2eBackendStartupFailure({
    errorCode, spawnObserved: error.evidence.spawnObserved,
    exitedBeforeCleanup: error.evidence.exitedBeforeCleanup,
    listeningNotice: readListeningNotice(output, input.backendOrigin), cleanup,
  });
}

export async function waitForE2eBackendStartup(input: {
  readonly backendOrigin: string;
  readonly managedProcess: ProcessOutput & {
    readonly startup: E2eProcessStartupObservation;
  };
  readonly observe: ReturnType<typeof createE2eBackendStartupReporter>;
  waitForHealth(signal: AbortSignal): Promise<void>;
  stopProcessTree(): Promise<void>;
  releasePort(): Promise<void>;
}): Promise<void> {
  const startup = input.managedProcess.startup;
  let spawnObserved = false;
  const reportSpawn = () => {
    const state = startup.readState();
    if (state.spawnObserved && !spawnObserved) {
      spawnObserved = true;
      input.observe(newProgress('processSpawned', 'completed'));
    }
  };
  const unsubscribe = startup.subscribe(reportSpawn);
  try {
    reportSpawn();
    await waitForManagedBackendHealth({
      startup,
      observe: input.observe,
      waitForHealth: input.waitForHealth,
    });
  } catch (error) {
    // Capture before cleanup, which can itself change process/output state.
    const output = readStartupOutput(input.managedProcess);
    const errorCode = resolveStartupErrorCode(error, output);
    const state = startup.readState();
    const spawnedBeforeCleanup = state.spawnObserved;
    const exitedBeforeCleanup = state.terminal === 'exited';
    const listeningNotice = readListeningNotice(output, input.backendOrigin);
    const cleanup = await cleanupFailedStartup(input);
    throw new E2eBackendStartupFailure(Object.freeze({
      errorCode,
      spawnObserved: spawnedBeforeCleanup,
      exitedBeforeCleanup,
      listeningNotice,
      cleanup,
    }));
  } finally {
    unsubscribe();
  }
}

async function cleanupFailedStartup(input: {
  readonly observe: ReturnType<typeof createE2eBackendStartupReporter>;
  stopProcessTree(): Promise<void>;
  releasePort(): Promise<void>;
}): Promise<E2eBackendStartupFailureEvidence['cleanup']> {
  input.observe(newProgress('cleanupStarted', 'started'));
  let cleanupErrorCode: E2eBackendStartupErrorCode | undefined;
  let processTree: 'stopped' | 'unverified' = 'unverified';
  let port: 'released' | 'unverified' = 'unverified';
  try {
    await input.stopProcessTree();
    processTree = 'stopped';
    input.observe(newProgress('processTreeStopped', 'completed'));
  } catch (error) {
    if (error instanceof OwnedWindowsBackendStartupFailure && error.evidence.processTree === 'stopped') {
      // Cleanup proof does not turn the earlier operational failure into success.
      processTree = 'stopped';
      input.observe(newProgress('processTreeStopped', 'completed'));
    } else {
      input.observe(
      newProgress(
        'processTreeStopped',
        'failed',
        'E2E_BACKEND_PROCESS_TREE_CLEANUP_FAILED',
      ),
    );
      cleanupErrorCode = 'E2E_BACKEND_PROCESS_TREE_CLEANUP_FAILED';
    }
  }
  input.observe(newProgress('portReleaseStarted', 'started'));
  try {
    await input.releasePort();
    port = 'released';
    input.observe(newProgress('portReleased', 'completed'));
  } catch {
    input.observe(
      newProgress(
        'portReleased',
        'failed',
        'E2E_BACKEND_PORT_RELEASE_FAILED',
      ),
    );
    cleanupErrorCode ??= 'E2E_BACKEND_PORT_RELEASE_FAILED';
  }
  if (cleanupErrorCode === undefined) {
    input.observe(newProgress('cleanupCompleted', 'completed'));
  } else {
    input.observe(
      newProgress('cleanupCompleted', 'failed', cleanupErrorCode),
    );
  }
  return Object.freeze({ processTree, port });
}

function readStartupOutput(managedProcess: ProcessOutput) {
  try {
    return { stdout: managedProcess.readStdout(), stderr: managedProcess.readStderr() };
  } catch {
    return undefined;
  }
}

function readListeningNotice(
  output: ReturnType<typeof readStartupOutput>, backendOrigin: string,
): E2eBackendStartupFailureEvidence['listeningNotice'] {
  return output === undefined ? 'unavailable'
    : output.stdout.split(/\r?\n/).includes(`E2E backend listening on ${backendOrigin}`)
      ? 'observed' : 'notObserved';
}

function resolveStartupErrorCode(
  error: unknown,
  output: ReturnType<typeof readStartupOutput>,
): E2eBackendStartupErrorCode {
  const candidate = error instanceof Error ? error.message : '';
  if (candidate === 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST') return candidate;
  if (output !== undefined && `${output.stdout}\n${output.stderr}`.includes('EADDRINUSE')) {
    return 'E2E_BACKEND_LOOPBACK_ADDRESS_IN_USE';
  }
  if (
    candidate === 'E2E_BACKEND_PROCESS_SPAWN_FAILED' ||
    candidate === 'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH' ||
    candidate === 'E2E_BACKEND_HEALTH_TIMEOUT'
  ) {
    return candidate;
  }
  return 'E2E_BACKEND_HEALTH_TIMEOUT';
}
