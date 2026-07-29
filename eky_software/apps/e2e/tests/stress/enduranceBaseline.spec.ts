import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import {
  startE2eBackendProcess,
  type StartedE2eBackend,
} from '../../src/environment/startE2eBackendProcess.js';
import {
  startE2eWebProcess,
  type StartedE2eWeb,
} from '../../src/environment/startE2eWebProcess.js';
import type { ManagedProcess } from '../../src/environment/startManagedProcess.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';
import { measurePathBytes } from '../../src/stress/measurePathBytes.js';
import { readProcessRssBytes } from '../../src/stress/readProcessRssBytes.js';
import { runEnduranceApiWorkload } from '../../src/stress/runEnduranceApiWorkload.js';

const backendCycleCount = 20;
const webTransitionCount = 50;
const scenarioId = 'ENDURANCE-BASELINE-001';

test('ENDURANCE-BASELINE-001 @stress records a bounded local runtime baseline without orphan processes', async ({
  browser,
}, testInfo) => {
  test.setTimeout(15 * 60_000);

  const startedAt = Date.now();
  const runRoot = createE2eRunRoot();
  const paths = createE2eWorkerPaths(runRoot, scenarioId);
  const backendPort = await reserveLoopbackPort();
  const webPort = await reserveLoopbackPort();
  const managedProcesses: ManagedProcess[] = [];
  let api: APIRequestContext | undefined;
  let backend: StartedE2eBackend | undefined;
  let browserContext: BrowserContext | undefined;
  let web: StartedE2eWeb | undefined;
  let completedBackendCycles = 0;

  try {
    backend = await startE2eBackendProcess({
      backendPort,
      paths,
      runRoot,
      scenarioId,
    });
    managedProcesses.push(backend.managedProcess);
    const backendPid = backend.managedProcess.child.pid;
    if (backendPid === undefined) {
      throw new Error('Endurance backend process id was unavailable.');
    }
    const backendRssStartBytes = await readProcessRssBytes(backendPid);

    api = await requestFactory.newContext({
      baseURL: backend.backendOrigin,
      extraHTTPHeaders: {
        Accept: 'application/json',
        'x-eky-local-session': backend.sessionSecret,
      },
    });
    web = await startE2eWebProcess({
      backend,
      paths,
      runRoot,
      webPort,
    });
    managedProcesses.push(web.managedProcess);
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

    const backendRssEndBytes = await readProcessRssBytes(backendPid);
    const databaseBytes = measurePathBytes(paths.databaseFilePath);
    const documentBytes = measurePathBytes(paths.documentsRoot);
    const logBytes = measurePathBytes(paths.logsRoot);

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

    for (
      let cycle = completedBackendCycles + 1;
      cycle <= backendCycleCount;
      cycle += 1
    ) {
      const cycleBackend = await startE2eBackendProcess({
        backendPort,
        paths,
        runRoot,
        scenarioId,
      });
      backend = cycleBackend;
      managedProcesses.push(cycleBackend.managedProcess);
      await cycleBackend.stop();
      backend = undefined;
      completedBackendCycles += 1;
      await waitForLoopbackPortRelease(backendPort);
    }

    const openManagedProcessCount = countRunningProcesses(managedProcesses);
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
  } finally {
    await api?.dispose();
    await browserContext?.close();
    await web?.stop();
    await backend?.stop();
    await waitForLoopbackPortRelease(webPort);
    await waitForLoopbackPortRelease(backendPort);
    rmSync(runRoot, { force: true, recursive: true });
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

function countRunningProcesses(processes: readonly ManagedProcess[]): number {
  return processes.filter(
    ({ child }) => child.exitCode === null && child.signalCode === null,
  ).length;
}
