import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  expect,
  request as requestFactory,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { readE2eOperationalLogs } from '../../src/assertions/readE2eOperationalLogs.js';
import { installE2eBrowserNetworkBoundary } from '../../src/environment/e2eBrowserNetworkBoundary.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import {
  E2eBackendStartupFailure,
  startE2eBackendProcess,
  type StartedE2eBackend,
} from '../../src/environment/startE2eBackendProcess.js';
import {
  startE2eWebProcess,
  E2eWebStartupFailure,
  type StartedE2eWeb,
} from '../../src/environment/startE2eWebProcess.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';
import { finishServiceFixture } from '../../src/fixtures/finishServiceFixture.js';
import { measurePathBytes } from '../../src/stress/measurePathBytes.js';
import { E2E_ENDURANCE_TIMEOUT_MILLISECONDS } from '../../src/stress/e2eEnduranceBudgets.js';
import { runEnduranceApiWorkload } from '../../src/stress/runEnduranceApiWorkload.js';

const backendCycleCount = 20;
const webTransitionCount = 50;
const scenarioId = 'ENDURANCE-BASELINE-001';

test('ENDURANCE-BASELINE-001 @stress records a bounded local runtime baseline without orphan processes', async ({
  browser,
}, testInfo) => {
  test.setTimeout(E2E_ENDURANCE_TIMEOUT_MILLISECONDS);
  const lifetime = createE2eFixtureLifetime(E2E_ENDURANCE_TIMEOUT_MILLISECONDS);

  const startedAt = Date.now();
  const runRoot = createE2eRunRoot();
  let backendPort: number | undefined;
  let webPort: number | undefined;
  const startedWebs: StartedE2eWeb[] = [];
  const startedBackends: StartedE2eBackend[] = [];
  let api: APIRequestContext | undefined;
  let backend: StartedE2eBackend | undefined;
  let browserContext: BrowserContext | undefined;
  let web: StartedE2eWeb | undefined;
  let completedBackendCycles = 0;
  let failure: { error: unknown } | undefined;
  let priorCleanupUnverified = false;

  try {
    const paths = createE2eWorkerPaths(runRoot, scenarioId);
    backendPort = await reserveLoopbackPort();
    webPort = await reserveLoopbackPort();
    const startBackend = async () => {
      if (backendPort === undefined || priorCleanupUnverified) throw new Error('E2E_BACKEND_START_REFUSED');
      try {
        return await startE2eBackendProcess({ backendPort, lifetime, paths, runRoot, scenarioId });
      } catch (error) {
        priorCleanupUnverified = !(error instanceof E2eBackendStartupFailure &&
          error.evidence.cleanup.processTree === 'stopped' && error.evidence.cleanup.port === 'released');
        throw error;
      }
    };
    backend = await startBackend();
    startedBackends.push(backend);
    const backendRssStartBytes = await backend.workload.readRssBytes();

    api = await requestFactory.newContext({
      baseURL: backend.backendOrigin,
      extraHTTPHeaders: {
        Accept: 'application/json',
        'x-eky-local-session': backend.sessionSecret,
      },
    });
    try {
      web = await startE2eWebProcess({ backend, lifetime, paths, runRoot, webPort });
    } catch (error) {
      priorCleanupUnverified = !(error instanceof E2eWebStartupFailure &&
        error.evidence.cleanup.processTree === 'stopped' && error.evidence.cleanup.port === 'released');
      throw error;
    }
    startedWebs.push(web);
    browserContext = await browser.newContext({
      locale: 'fi-FI',
      timezoneId: 'Europe/Helsinki',
    });
    const networkBoundary = await installE2eBrowserNetworkBoundary(
      browserContext,
      {
        backendOrigin: backend.backendOrigin,
        webOrigin: web.webOrigin,
      },
    );
    const page = await browserContext.newPage();
    await page.goto(web.webOrigin);

    const workload = await runEnduranceApiWorkload(api);
    await runWebNavigationWorkload(page);
    networkBoundary.assertNoBlockedRequests();

    const supportResponse = await api.get(
      '/diagnostics/support-bundle-data',
    );
    expect(supportResponse.status()).toBe(200);
    const supportData = (await supportResponse.json()) as {
      database: { health: string };
      diagnosticEvents: unknown[];
      incidentSummaries: unknown[];
      runtimeSummary: { runtimeInstanceId: string };
    };
    expect(supportData.database.health).toBe('ok');
    expect(supportData.runtimeSummary.runtimeInstanceId).not.toBe('');

    const operationalLogs = readE2eOperationalLogs(paths.logsRoot);
    expect(operationalLogs).not.toContain(
      'Synthetic Endurance Customer',
    );
    expect(operationalLogs).not.toContain('@example.invalid');

    const backendRssEndBytes = await backend.workload.readRssBytes();
    const databaseBytes = measurePathBytes(paths.databaseFilePath);
    const documentBytes = measurePathBytes(paths.documentsRoot);
    const logBytes = measurePathBytes(paths.logsRoot);

    try {
      await api.dispose();
      api = undefined;
      await browserContext.close();
      browserContext = undefined;
      await web.stop();
      web = undefined;
      await waitForLoopbackPortRelease(webPort);
      await backend.stop();
      backend = undefined;
      completedBackendCycles += 1;
      await waitForLoopbackPortRelease(backendPort);
    } catch (error) {
      priorCleanupUnverified = true;
      throw error;
    }

    for (
      let cycle = completedBackendCycles + 1;
      cycle <= backendCycleCount;
      cycle += 1
    ) {
      const cycleBackend = await startBackend();
      backend = cycleBackend;
      startedBackends.push(cycleBackend);
      try {
        await cycleBackend.stop();
        backend = undefined;
        completedBackendCycles += 1;
        await waitForLoopbackPortRelease(backendPort);
      } catch (error) {
        priorCleanupUnverified = true;
        throw error;
      }
    }

    let openManagedProcessCount = 0;
    for (const startedWeb of startedWebs) {
      const state = await startedWeb.workload.readState();
      if (state === 'unavailable') throw new Error('E2E_WEB_WORKLOAD_OBSERVATION_LOST');
      if (state === 'running') openManagedProcessCount += 1;
    }
    for (const startedBackend of startedBackends) {
      const state = await startedBackend.workload.readState();
      if (state === 'unavailable') throw new Error('ENDURANCE_BACKEND_STATE_UNAVAILABLE');
      if (state === 'running') openManagedProcessCount += 1;
    }
    const report = {
      backendCycleCount: completedBackendCycles,
      backendRssEndBytes,
      backendRssStartBytes,
      databaseBytes,
      diagnosticEventCount: supportData.diagnosticEvents.length,
      documentBytes,
      durationMilliseconds: Date.now() - startedAt,
      incidentSummaryCount: supportData.incidentSummaries.length,
      logBytes,
      openManagedProcessCount,
      scenarioId,
      webTransitionCount,
      workload,
    };
    const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
    mkdirSync(testInfo.project.outputDir, { recursive: true });
    const reportPath = join(
      testInfo.project.outputDir,
      'endurance-baseline.json',
    );
    writeFileSync(reportPath, serializedReport, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await testInfo.attach('endurance-baseline', {
      body: Buffer.from(serializedReport, 'utf8'),
      contentType: 'application/json',
    });

    expect(completedBackendCycles).toBe(backendCycleCount);
    expect(openManagedProcessCount).toBe(0);
    expect(databaseBytes).toBeGreaterThan(0);
    expect(documentBytes).toBeGreaterThan(0);
    expect(backendRssEndBytes).toBeGreaterThan(0);
  } catch (error) {
    failure = { error };
  } finally {
    await finishServiceFixture({
      failure, priorCleanupUnverified,
      testAlreadyFailed: testInfo.status !== testInfo.expectedStatus,
      disposeApi: async () => {
        const results = await Promise.allSettled([
          async () => { await api?.dispose(); },
          async () => { await browserContext?.close(); },
        ].map(async action => { await action(); }));
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
      },
      ...(web === undefined ? {} : { stopWeb: () => web!.stop() }),
      ...(backend === undefined ? {} : { stopBackend: () => backend!.stop() }),
      ...(webPort === undefined ? {} : {
        releaseWebPort: () => waitForLoopbackPortRelease(webPort!),
      }),
      ...(backendPort === undefined ? {} : {
        releaseBackendPort: () => waitForLoopbackPortRelease(backendPort!),
      }),
      collectArtifacts: async () => {},
      removeRoot: () => removeE2eRunRoot(runRoot),
      report: async result => {
        if (failure !== undefined || testInfo.status !== testInfo.expectedStatus || result.runRoot !== 'removed') {
          await testInfo.attach('endurance-cleanup', {
            body: JSON.stringify({ schemaVersion: 1, cleanup: result }), contentType: 'application/json',
          });
        }
      },
    });
  }
});

async function runWebNavigationWorkload(page: Page): Promise<void> {
  const destinations = [
    {
      buttonName: 'Laskutus',
      headingLevel: 2,
      headingName: 'Laskuluonnoslista',
    },
    {
      buttonName: 'Oma yritys',
      headingLevel: 1,
      headingName: 'Oma yritys',
    },
    {
      buttonName: 'Asiakkaat',
      headingLevel: 1,
      headingName: 'Asiakkaat',
    },
  ] as const;

  for (let index = 0; index < webTransitionCount; index += 1) {
    const destination = destinations[index % destinations.length];
    if (destination === undefined) {
      throw new Error('Endurance navigation destination was unavailable.');
    }
    await page
      .getByRole('button', { name: destination.buttonName, exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        level: destination.headingLevel,
        name: destination.headingName,
      }),
    ).toBeVisible();
  }
}
