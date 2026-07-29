import { resolve } from 'node:path';

import { assertE2eSafetyBoundary } from './assertE2eSafetyBoundary.js';
import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';
import {
  startManagedProcess,
  type ManagedProcess,
} from './startManagedProcess.js';
import type { StartedE2eBackend } from './startE2eBackendProcess.js';
import { stopManagedProcessTree } from './stopManagedProcessTree.js';
import { waitForHttpHealth } from './waitForHttpHealth.js';

export interface StartedE2eWeb {
  managedProcess: ManagedProcess;
  stop(): Promise<void>;
  webOrigin: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const webRoot = resolve(repositoryRoot, 'apps/web');
const viteEntrypoint = resolve(webRoot, 'node_modules/vite/bin/vite.js');

export async function startE2eWebProcess(input: {
  backend: StartedE2eBackend;
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

  const managedProcess = startManagedProcess({
    args: [
      viteEntrypoint,
      '--config',
      'vite.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      String(input.webPort),
      '--strictPort',
      '--mode',
      'eky-e2e',
    ],
    command: process.execPath,
    cwd: webRoot,
    environment: {
      EKY_E2E: '1',
      EKY_E2E_BACKEND_ORIGIN: input.backend.backendOrigin,
      EKY_E2E_ENV_ROOT: input.paths.tempRoot,
      EKY_E2E_RUNTIME_SESSION: input.backend.sessionSecret,
      NODE_ENV: 'test',
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      WINDIR: process.env.WINDIR,
    },
    inheritEnvironment: false,
    redactedValues: [input.backend.sessionSecret],
  });

  try {
    await waitForHttpHealth(webOrigin);
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
        ? 'E2E web did not become healthy.'
        : `E2E web did not become healthy.\n${diagnostics}`,
    );
  }

  return {
    managedProcess,
    stop: () => stopManagedProcessTree(managedProcess.child),
    webOrigin,
  };
}
