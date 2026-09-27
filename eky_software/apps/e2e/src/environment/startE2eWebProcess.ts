import { resolve } from 'node:path';

import { assertE2eSafetyBoundary } from './assertE2eSafetyBoundary.js';
import type { ProcessOutput } from './boundedProcessOutput.js';
import {
  E2E_WEB_STARTUP_SAFETY_TIMEOUT_MILLISECONDS,
} from './e2eServiceStartupBudgets.js';
import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';
import type { E2eFixtureLifetime } from './e2eFixtureLifetime.js';
import { observeChildProcessStartup, type E2eProcessStartupObservation } from './e2eProcessStartupObservation.js';
import { cleanupFailedWebStartup, E2eWebStartupFailure, waitForE2eWebStartup } from './e2eWebStartupLifecycle.js';
import { startManagedProcess } from './startManagedProcess.js';
import type { StartedE2eBackend } from './startE2eBackendProcess.js';
import { OwnedWindowsViteStartupFailure, startOwnedWindowsVite } from './startOwnedWindowsVite.js';
import { stopManagedProcessTree } from './stopManagedProcessTree.js';
import { waitForHttpHealth } from './waitForHttpHealth.js';
import { waitForLoopbackPortRelease } from './waitForLoopbackPortRelease.js';
import { beforeViteOwnerDeadline } from './windowsViteServiceControl.js';

export { E2eWebStartupFailure } from './e2eWebStartupLifecycle.js';

export interface StartedE2eWeb {
  managedProcess: ProcessOutput;
  readonly workload: { readState(): Promise<'running' | 'exited' | 'unavailable'> };
  stop(): Promise<void>;
  webOrigin: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const webRoot = resolve(repositoryRoot, 'apps/web');
const viteEntrypoint = resolve(webRoot, 'node_modules/vite/bin/vite.js');

export async function startE2eWebProcess(input: {
  backend: StartedE2eBackend;
  readonly lifetime: E2eFixtureLifetime;
  paths: E2eWorkerPaths;
  runRoot: string;
  webPort: number;
}): Promise<StartedE2eWeb> {
  const webOrigin = `http://127.0.0.1:${String(input.webPort)}`;
  assertE2eSafetyBoundary({
    backendHost: '127.0.0.1',
    environment: { EKY_E2E: '1' },
    paths: input.paths,
    runRoot: input.runRoot,
    smtpAdapter: 'fake',
    urls: [input.backend.backendOrigin, webOrigin],
    webHost: '127.0.0.1',
  });

  const startupDeadline = performance.now() + Math.min(E2E_WEB_STARTUP_SAFETY_TIMEOUT_MILLISECONDS,
    input.lifetime.readRemainingWorkMilliseconds());
  let managedProcess: ProcessOutput;
  let startup: E2eProcessStartupObservation;
  let workload: StartedE2eWeb['workload'];
  let stopProcessTree: () => Promise<void>;
  const releasePort = () => waitForLoopbackPortRelease(input.webPort);
  try {
    if (performance.now() >= startupDeadline) throw new Error('E2E_WEB_HEALTH_TIMEOUT');
    if (process.platform === 'win32') {
      const owned = await startOwnedWindowsVite({
        repositoryRoot, runRoot: input.runRoot, webPort: input.webPort,
        environmentRoot: input.paths.tempRoot, backendOrigin: input.backend.backendOrigin,
        sessionSecret: input.backend.sessionSecret, lifetime: input.lifetime,
        startupDeadline, redactedValues: [input.backend.sessionSecret],
      });
      managedProcess = owned;
      startup = owned.startup;
      workload = owned.workload;
      stopProcessTree = owned.stop;
    } else {
      // Existing non-Windows path; not evidence of T3 whole-tree ownership.
      const direct = startManagedProcess({
        args: [viteEntrypoint, '--config', 'vite.config.ts', '--host', '127.0.0.1',
          '--port', String(input.webPort), '--strictPort', '--mode', 'eky-e2e'],
        command: process.execPath, cwd: webRoot,
        environment: {
          EKY_E2E: '1', EKY_E2E_BACKEND_ORIGIN: input.backend.backendOrigin,
          EKY_E2E_ENV_ROOT: input.paths.tempRoot, EKY_E2E_RUNTIME_SESSION: input.backend.sessionSecret,
          NODE_ENV: 'test', PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP, TMP: process.env.TMP, WINDIR: process.env.WINDIR,
        },
        inheritEnvironment: false, redactedValues: [input.backend.sessionSecret],
      });
      managedProcess = direct;
      startup = observeChildProcessStartup(direct.child);
      stopProcessTree = () => stopManagedProcessTree(direct.child);
      workload = { async readState() {
        const state = startup.readState();
        return state.terminal === 'exited' ? 'exited'
          : state.spawnObserved && state.terminal === undefined ? 'running' : 'unavailable';
      } };
    }
  } catch (error) {
    const owned = error instanceof OwnedWindowsViteStartupFailure ? error : undefined;
    const cleanup = await cleanupFailedWebStartup({
      async stopProcessTree() {
        // No new cleanup deadline after the owner's already-attempted stop.
        if (owned?.evidence.processTree !== 'stopped') throw new Error('E2E_WEB_CLEANUP_UNVERIFIED');
      }, releasePort,
    });
    const code = owned?.evidence.startupFailure;
    throw new E2eWebStartupFailure({
      errorCode: code === 'startupDeadlineExceeded' || (error instanceof Error && error.message === 'E2E_WEB_HEALTH_TIMEOUT')
        ? 'E2E_WEB_HEALTH_TIMEOUT'
        : code === 'observationLost' ? 'E2E_WEB_WORKLOAD_OBSERVATION_LOST'
        : code === 'workloadExited' ? 'E2E_WEB_CHILD_EXITED_BEFORE_HEALTH' : 'E2E_WEB_PROCESS_SPAWN_FAILED',
      spawnObserved: owned?.evidence.spawnObserved ?? false,
      exitedBeforeCleanup: owned?.evidence.exitedBeforeCleanup ?? false, cleanup,
    });
  }

  await waitForE2eWebStartup({
    startup, stopProcessTree, releasePort,
    async waitForHealth(signal) {
      const remaining = Math.floor(startupDeadline - performance.now());
      if (remaining <= 0) throw new Error('E2E_WEB_HEALTH_TIMEOUT');
      await waitForHttpHealth(webOrigin, { signal, timeoutMilliseconds: remaining });
      const state = await beforeViteOwnerDeadline(workload.readState(), startupDeadline);
      if (state !== 'running') throw new Error('E2E_WEB_WORKLOAD_OBSERVATION_LOST');
    },
  });
  let stopResult: Promise<void> | undefined;
  return {
    managedProcess, workload, webOrigin,
    stop() {
      stopResult ??= (async () => { await stopProcessTree(); await releasePort(); })();
      return stopResult;
    },
  };
}
