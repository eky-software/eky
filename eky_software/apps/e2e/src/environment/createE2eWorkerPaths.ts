import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';

const scenarioIdPattern = /^[A-Z][A-Z0-9-]{2,63}$/;

export function createE2eWorkerPaths(
  runRoot: string,
  scenarioId: string,
): E2eWorkerPaths {
  if (!scenarioIdPattern.test(scenarioId)) {
    throw new Error('E2E scenario id is invalid.');
  }

  const workerRoot = createPrivateDirectory(join(runRoot, scenarioId));
  const databaseRoot = createPrivateDirectory(join(workerRoot, 'database'));

  return {
    artifactsRoot: createPrivateDirectory(join(workerRoot, 'artifacts')),
    databaseFilePath: join(databaseRoot, 'eky-e2e.sqlite'),
    documentsRoot: createPrivateDirectory(join(workerRoot, 'documents')),
    incidentsRoot: createPrivateDirectory(join(workerRoot, 'incidents')),
    logsRoot: createPrivateDirectory(join(workerRoot, 'logs')),
    runtimeConfigPath: join(workerRoot, 'runtime-config.json'),
    supportBundlesRoot: createPrivateDirectory(
      join(workerRoot, 'support-bundles'),
    ),
    tempRoot: createPrivateDirectory(join(workerRoot, 'temp')),
    workerRoot,
  };
}

function createPrivateDirectory(path: string): string {
  mkdirSync(path, { mode: 0o700, recursive: true });
  return realpathSync.native(path);
}
