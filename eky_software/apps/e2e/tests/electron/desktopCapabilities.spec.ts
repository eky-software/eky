import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { request as requestFactory } from '@playwright/test';

import { readElectronOperationalEvents } from '../../src/assertions/readElectronOperationalEvents.js';
import {
  closeElectronPdfPreviews,
  killElectronBackendUnexpectedly,
  readElectronNativeAdapterSnapshot,
  readElectronPdfPreviewUrls,
} from '../../src/electron/electronMainCapabilities.js';
import {
  createElectronE2eRuntime,
  resolveElectronE2eApplicationPath,
  type ElectronE2eRuntime,
} from '../../src/environment/createElectronE2eRuntime.js';
import { assertElectronLaunchPrerequisites } from '../../src/environment/assertElectronLaunchPrerequisites.js';
import { createElectronEnvironment } from '../../src/environment/createElectronEnvironment.js';
import { listElectronE2eProfileDirectories } from '../../src/environment/createElectronE2eProfile.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import { resolveElectronE2eExecutable } from '../../src/environment/resolveElectronE2eExecutable.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';
import { test, expect } from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

test('DESK-PDF-001 @critical opens one isolated invoice PDF preview', async ({
  e2eElectron,
}) => {
  const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);

  await openInvoicePdf(e2eElectron.page, invoice.invoiceId);
  const expectedUrl = `eky://app/invoices/${invoice.invoiceId}/pdf`;
  await expect
    .poll(() => readElectronPdfPreviewUrls(e2eElectron.electronApp))
    .toEqual([expectedUrl]);
  await expect.poll(() => e2eElectron.electronApp.windows().length).toBe(2);

  const previewPage = e2eElectron.electronApp
    .windows()
    .find((page) => page.url() === expectedUrl);
  expect(previewPage).toBeDefined();
  expect(
    await previewPage?.evaluate(() => ({
      processType: typeof (window as typeof window & { process?: unknown })
        .process,
      requireType: typeof (window as typeof window & { require?: unknown })
        .require,
      popupDenied: window.open('data:text/plain,blocked') === null,
    })),
  ).toEqual({
    popupDenied: true,
    processType: 'undefined',
    requireType: 'undefined',
  });

  await openInvoicePdf(e2eElectron.page, invoice.invoiceId);
  await expect.poll(() => e2eElectron.electronApp.windows().length).toBe(2);

  await closeElectronPdfPreviews(e2eElectron.electronApp);
  await expect.poll(() => e2eElectron.electronApp.windows().length).toBe(1);
});

test('DESK-SECRET-001 @critical @security persists only encrypted SMTP secret state', async ({
  e2eElectron,
}) => {
  const secret = `synthetic-safe-storage-${Date.now()}-Aa1!`;
  const secretPath = readElectronE2eActiveWorkspace(
    e2eElectron.runtime.userDataPath,
  ).emailSecretFilePath;
  const customerResponse = await e2eElectron.api.post('/customers', {
    data: {
      businessId: '1234567-8',
      city: 'Testikaupunki',
      comment: '',
      customerNumber: 'DESK-SECRET-1',
      customerNumberMode: 'manual',
      customerType: 'company',
      email: '',
      hourlyRateOverrideCents: null,
      managedByCustomerId: '',
      name: 'Synthetic Restart Marker Oy',
      phone: '',
      postalCode: '00100',
      status: 'active',
      streetAddress: 'Testikatu 1',
    },
  });
  expect(customerResponse.status()).toBe(201);

  const setResponse = await e2eElectron.api.put(
    '/company-settings/email-secret',
    { data: { secret } },
  );
  expect(setResponse.status()).toBe(200);
  await expect(setResponse.json()).resolves.toEqual({
    emailSecretStatus: { configured: true },
  });
  expect(existsSync(secretPath)).toBe(true);
  expect(readFileSync(secretPath, 'utf8')).not.toContain(secret);
  expect(
    await e2eElectron.page.evaluate((marker) => {
      const serializedBridge = JSON.stringify(
        (window as typeof window & { ekyDesktop?: unknown }).ekyDesktop,
      );
      return (
        document.documentElement.textContent?.includes(marker) === true ||
        serializedBridge.includes(marker)
      );
    }, secret),
  ).toBe(false);

  const restart = await e2eElectron.restart();
  expect(e2eElectron.runtime.runtimeInstanceId).not.toBe(
    restart.previousRuntimeInstanceId,
  );
  const statusResponse = await e2eElectron.api.get(
    '/company-settings/email-secret',
  );
  expect(statusResponse.status()).toBe(200);
  await expect(statusResponse.json()).resolves.toEqual({
    emailSecretStatus: { configured: true },
  });
  const customersResponse = await e2eElectron.api.get('/customers');
  expect(customersResponse.status()).toBe(200);
  expect(await customersResponse.text()).toContain('DESK-SECRET-1');

  const staleSession = await requestFactory.newContext({
    baseURL: `http://127.0.0.1:${String(e2eElectron.runtime.backendPort)}`,
    extraHTTPHeaders: {
      Accept: 'application/json',
      'x-eky-local-session': restart.previousSessionSecret,
    },
  });
  try {
    expect((await staleSession.get('/company-settings')).status()).toBe(401);
  } finally {
    await staleSession.dispose();
  }

  const removeResponse = await e2eElectron.api.delete(
    '/company-settings/email-secret',
  );
  expect(removeResponse.status()).toBe(200);
  await expect(removeResponse.json()).resolves.toEqual({
    emailSecretStatus: { configured: false },
  });
  for (const path of [secretPath, `${secretPath}.next`, `${secretPath}.backup`]) {
    expect(existsSync(path)).toBe(false);
  }
  expect(
    JSON.stringify(
      readElectronOperationalEvents(
        join(e2eElectron.runtime.userDataPath, 'runtime', 'logs'),
      ),
    ),
  ).not.toContain(secret);
});

test('DESK-SUPPORT-001 @critical and DESK-LOGFOLDER-001 use owned local paths', async ({
  e2eElectron,
}) => {
  const secret = `support-bundle-secret-${Date.now()}-Aa1!`;
  expect(
    (
      await e2eElectron.api.put('/company-settings/email-secret', {
        data: { secret },
      })
    ).status(),
  ).toBe(200);

  await e2eElectron.page.evaluate(() => {
    window.open('https://example.invalid/support-event');
  });
  const supportResult = await e2eElectron.page.evaluate(async () => {
    const bridge = (
      window as typeof window & {
        ekyDesktop?: {
          createSupportBundle(): Promise<string>;
          openOperationalLogFolder(): Promise<void>;
        };
      }
    ).ekyDesktop;
    if (bridge === undefined) {
      throw new Error('Desktop bridge is unavailable.');
    }
    await bridge.openOperationalLogFolder();
    return bridge.createSupportBundle();
  });
  expect(supportResult).toBe('created');
  expect(existsSync(e2eElectron.runtime.supportBundlePath)).toBe(true);

  const nativeSnapshot = await readElectronNativeAdapterSnapshot(
    e2eElectron.electronApp,
  );
  expect(nativeSnapshot.openedPaths).toEqual([
    join(e2eElectron.runtime.userDataPath, 'runtime', 'logs'),
  ]);
  expect(nativeSnapshot.saveDialogCount).toBe(1);
  expect(nativeSnapshot.messageBoxCount).toBe(1);

  const document = readSupportBundle(e2eElectron.runtime.supportBundlePath);
  expect(document.manifest.supportBundleFormatVersion).toBe(2);
  expect(document.manifest.truncatedSections).not.toContain(
    'diagnosticEvents',
  );
  expect(document.diagnosticEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        eventName: 'applicationWindow.newWindowBlocked',
      }),
    ]),
  );
  expect(document.incidentSummaries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        errorCode: 'DESKTOP_SECURITY_EVENT_BLOCKED',
        eventName: 'applicationWindow.newWindowBlocked',
      }),
    ]),
  );
  assertSupportBundleChecksums(document);
  expect(JSON.stringify(document)).not.toContain(secret);
  expect(JSON.stringify(document)).not.toContain(
    e2eElectron.runtime.sessionSecret,
  );

  runSupportInspector(e2eElectron.runtime.supportBundlePath);
  const legacyPath = join(
    e2eElectron.paths.supportBundlesRoot,
    'legacy-support-bundle.ekysupport',
  );
  copyFileSync(e2eElectron.runtime.supportBundlePath, legacyPath);
  runSupportInspector(legacyPath);
});

test('DESK-BACKEND-EXIT-001 @fault closes safely and permits a fresh runtime', async ({
  e2eElectron,
}) => {
  const closed = e2eElectron.electronApp.waitForEvent('close');
  await killElectronBackendUnexpectedly(e2eElectron.electronApp);
  await closed;

  const serializedEvents = JSON.stringify(
    readElectronOperationalEvents(
      join(
        e2eElectron.runtime.userDataPath,
        'runtime',
        'logs',
        'desktop',
      ),
    ),
  );
  expect(serializedEvents).toContain('backendProcess.unexpectedExit');
  expect(serializedEvents).not.toContain('node_modules');
  expect(serializedEvents).not.toContain('stack');
  expect(readFileSync(e2eElectron.runtime.observationsPath, 'utf8')).toContain(
    '"operation":"showErrorBox"',
  );

  await e2eElectron.restart();
  const health = await e2eElectron.api.get('/health');
  expect(health.status()).toBe(200);
});

test('DESK-RESTART-001 @critical @recovery preserves data and rotates the runtime session', async ({
  e2eElectron,
}) => {
  const customerNumber = `DESK-RESTART-${Date.now()}`;
  const createResponse = await e2eElectron.api.post('/customers', {
    data: {
      businessId: '7654321-8',
      city: 'Testikaupunki',
      comment: '',
      customerNumber,
      customerNumberMode: 'manual',
      customerType: 'company',
      email: '',
      hourlyRateOverrideCents: null,
      managedByCustomerId: '',
      name: 'Synthetic Recovery Marker Oy',
      phone: '',
      postalCode: '00100',
      status: 'active',
      streetAddress: 'Palautumiskatu 1',
    },
  });
  expect(createResponse.status()).toBe(201);

  const restart = await e2eElectron.restart();
  expect(e2eElectron.runtime.runtimeInstanceId).not.toBe(
    restart.previousRuntimeInstanceId,
  );

  const health = await e2eElectron.api.get('/health');
  expect(health.status()).toBe(200);
  const customersResponse = await e2eElectron.api.get('/customers');
  expect(customersResponse.status()).toBe(200);
  expect(await customersResponse.text()).toContain(customerNumber);

  const staleSession = await requestFactory.newContext({
    baseURL: `http://127.0.0.1:${String(e2eElectron.runtime.backendPort)}`,
    extraHTTPHeaders: {
      Accept: 'application/json',
      'x-eky-local-session': restart.previousSessionSecret,
    },
  });
  try {
    expect((await staleSession.get('/company-settings')).status()).toBe(401);
  } finally {
    await staleSession.dispose();
  }
});

test('DESK-BOOTFAIL-001 @fault exposes only an allowlisted startup failure', async () => {
  const runRoot = createE2eRunRoot();
  const paths = createE2eWorkerPaths(runRoot, 'DESK-BOOTFAIL-001');
  const backendPort = await reserveLoopbackPort();
  const runtime = createElectronE2eRuntime({
    backendPort,
    paths,
    scenarioId: 'DESK-BOOTFAIL-001',
    startupMode: 'backendStartFailure',
  });

  try {
    const result = await runElectronProcess(runtime, runRoot);
    expect(result.exitCode).toBe(1);
    expect(result.output).not.toContain('node_modules');
    expect(result.output).not.toContain('Users\\');
    expect(result.output).not.toContain(' at ');

    const serializedEvents = JSON.stringify(
      readElectronOperationalEvents(
        join(runtime.userDataPath, 'runtime', 'logs', 'desktop'),
      ),
    );
    expect(serializedEvents).toContain('desktop.bootstrapFailed');
    expect(serializedEvents).toContain('BACKEND_READINESS_TIMEOUT');
    expect(serializedEvents).not.toContain('node_modules');
    expect(readFileSync(runtime.observationsPath, 'utf8')).toContain(
      '"operation":"showErrorBox"',
    );
  } finally {
    await waitForLoopbackPortRelease(backendPort);
    rmSync(runRoot, { force: true, recursive: true });
  }
});

async function openInvoicePdf(
  page: import('@playwright/test').Page,
  invoiceId: string,
): Promise<void> {
  await page.evaluate(async (id) => {
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
}

interface SupportBundleDocument {
  database: unknown;
  diagnosticEvents: unknown[];
  incidentSummaries: unknown[];
  manifest: {
    sectionChecksums: Record<string, string>;
    supportBundleFormatVersion: number;
    truncatedSections: string[];
  };
  operationalSummary: unknown;
  runtimeSummary: unknown;
  system: unknown;
}

type SpawnedElectronProcess = ReturnType<typeof spawn> & {
  on(
    event: 'error',
    listener: (error: Error) => void,
  ): SpawnedElectronProcess;
  on(
    event: 'exit',
    listener: (exitCode: number | null) => void,
  ): SpawnedElectronProcess;
};

function readSupportBundle(path: string): SupportBundleDocument {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as
    SupportBundleDocument;
}

function assertSupportBundleChecksums(document: SupportBundleDocument): void {
  for (const sectionName of [
    'database',
    'diagnosticEvents',
    'incidentSummaries',
    'operationalSummary',
    'runtimeSummary',
    'system',
  ] as const) {
    expect(document.manifest.sectionChecksums[sectionName]).toBe(
      createHash('sha256')
        .update(JSON.stringify(document[sectionName]), 'utf8')
        .digest('hex'),
    );
  }
}

function runSupportInspector(path: string): void {
  execFileSync(
    process.execPath,
    [
      join(repositoryRoot, 'apps/desktop/scripts/inspect-support-bundle.mjs'),
      path,
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15_000,
      windowsHide: true,
    },
  );
}

function runElectronProcess(
  runtime: ElectronE2eRuntime,
  runRoot: string,
): Promise<{ exitCode: number | null; output: string }> {
  assertElectronLaunchPrerequisites({
    applicationPath: resolveElectronE2eApplicationPath(),
    configPath: runtime.configPath,
    cwd: runRoot,
    executablePath: resolveElectronE2eExecutable(),
    profileDirectories: listElectronE2eProfileDirectories(runtime.profile),
    runRoot,
  });
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(
      resolveElectronE2eExecutable(),
      [resolveElectronE2eApplicationPath()],
      {
        cwd: runRoot,
        env: createElectronEnvironment({
          configPath: runtime.configPath,
          profile: runtime.profile,
          runRoot: runtime.runtimeRoot,
        }),
        shell: false,
        windowsHide: true,
      },
    ) as SpawnedElectronProcess;
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      rejectProcess(new Error('Synthetic Electron bootstrap did not exit.'));
    }, 30_000);
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-64 * 1024);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      rejectProcess(error);
    });
    child.on('exit', (exitCode: number | null) => {
      clearTimeout(timer);
      resolveProcess({ exitCode, output });
    });
  });
}
