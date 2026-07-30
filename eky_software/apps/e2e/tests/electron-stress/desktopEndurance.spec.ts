import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Page, type TestInfo } from '@playwright/test';

import { readElectronOperationalEvents } from '../../src/assertions/readElectronOperationalEvents.js';
import {
  closeElectronPdfPreviews,
  readElectronPdfPreviewUrls,
  readElectronProcessMetrics,
  type ElectronProcessMetricsSnapshot,
} from '../../src/electron/electronMainCapabilities.js';
import {
  test,
  type IsolatedElectronHarness,
} from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';
import {
  openApprovedInvoiceFromList,
  openInvoicingWorkspace,
} from '../../src/journeys/invoicingWebJourney.js';
import { measurePathBytes } from '../../src/stress/measurePathBytes.js';

const moduleTransitionCount = 200;
const invoiceDetailOpenCount = 50;
const pdfPreviewOpenCount = 100;
const supportBundleCount = 20;
const secretCycleCount = 30;
const restartCycleCount = 20;

test('DESK-ENDURANCE-001 @desktop-stress @stress records the desktop endurance baseline', async ({
  e2eElectron,
}, testInfo) => {
  test.setTimeout(20 * 60_000);

  const startedAt = Date.now();
  const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  const metricsBefore = await readElectronProcessMetrics(
    e2eElectron.electronApp,
  );

  await runModuleTransitions(e2eElectron.page, moduleTransitionCount);
  await runInvoiceDetailOpens(
    e2eElectron.page,
    invoice.invoiceNumber,
    invoiceDetailOpenCount,
  );
  await runPdfPreviewCycles(
    e2eElectron,
    invoice.invoiceId,
    pdfPreviewOpenCount,
  );
  await runSupportBundleCycles(e2eElectron, supportBundleCount);
  await runSecretCycles(e2eElectron, secretCycleCount);
  await runRestartCycles(e2eElectron, restartCycleCount);

  const metricsAfter = await readElectronProcessMetrics(
    e2eElectron.electronApp,
  );
  const health = await e2eElectron.api.get('/health');
  expect(health.status()).toBe(200);
  expect(metricsAfter.backendIsRunning).toBe(true);
  expect(metricsAfter.processCount).toBeGreaterThan(0);
  expect(metricsAfter.processCount).toBeLessThan(20);
  expect(metricsAfter.windowCount).toBe(1);
  expect(await readElectronPdfPreviewUrls(e2eElectron.electronApp)).toEqual(
    [],
  );
  expect(existsSync(e2eElectron.runtime.supportBundlePath)).toBe(true);

  const serializedLogs = JSON.stringify(
    readElectronOperationalEvents(
      join(e2eElectron.runtime.userDataPath, 'runtime', 'logs'),
    ),
  );
  expect(serializedLogs).not.toContain('desktop-endurance-secret-');
  expect(
    existsSync(
      join(
        e2eElectron.runtime.userDataPath,
        'runtime',
        'secrets',
        'company-email-smtp-v1.dat',
      ),
    ),
  ).toBe(false);

  const measuredPaths = resolveDesktopRuntimeMeasurementPaths(e2eElectron);
  const databaseBytes = measurePathBytes(measuredPaths.databaseFilePath);
  const documentBytes = measurePathBytes(measuredPaths.documentsRoot);
  const logBytes = measurePathBytes(measuredPaths.logsRoot);
  expect(databaseBytes).toBeGreaterThan(0);
  expect(documentBytes).toBeGreaterThan(0);
  expect(logBytes).toBeGreaterThan(0);

  await writeEnduranceReport(testInfo, {
    completedAt: new Date().toISOString(),
    databaseBytes,
    documentBytes,
    durationMilliseconds: Date.now() - startedAt,
    invoiceDetailOpenCount,
    logBytes,
    metricsAfter,
    metricsBefore,
    moduleTransitionCount,
    pdfPreviewOpenCount,
    restartCycleCount,
    scenarioId: 'DESK-ENDURANCE-001',
    secretCycleCount,
    supportBundleCount,
  });
});

test('DESK-SOAK-001 @soak records a manually invoked desktop soak baseline', async ({
  e2eElectron,
}, testInfo) => {
  const durationMinutes = readSoakDurationMinutes();
  const durationMilliseconds = durationMinutes * 60_000;
  test.setTimeout(durationMilliseconds + 5 * 60_000);

  const startedAt = Date.now();
  const deadline = startedAt + durationMilliseconds;
  const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  const metricsBefore = await readElectronProcessMetrics(
    e2eElectron.electronApp,
  );
  let cycleCount = 0;
  let restartCount = 0;
  let supportCount = 0;

  while (Date.now() < deadline) {
    await runModuleTransitions(e2eElectron.page, 3);
    await runPdfPreviewCycles(e2eElectron, invoice.invoiceId, 1);
    expect(
      (await e2eElectron.api.get(`/invoices/${invoice.invoiceId}`)).status(),
    ).toBe(200);
    await runSecretCycles(e2eElectron, 1);
    cycleCount += 1;

    if (cycleCount % 5 === 0) {
      await runSupportBundleCycles(e2eElectron, 1);
      supportCount += 1;
    }
    if (cycleCount % 10 === 0) {
      await runRestartCycles(e2eElectron, 1);
      restartCount += 1;
    }
  }

  const metricsAfter = await readElectronProcessMetrics(
    e2eElectron.electronApp,
  );
  expect((await e2eElectron.api.get('/health')).status()).toBe(200);
  expect(metricsAfter.backendIsRunning).toBe(true);
  expect(metricsAfter.processCount).toBeGreaterThan(0);
  expect(metricsAfter.processCount).toBeLessThan(20);
  expect(metricsAfter.windowCount).toBe(1);

  const measuredPaths = resolveDesktopRuntimeMeasurementPaths(e2eElectron);
  await writeEnduranceReport(testInfo, {
    completedAt: new Date().toISOString(),
    cycleCount,
    databaseBytes: measurePathBytes(measuredPaths.databaseFilePath),
    documentBytes: measurePathBytes(measuredPaths.documentsRoot),
    durationMilliseconds: Date.now() - startedAt,
    durationMinutes,
    logBytes: measurePathBytes(measuredPaths.logsRoot),
    metricsAfter,
    metricsBefore,
    restartCount,
    scenarioId: 'DESK-SOAK-001',
    supportCount,
  });
});

async function runModuleTransitions(
  page: Page,
  count: number,
): Promise<void> {
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

  for (let index = 0; index < count; index += 1) {
    const destination = destinations[index % destinations.length];
    if (destination === undefined) {
      throw new Error('Desktop endurance destination was unavailable.');
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

async function runInvoiceDetailOpens(
  page: Page,
  invoiceNumber: string,
  count: number,
): Promise<void> {
  await openInvoicingWorkspace(page);
  for (let index = 0; index < count; index += 1) {
    await openApprovedInvoiceFromList(page, invoiceNumber);
    await page.getByRole('button', { name: 'Takaisin luonnoksiin' }).click();
    await page
      .getByRole('heading', { level: 2, name: 'Laskuluonnoslista' })
      .waitFor();
  }
}

async function runPdfPreviewCycles(
  harness: IsolatedElectronHarness,
  invoiceId: string,
  count: number,
): Promise<void> {
  const expectedUrl = `eky://app/invoices/${invoiceId}/pdf`;
  for (let index = 0; index < count; index += 1) {
    await harness.page.evaluate(async (id) => {
      const bridge = (
        window as typeof window & {
          ekyDesktop?: { openInvoicePdf(invoiceId: string): Promise<void> };
        }
      ).ekyDesktop;
      if (bridge === undefined) {
        throw new Error('Desktop bridge is unavailable.');
      }
      await bridge.openInvoicePdf(id);
    }, invoiceId);
    await expect
      .poll(() => readElectronPdfPreviewUrls(harness.electronApp))
      .toEqual([expectedUrl]);
    await closeElectronPdfPreviews(harness.electronApp);
    await expect
      .poll(() => readElectronPdfPreviewUrls(harness.electronApp))
      .toEqual([]);
  }
}

async function runSupportBundleCycles(
  harness: IsolatedElectronHarness,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const result = await harness.page.evaluate(async () => {
      const bridge = (
        window as typeof window & {
          ekyDesktop?: { createSupportBundle(): Promise<string> };
        }
      ).ekyDesktop;
      if (bridge === undefined) {
        throw new Error('Desktop bridge is unavailable.');
      }
      return bridge.createSupportBundle();
    });
    expect(result).toBe('created');
  }
}

async function runSecretCycles(
  harness: IsolatedElectronHarness,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const secret = `desktop-endurance-secret-${String(index)}-Aa1!`;
    expect(
      (
        await harness.api.put('/company-settings/email-secret', {
          data: { secret },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await harness.api.delete('/company-settings/email-secret')).status(),
    ).toBe(200);
  }
}

async function runRestartCycles(
  harness: IsolatedElectronHarness,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await harness.restart();
    expect((await harness.api.get('/health')).status()).toBe(200);
  }
}

async function writeEnduranceReport(
  testInfo: TestInfo,
  report: {
    completedAt: string;
    databaseBytes: number;
    documentBytes: number;
    durationMilliseconds: number;
    logBytes: number;
    metricsAfter: ElectronProcessMetricsSnapshot;
    metricsBefore: ElectronProcessMetricsSnapshot;
    scenarioId: string;
    [key: string]: unknown;
  },
): Promise<void> {
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(testInfo.project.outputDir, { recursive: true });
  const reportPath = join(
    testInfo.project.outputDir,
    `${report.scenarioId.toLowerCase()}.json`,
  );
  writeFileSync(reportPath, serializedReport, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await testInfo.attach('desktop-endurance-baseline', {
    body: Buffer.from(serializedReport, 'utf8'),
    contentType: 'application/json',
  });
}

function readSoakDurationMinutes(): number {
  const rawValue = process.env.EKY_E2E_SOAK_DURATION_MINUTES ?? '30';
  const duration = Number(rawValue);
  if (!Number.isInteger(duration) || duration < 1 || duration > 240) {
    throw new Error('Desktop soak duration must be 1-240 whole minutes.');
  }
  return duration;
}

function resolveDesktopRuntimeMeasurementPaths(
  harness: IsolatedElectronHarness,
): {
  databaseFilePath: string;
  documentsRoot: string;
  logsRoot: string;
} {
  const runtimeRoot = join(harness.runtime.userDataPath, 'runtime');
  return {
    databaseFilePath: join(runtimeRoot, 'data', 'eky.sqlite'),
    documentsRoot: join(runtimeRoot, 'storage', 'invoices'),
    logsRoot: join(runtimeRoot, 'logs'),
  };
}
