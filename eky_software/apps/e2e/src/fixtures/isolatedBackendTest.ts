import { rmSync } from 'node:fs';

import {
  request as requestFactory,
  test as base,
  type APIRequestContext,
} from '@playwright/test';

import type { E2eFaultPlan } from '../../../backend/e2e/e2eBackendConfig.js';
import type { StartedE2eBackend } from '../environment/startE2eBackendProcess.js';
import { collectBackendFailureArtifacts } from '../environment/collectBackendFailureArtifacts.js';
import { createE2eRunRoot } from '../environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../environment/createE2eWorkerPaths.js';
import type { E2eWorkerPaths } from '../environment/e2eEnvironmentTypes.js';
import { reserveLoopbackPort } from '../environment/reserveLoopbackPort.js';
import { startE2eBackendProcess } from '../environment/startE2eBackendProcess.js';
import { waitForLoopbackPortRelease } from '../environment/waitForLoopbackPortRelease.js';
import { readE2eScenarioId } from './readE2eScenarioId.js';

export interface IsolatedBackendHarness {
  anonymousApi: APIRequestContext;
  api: APIRequestContext;
  backend: StartedE2eBackend;
  paths: E2eWorkerPaths;
  restartBackend(): Promise<{
    api: APIRequestContext;
    backend: StartedE2eBackend;
  }>;
  runRoot: string;
}

interface IsolatedBackendFixtures {
  e2eBackend: IsolatedBackendHarness;
}

interface IsolatedBackendOptions {
  e2eFaultPlan: E2eFaultPlan;
}

export const test = base.extend<
  IsolatedBackendFixtures & IsolatedBackendOptions
>({
  e2eFaultPlan: [{ kind: 'none' }, { option: true }],
  e2eBackend: async ({ e2eFaultPlan }, use, testInfo) => {
    const scenarioId = readE2eScenarioId(testInfo.title);
    const runRoot = createE2eRunRoot();
    const paths = createE2eWorkerPaths(runRoot, scenarioId);
    let anonymousApi: APIRequestContext | undefined;
    let api: APIRequestContext | undefined;
    let backend: StartedE2eBackend | undefined;
    let backendPort: number | undefined;
    const authenticatedApis: APIRequestContext[] = [];

    try {
      backendPort = await reserveLoopbackPort();
      backend = await startE2eBackendProcess({
        backendPort,
        faultPlan: e2eFaultPlan,
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
      authenticatedApis.push(api);
      const harness = {
        anonymousApi,
        get api() {
          if (api === undefined) {
            throw new Error('E2E backend API is unavailable.');
          }
          return api;
        },
        get backend() {
          if (backend === undefined) {
            throw new Error('E2E backend is unavailable.');
          }
          return backend;
        },
        paths,
        async restartBackend() {
          if (backend === undefined || backendPort === undefined) {
            throw new Error('E2E backend cannot be restarted.');
          }
          await backend.stop();
          await waitForLoopbackPortRelease(backendPort);
          backend = await startE2eBackendProcess({
            backendPort,
            paths,
            runRoot,
            scenarioId,
          });
          api = await requestFactory.newContext({
            baseURL: backend.backendOrigin,
            extraHTTPHeaders: {
              Accept: 'application/json',
              'x-eky-local-session': backend.sessionSecret,
            },
          });
          authenticatedApis.push(api);
          return { api, backend };
        },
        runRoot,
      } satisfies IsolatedBackendHarness;
      await use(harness);
    } finally {
      await Promise.all(
        authenticatedApis.map((authenticatedApi) =>
          authenticatedApi.dispose(),
        ),
      );
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
        if (backendPort !== undefined) {
          await waitForLoopbackPortRelease(backendPort);
        }
        rmSync(runRoot, { force: true, recursive: true });
      }
    }
  },
});

export { expect } from '@playwright/test';
