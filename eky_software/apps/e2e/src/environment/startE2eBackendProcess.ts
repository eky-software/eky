import { resolve } from 'node:path';

import type { E2eFaultPlan } from '../../../backend/e2e/e2eBackendConfig.js';
import { assertE2eSafetyBoundary } from './assertE2eSafetyBoundary.js';
import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';
import {
  startManagedProcess,
  type ManagedProcess,
} from './startManagedProcess.js';
import { stopManagedProcessTree } from './stopManagedProcessTree.js';
import { waitForHttpHealth } from './waitForHttpHealth.js';
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
  const managedProcess = startManagedProcess({
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

  try {
    await waitForHttpHealth(`${backendOrigin}/health`);
  } catch {
    await stopManagedProcessTree(managedProcess.child);
    const diagnostics = [
      managedProcess.readStdout(),
      managedProcess.readStderr(),
    ]
      .filter((output) => output !== '')
      .join('\n');
    throw new Error(
      diagnostics === ''
        ? 'E2E backend did not become healthy.'
        : `E2E backend did not become healthy.\n${diagnostics}`,
    );
  }

  return {
    backendOrigin,
    managedProcess,
    sessionSecret: config.backend.sessionSecret,
    stop: () => stopManagedProcessTree(managedProcess.child),
  };
}
