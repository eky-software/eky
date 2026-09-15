import {
  request as requestFactory,
  test as base,
  type APIRequestContext,
  type TestInfo,
} from '@playwright/test';

import type { E2eFaultPlan } from '../../../backend/e2e/e2eBackendConfig.js';
import type { StartedE2eBackend } from '../environment/startE2eBackendProcess.js';
import { collectBackendFailureArtifacts } from '../environment/collectBackendFailureArtifacts.js';
import { createE2eRunRoot } from '../environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../environment/createE2eWorkerPaths.js';
import type { E2eWorkerPaths } from '../environment/e2eEnvironmentTypes.js';
import { reserveLoopbackPort } from '../environment/reserveLoopbackPort.js';
import {
  E2eBackendStartupFailure,
  startE2eBackendProcess,
} from '../environment/startE2eBackendProcess.js';
import { removeE2eRunRoot } from '../environment/removeE2eRunRoot.js';
import { waitForLoopbackPortRelease } from '../environment/waitForLoopbackPortRelease.js';
import { readE2eScenarioId } from './readE2eScenarioId.js';
import { finishServiceFixture } from './finishServiceFixture.js';

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
    await runIsolatedBackendTest({ e2eFaultPlan }, use, testInfo);
  },
});

const backendFixtureDependencies = {
  collectBackendFailureArtifacts,
  createE2eRunRoot,
  createE2eWorkerPaths,
  requestFactory,
  removeE2eRunRoot,
  reserveLoopbackPort,
  startE2eBackendProcess,
  waitForLoopbackPortRelease,
};

export async function runIsolatedBackendTest(
  { e2eFaultPlan }: IsolatedBackendOptions,
  use: (harness: IsolatedBackendHarness) => Promise<void>,
  testInfo: TestInfo,
  dependencies = backendFixtureDependencies,
): Promise<void> {
  const {
    collectBackendFailureArtifacts, createE2eRunRoot, createE2eWorkerPaths,
    requestFactory, removeE2eRunRoot, reserveLoopbackPort, startE2eBackendProcess,
    waitForLoopbackPortRelease,
  } = dependencies;
  const scenarioId = readE2eScenarioId(testInfo.title);
  const runRoot = createE2eRunRoot();
  const paths = createE2eWorkerPaths(runRoot, scenarioId);
  let anonymousApi: APIRequestContext | undefined;
  let api: APIRequestContext | undefined;
  let backend: StartedE2eBackend | undefined;
  let backendPort: number | undefined;
  let failure: { error: unknown } | undefined;
  let priorCleanupUnverified = false;
  const authenticatedApis: APIRequestContext[] = [];

  async function startBackend(faultPlan?: E2eFaultPlan): Promise<StartedE2eBackend> {
    if (backendPort === undefined || priorCleanupUnverified) {
      throw new Error('E2E_BACKEND_START_REFUSED');
    }
    try {
      return await startE2eBackendProcess({
        backendPort, paths, runRoot, scenarioId,
        ...(faultPlan === undefined ? {} : { faultPlan }),
      });
    } catch (error) {
      priorCleanupUnverified = !(error instanceof E2eBackendStartupFailure &&
        error.evidence.cleanup.processTree === 'stopped' &&
        error.evidence.cleanup.port === 'released');
      throw error;
    }
  }

  try {
    backendPort = await reserveLoopbackPort();
    backend = await startBackend(e2eFaultPlan);
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
        if (backend === undefined || backendPort === undefined || priorCleanupUnverified) {
          throw new Error('E2E backend cannot be restarted.');
        }
        try {
          await backend.stop();
          backend = undefined;
          api = undefined;
          await waitForLoopbackPortRelease(backendPort);
        } catch (error) {
          priorCleanupUnverified = true;
          throw error;
        }
        backend = await startBackend();
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
  } catch (error) {
    failure = { error };
  } finally {
    await finishServiceFixture({
      failure, priorCleanupUnverified,
      testAlreadyFailed: testInfo.status !== testInfo.expectedStatus,
      disposeApi: async () => {
        const apis = [...authenticatedApis, ...(anonymousApi === undefined ? [] : [anonymousApi])];
        const results = await Promise.allSettled(apis.map(async (context) => {
          await context.dispose();
        }));
        if (results.some((result) => result.status === 'rejected')) {
          throw new Error('E2E_API_CLEANUP_FAILED');
        }
      },
      ...(backend === undefined ? {} : { stopBackend: () => backend!.stop() }),
      ...(backendPort === undefined ? {} : {
        releaseBackendPort: () => waitForLoopbackPortRelease(backendPort!),
      }),
      collectArtifacts: async () => {
        if (backend !== undefined && (failure !== undefined || testInfo.status !== testInfo.expectedStatus)) {
          await collectBackendFailureArtifacts({ backend, paths, runRoot, scenarioId, testInfo });
        }
      },
      removeRoot: () => removeE2eRunRoot(runRoot),
      report: async (cleanup) => {
        if (failure !== undefined || testInfo.status !== testInfo.expectedStatus || cleanup.runRoot !== 'removed') {
          await testInfo.attach('service-fixture-cleanup', {
            body: JSON.stringify({ schemaVersion: 1, cleanup }), contentType: 'application/json',
          });
        }
      },
    });
  }
}

export { expect } from '@playwright/test';
