import { rmSync } from 'node:fs';

import {
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test';

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
  type StartedE2eBackend,
} from '../environment/startE2eBackendProcess.js';
import {
  startE2eWebProcess,
  type StartedE2eWeb,
} from '../environment/startE2eWebProcess.js';
import { waitForLoopbackPortRelease } from '../environment/waitForLoopbackPortRelease.js';
import { readE2eScenarioId } from './readE2eScenarioId.js';

export interface IsolatedWebHarness {
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

export const test = base.extend<IsolatedWebFixtures>({
  e2eWeb: async ({ context, page }, use, testInfo) => {
    const scenarioId = readE2eScenarioId(testInfo.title);
    const runRoot = createE2eRunRoot();
    const paths = createE2eWorkerPaths(runRoot, scenarioId);
    const backendPort = await reserveLoopbackPort();
    const webPort = await reserveLoopbackPort();
    let backend: StartedE2eBackend | undefined;
    let fixtureError: unknown;
    let networkBoundary: E2eBrowserNetworkBoundary | undefined;
    let web: StartedE2eWeb | undefined;

    try {
      backend = await startE2eBackendProcess({
        backendPort,
        paths,
        runRoot,
        scenarioId,
      });
      web = await startE2eWebProcess({
        backend,
        paths,
        runRoot,
        webPort,
      });
      networkBoundary = await installE2eBrowserNetworkBoundary(context, {
        backendOrigin: backend.backendOrigin,
        webOrigin: web.webOrigin,
      });
      await page.goto(web.webOrigin);

      await use({ backend, context, page, paths, runRoot, web });
      networkBoundary.assertNoBlockedRequests();
    } catch (error) {
      fixtureError = error;
      throw error;
    } finally {
      await web?.stop();
      await backend?.stop();
      try {
        if (
          backend !== undefined &&
          web !== undefined &&
          (fixtureError !== undefined ||
            testInfo.status !== testInfo.expectedStatus)
        ) {
          await collectWebFailureArtifacts({
            backend,
            paths,
            runRoot,
            scenarioId,
            testInfo,
            web,
          });
        }
        await waitForLoopbackPortRelease(webPort);
        await waitForLoopbackPortRelease(backendPort);
      } finally {
        rmSync(runRoot, { force: true, recursive: true });
      }
    }
  },
});

export { expect } from '@playwright/test';
