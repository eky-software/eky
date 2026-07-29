import { rmSync } from 'node:fs';

import {
  request as requestFactory,
  test as base,
  type APIRequestContext,
} from '@playwright/test';

import type { StartedE2eBackend } from '../environment/startE2eBackendProcess.js';
import { collectBackendFailureArtifacts } from '../environment/collectBackendFailureArtifacts.js';
import { createE2eRunRoot } from '../environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../environment/createE2eWorkerPaths.js';
import type { E2eWorkerPaths } from '../environment/e2eEnvironmentTypes.js';
import { reserveLoopbackPort } from '../environment/reserveLoopbackPort.js';
import { startE2eBackendProcess } from '../environment/startE2eBackendProcess.js';
import { readE2eScenarioId } from './readE2eScenarioId.js';

export interface IsolatedBackendHarness {
  anonymousApi: APIRequestContext;
  api: APIRequestContext;
  backend: StartedE2eBackend;
  paths: E2eWorkerPaths;
  runRoot: string;
}

interface IsolatedBackendFixtures {
  e2eBackend: IsolatedBackendHarness;
}

export const test = base.extend<IsolatedBackendFixtures>({
  e2eBackend: async ({}, use, testInfo) => {
    const scenarioId = readE2eScenarioId(testInfo.title);
    const runRoot = createE2eRunRoot();
    const paths = createE2eWorkerPaths(runRoot, scenarioId);
    let anonymousApi: APIRequestContext | undefined;
    let api: APIRequestContext | undefined;
    let backend: StartedE2eBackend | undefined;

    try {
      backend = await startE2eBackendProcess({
        backendPort: await reserveLoopbackPort(),
        paths,
        runRoot,
        scenarioId,
      });
      anonymousApi = await requestFactory.newContext({
        baseURL: backend.backendOrigin,
        extraHTTPHeaders: { Accept: 'application/json' },
      });
      api = await requestFactory.newContext({
        baseURL: backend.backendOrigin,
        extraHTTPHeaders: {
          Accept: 'application/json',
          'x-eky-local-session': backend.sessionSecret,
        },
      });
      await use({ anonymousApi, api, backend, paths, runRoot });
    } finally {
      await api?.dispose();
      await anonymousApi?.dispose();
      await backend?.stop();
      try {
        if (
          backend !== undefined &&
          testInfo.status !== testInfo.expectedStatus
        ) {
          await collectBackendFailureArtifacts({
            backend,
            paths,
            runRoot,
            scenarioId,
            testInfo,
          });
        }
      } finally {
        rmSync(runRoot, { force: true, recursive: true });
      }
    }
  },
});

export { expect } from '@playwright/test';
