import {
  request as requestFactory,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import type { E2eFaultPlan } from '../../../backend/e2e/e2eBackendConfig.js';
import { collectWebFailureArtifacts } from '../environment/collectWebFailureArtifacts.js';
import { createE2eRunRoot } from '../environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../environment/createE2eWorkerPaths.js';
import {
  installE2eBrowserNetworkBoundary,
  type E2eBrowserNetworkBoundary,
} from '../environment/e2eBrowserNetworkBoundary.js';
import type { E2eWorkerPaths } from '../environment/e2eEnvironmentTypes.js';
import { reserveLoopbackPort } from '../environment/reserveLoopbackPort.js';
import {
  startE2eBackendProcess,
  E2eBackendStartupFailure,
  type StartedE2eBackend,
} from '../environment/startE2eBackendProcess.js';
import {
  startE2eWebProcess,
  type StartedE2eWeb,
} from '../environment/startE2eWebProcess.js';
import { waitForLoopbackPortRelease } from '../environment/waitForLoopbackPortRelease.js';
import { readE2eScenarioId } from './readE2eScenarioId.js';
import { removeE2eRunRoot } from '../environment/removeE2eRunRoot.js';
import { finishServiceFixture } from './finishServiceFixture.js';

export interface IsolatedWebHarness {
  api: APIRequestContext;
  backend: StartedE2eBackend;
  context: BrowserContext;
  page: Page;
  paths: E2eWorkerPaths;
  runRoot: string;
  web: StartedE2eWeb;
}

interface IsolatedWebFixtures {
  e2eWeb: IsolatedWebHarness;
}

interface IsolatedWebOptions {
  e2eFaultPlan: E2eFaultPlan;
}

export const test = base.extend<
  IsolatedWebFixtures & IsolatedWebOptions
>({
  e2eFaultPlan: [{ kind: 'none' }, { option: true }],
  e2eWeb: async (
    { context, e2eFaultPlan, page },
    use,
    testInfo,
  ) => {
    await runIsolatedWebTest({ context, e2eFaultPlan, page }, use, testInfo);
  },
});

const webFixtureDependencies = {
  collectWebFailureArtifacts,
  createE2eRunRoot,
  createE2eWorkerPaths,
  installE2eBrowserNetworkBoundary,
  requestFactory,
  removeE2eRunRoot,
  reserveLoopbackPort,
  startE2eBackendProcess,
  startE2eWebProcess,
  waitForLoopbackPortRelease,
};

export async function runIsolatedWebTest(
  { context, e2eFaultPlan, page }: IsolatedWebOptions & {
    context: BrowserContext;
    page: Page;
  },
  use: (harness: IsolatedWebHarness) => Promise<void>,
  testInfo: TestInfo,
  dependencies = webFixtureDependencies,
): Promise<void> {
  const {
    collectWebFailureArtifacts, createE2eRunRoot, createE2eWorkerPaths,
    installE2eBrowserNetworkBoundary, requestFactory, removeE2eRunRoot, reserveLoopbackPort,
    startE2eBackendProcess, startE2eWebProcess, waitForLoopbackPortRelease,
  } = dependencies;
  const scenarioId = readE2eScenarioId(testInfo.title);
  const runRoot = createE2eRunRoot();
  const paths = createE2eWorkerPaths(runRoot, scenarioId);
  let backendPort: number | undefined;
  let webPort: number | undefined;
  let backend: StartedE2eBackend | undefined;
  let api: APIRequestContext | undefined;
  let failure: { error: unknown } | undefined;
  let priorCleanupUnverified = false;
  let networkBoundary: E2eBrowserNetworkBoundary | undefined;
  let web: StartedE2eWeb | undefined;

  try {
    backendPort = await reserveLoopbackPort();
    webPort = await reserveLoopbackPort();
    try {
      backend = await startE2eBackendProcess({
        backendPort, faultPlan: e2eFaultPlan, paths, runRoot, scenarioId,
      });
    } catch (error) {
      priorCleanupUnverified = !(error instanceof E2eBackendStartupFailure &&
        error.evidence.cleanup.processTree === 'stopped' &&
        error.evidence.cleanup.port === 'released');
      throw error;
    }
    api = await requestFactory.newContext({
      baseURL: backend.backendOrigin,
      extraHTTPHeaders: {
        Accept: 'application/json',
        'x-eky-local-session': backend.sessionSecret,
      },
    });
    // The web startup contract has no returned handle on failure. A free
    // port alone cannot verify that missing process ownership.
    priorCleanupUnverified = true;
    web = await startE2eWebProcess({ backend, paths, runRoot, webPort });
    priorCleanupUnverified = false;
    networkBoundary = await installE2eBrowserNetworkBoundary(context, {
      backendOrigin: backend.backendOrigin,
      webOrigin: web.webOrigin,
    });
    await page.goto(web.webOrigin);

    await use({ api, backend, context, page, paths, runRoot, web });
    networkBoundary.assertNoBlockedRequests();
  } catch (error) {
    failure = { error };
  } finally {
    await finishServiceFixture({
      failure, priorCleanupUnverified,
      testAlreadyFailed: testInfo.status !== testInfo.expectedStatus,
      disposeApi: async () => { await api?.dispose(); },
      ...(web === undefined ? {} : { stopWeb: () => web!.stop() }),
      ...(backend === undefined ? {} : { stopBackend: () => backend!.stop() }),
      ...(webPort === undefined ? {} : { releaseWebPort: () => waitForLoopbackPortRelease(webPort!) }),
      ...(backendPort === undefined ? {} : { releaseBackendPort: () => waitForLoopbackPortRelease(backendPort!) }),
      collectArtifacts: async () => {
        if (backend !== undefined && web !== undefined &&
          (failure !== undefined || testInfo.status !== testInfo.expectedStatus)) {
          await collectWebFailureArtifacts({ backend, paths, runRoot, scenarioId, testInfo, web });
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
