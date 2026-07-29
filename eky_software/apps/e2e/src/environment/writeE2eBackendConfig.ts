import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import type {
  E2eBackendConfig,
  E2eFaultPlan,
} from '../../../backend/e2e/e2eBackendConfig.js';
import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';

export function writeE2eBackendConfig(input: {
  backendPort: number;
  faultPlan?: E2eFaultPlan;
  paths: E2eWorkerPaths;
  scenarioId: string;
}): E2eBackendConfig {
  const config: E2eBackendConfig = {
    backend: {
      host: '127.0.0.1',
      port: input.backendPort,
      sessionSecret: randomBytes(32).toString('base64url'),
    },
    faultPlan: input.faultPlan ?? { kind: 'none' },
    formatVersion: 1,
    marker: 'EKY_E2E',
    paths: {
      artifactsRoot: input.paths.artifactsRoot,
      databaseFilePath: input.paths.databaseFilePath,
      documentsRoot: input.paths.documentsRoot,
      incidentsRoot: input.paths.incidentsRoot,
      logsRoot: input.paths.logsRoot,
      supportBundlesRoot: input.paths.supportBundlesRoot,
      tempRoot: input.paths.tempRoot,
    },
    runtimeRoot: input.paths.workerRoot,
    scenarioId: input.scenarioId,
    smtpAdapter: 'fake',
  };

  writeFileSync(
    input.paths.runtimeConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  return config;
}
