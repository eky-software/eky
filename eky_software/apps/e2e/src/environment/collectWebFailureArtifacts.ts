import type { TestInfo } from '@playwright/test';

import type { StartedE2eBackend } from './startE2eBackendProcess.js';
import { collectE2eFailureArtifacts } from './collectE2eFailureArtifacts.js';
import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';
import type { StartedE2eWeb } from './startE2eWebProcess.js';

export async function collectWebFailureArtifacts(input: {
  backend: StartedE2eBackend;
  paths: E2eWorkerPaths;
  runRoot: string;
  scenarioId: string;
  testInfo: TestInfo;
  web: StartedE2eWeb;
}): Promise<void> {
  await collectE2eFailureArtifacts({
    paths: input.paths,
    processes: [
      {
        artifactName: 'backend',
        managedProcess: input.backend.managedProcess,
      },
      {
        artifactName: 'web',
        managedProcess: input.web.managedProcess,
      },
    ],
    runRoot: input.runRoot,
    scenarioId: input.scenarioId,
    testInfo: input.testInfo,
  });
}
