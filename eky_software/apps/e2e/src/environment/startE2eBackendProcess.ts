import { resolve } from 'node:path';

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
import {
  startManagedProcess,
  type ManagedProcess,
} from './startManagedProcess.js';
import { stopManagedProcessTree } from './stopManagedProcessTree.js';
import { waitForHttpHealth } from './waitForHttpHealth.js';
import { waitForLoopbackPortRelease } from './waitForLoopbackPortRelease.js';
import { writeE2eBackendConfig } from './writeE2eBackendConfig.js';

export interface StartedE2eBackend {
  backendOrigin: string;
  managedProcess: ManagedProcess;
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
  let managedProcess: ManagedProcess;
  try {
    managedProcess = startManagedProcess({
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
  } catch {
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
    managedProcess,
    observe,
    waitForHealth: (signal) =>
      waitForHttpHealth(`${backendOrigin}/health`, {
        signal,
        timeoutMilliseconds: E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS,
      }),
    stopProcessTree: () => stopManagedProcessTree(managedProcess.child),
    releasePort: () => waitForLoopbackPortRelease(input.backendPort),
  });

  return {
    backendOrigin,
    managedProcess,
    sessionSecret: config.backend.sessionSecret,
    stop: async () => {
      await stopManagedProcessTree(managedProcess.child);
      await waitForLoopbackPortRelease(input.backendPort);
    },
  };
}

export async function waitForE2eBackendStartup(input: {
  readonly backendOrigin: string;
  readonly managedProcess: ManagedProcess;
  readonly observe: ReturnType<typeof createE2eBackendStartupReporter>;
  waitForHealth(signal: AbortSignal): Promise<void>;
  stopProcessTree(): Promise<void>;
  releasePort(): Promise<void>;
}): Promise<void> {
  const child = input.managedProcess.child;
  let spawnObserved = false;
  const onSpawn = () => {
    spawnObserved = true;
    input.observe(newProgress('processSpawned', 'completed'));
  };
  child.once('spawn', onSpawn);
  try {
    await waitForManagedBackendHealth({
      child,
      observe: input.observe,
      waitForHealth: input.waitForHealth,
    });
  } catch (error) {
    // Capture before cleanup, which can itself change process/output state.
    const output = readStartupOutput(input.managedProcess);
    const errorCode = resolveStartupErrorCode(error, output);
    const spawnedBeforeCleanup = spawnObserved;
    const exitedBeforeCleanup = child.exitCode !== null || child.signalCode !== null;
    const listeningNotice = output === undefined
      ? 'unavailable'
      : output.stdout.split(/\r?\n/).includes(`E2E backend listening on ${input.backendOrigin}`)
        ? 'observed'
        : 'notObserved';
    const cleanup = await cleanupFailedStartup(input);
    throw new E2eBackendStartupFailure(Object.freeze({
      errorCode,
      spawnObserved: spawnedBeforeCleanup,
      exitedBeforeCleanup,
      listeningNotice,
      cleanup,
    }));
  } finally {
    child.removeListener('spawn', onSpawn);
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
  } catch {
    input.observe(
      newProgress(
        'processTreeStopped',
        'failed',
        'E2E_BACKEND_PROCESS_TREE_CLEANUP_FAILED',
      ),
    );
    cleanupErrorCode = 'E2E_BACKEND_PROCESS_TREE_CLEANUP_FAILED';
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

function readStartupOutput(managedProcess: ManagedProcess) {
  try {
    return { stdout: managedProcess.readStdout(), stderr: managedProcess.readStderr() };
  } catch {
    return undefined;
  }
}

function resolveStartupErrorCode(
  error: unknown,
  output: ReturnType<typeof readStartupOutput>,
): E2eBackendStartupErrorCode {
  if (output !== undefined && `${output.stdout}\n${output.stderr}`.includes('EADDRINUSE')) {
    return 'E2E_BACKEND_LOOPBACK_ADDRESS_IN_USE';
  }
  const candidate = error instanceof Error ? error.message : '';
  if (
    candidate === 'E2E_BACKEND_PROCESS_SPAWN_FAILED' ||
    candidate === 'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH' ||
    candidate === 'E2E_BACKEND_HEALTH_TIMEOUT'
  ) {
    return candidate;
  }
  return 'E2E_BACKEND_HEALTH_TIMEOUT';
}
