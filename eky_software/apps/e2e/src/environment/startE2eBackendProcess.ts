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
    observe(newProgress('processSpawned', 'completed'));
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

  try {
    await waitForManagedBackendHealth({
      child: managedProcess.child,
      observe,
      waitForHealth: (signal) =>
        waitForHttpHealth(`${backendOrigin}/health`, {
          signal,
          timeoutMilliseconds:
            E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS,
        }),
    });
  } catch (error) {
    const startupErrorCode = resolveStartupErrorCode(error, managedProcess);
    const cleanupErrorCode = await cleanupFailedStartup({
      backendPort: input.backendPort,
      child: managedProcess.child,
      observe,
    });
    throw new Error(cleanupErrorCode ?? startupErrorCode);
  }

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

async function cleanupFailedStartup(input: {
  readonly backendPort: number;
  readonly child: ManagedProcess['child'];
  readonly observe: ReturnType<typeof createE2eBackendStartupReporter>;
}): Promise<E2eBackendStartupErrorCode | undefined> {
  input.observe(newProgress('cleanupStarted', 'started'));
  let cleanupErrorCode: E2eBackendStartupErrorCode | undefined;
  try {
    await stopManagedProcessTree(input.child);
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
    await waitForLoopbackPortRelease(input.backendPort);
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
  return cleanupErrorCode;
}

function resolveStartupErrorCode(
  error: unknown,
  managedProcess: ManagedProcess,
): E2eBackendStartupErrorCode {
  const output = `${managedProcess.readStdout()}\n${managedProcess.readStderr()}`;
  if (output.includes('EADDRINUSE')) {
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
