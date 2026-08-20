import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  APIRequestContext,
  ElectronApplication,
  Locator,
  Page,
} from '@playwright/test';

import { readElectronProcessMetrics } from '../../src/electron/electronMainCapabilities.js';
import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import {
  expect,
  test,
  type IsolatedElectronHarness,
} from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';
import {
  readWorkspaceBackupInvoiceDocument,
  resolveWorkspaceBackupStoragePath,
  sha256File,
} from '../../src/workspaces/workspaceBackupSystemTestSupport.js';

const originalWorkspaceLabel = 'Oma yritys';
const createdWorkspaceLabel = 'E2E Yritys B';
const renamedWorkspaceLabel = 'E2E Yritys B Nimetty';
const importedWorkspaceLabel = 'E2E Yritys C';
const originalCustomerName = 'Desktop Synthetic Customer Oy';

test('DESK-WORKSPACE-UI-001 @critical @recovery keeps workspace data isolated through create, switch and rename', async ({
  e2eElectron,
}, testInfo) => {
  const originalInvoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  const originalPdfSha256 = await readActiveInvoicePdfSha256(
    e2eElectron,
    originalInvoice.invoiceId,
  );

  await assertSingleHealthyDesktopRuntime(e2eElectron);
  await expectWorkspaceBrand(e2eElectron.page, originalWorkspaceLabel);
  await workspaceBrandButton(
    e2eElectron.page,
    originalWorkspaceLabel,
  ).screenshot({ path: testInfo.outputPath('workspace-brand-expanded.png') });
  await e2eElectron.page
    .getByRole('button', { name: 'Sulje päävalikko' })
    .click();
  await expectWorkspaceBrand(e2eElectron.page, originalWorkspaceLabel);
  await workspaceBrandButton(
    e2eElectron.page,
    originalWorkspaceLabel,
  ).screenshot({ path: testInfo.outputPath('workspace-brand-collapsed.png') });
  await e2eElectron.page
    .getByRole('button', { name: 'Avaa päävalikko' })
    .click();

  const pageBeforeCreate = e2eElectron.page;
  await openWorkspaceDialog(pageBeforeCreate);
  await pageBeforeCreate
    .getByRole('button', { name: 'Lisää yritys Ekyyn' })
    .click();
  await pageBeforeCreate
    .getByRole('textbox', { name: 'Yrityksen nimi' })
    .fill(createdWorkspaceLabel);
  await e2eElectron.performRelaunchingOperation(async () => {
    await pageBeforeCreate.getByRole('button', { name: 'Luo yritys' }).click();
  });
  expect(pageBeforeCreate.isClosed()).toBe(true);

  await assertSingleHealthyDesktopRuntime(e2eElectron);
  await expectWorkspaceBrand(e2eElectron.page, originalWorkspaceLabel);
  await openWorkspaceDialog(e2eElectron.page);
  await expect(workspaceRow(e2eElectron.page, createdWorkspaceLabel)).toBeVisible();
  await e2eElectron.page
    .getByRole('dialog', { name: 'Yritykset' })
    .screenshot({ path: testInfo.outputPath('workspace-selector-dialog.png') });
  await closeWorkspaceDialog(e2eElectron.page);

  const pageBeforeSwitchToCreated = e2eElectron.page;
  await chooseWorkspaceForSwitch(
    pageBeforeSwitchToCreated,
    createdWorkspaceLabel,
  );
  await e2eElectron.performRelaunchingOperation(async () => {
    await pageBeforeSwitchToCreated
      .getByRole('button', { exact: true, name: 'Vaihda yritys' })
      .click();
  });
  expect(pageBeforeSwitchToCreated.isClosed()).toBe(true);

  await assertSingleHealthyDesktopRuntime(e2eElectron);
  await expectWorkspaceBrand(e2eElectron.page, createdWorkspaceLabel);
  await expectCustomerVisibility(
    e2eElectron.api,
    originalCustomerName,
    false,
  );
  expect(
    (await e2eElectron.api.get(`/invoices/${originalInvoice.invoiceId}`)).status(),
  ).toBe(404);

  await openWorkspaceDialog(e2eElectron.page);
  const createdRow = workspaceRow(e2eElectron.page, createdWorkspaceLabel);
  await createdRow.getByRole('button', { name: 'Nimeä uudelleen' }).click();
  const renameInput = e2eElectron.page.getByRole('textbox', {
    name: 'Yrityksen nimi',
  });
  await expect(renameInput).toHaveValue(createdWorkspaceLabel);
  await renameInput.fill(renamedWorkspaceLabel);
  await e2eElectron.page
    .getByRole('button', { name: 'Tallenna nimi' })
    .click();
  await expect(workspaceRow(e2eElectron.page, renamedWorkspaceLabel)).toBeVisible();
  await closeWorkspaceDialog(e2eElectron.page);
  await expectWorkspaceBrand(e2eElectron.page, renamedWorkspaceLabel);

  const pageBeforeSwitchToOriginal = e2eElectron.page;
  await chooseWorkspaceForSwitch(
    pageBeforeSwitchToOriginal,
    originalWorkspaceLabel,
  );
  await e2eElectron.performRelaunchingOperation(async () => {
    await pageBeforeSwitchToOriginal
      .getByRole('button', { exact: true, name: 'Vaihda yritys' })
      .click();
  });
  expect(pageBeforeSwitchToOriginal.isClosed()).toBe(true);

  await assertSingleHealthyDesktopRuntime(e2eElectron);
  await expectWorkspaceBrand(e2eElectron.page, originalWorkspaceLabel);
  await expectCustomerVisibility(e2eElectron.api, originalCustomerName, true);
  expect(
    (await e2eElectron.api.get(`/invoices/${originalInvoice.invoiceId}`)).status(),
  ).toBe(200);
  expect(
    await readActiveInvoicePdfSha256(
      e2eElectron,
      originalInvoice.invoiceId,
    ),
  ).toBe(originalPdfSha256);
});

test.describe('workspace backup import', () => {
  test.use({
    e2eNativeOpenDialogPurpose: 'workspaceBackupImport',
    e2eWorkspaceBackupFixture: 'synthetic',
  });

  test('DESK-WORKSPACE-IMPORT-001 @critical @recovery @security imports a real encrypted backup without exposing secrets', async ({
    e2eElectron,
  }) => {
    const fixture = requireWorkspaceBackupFixture(e2eElectron);
    const originalInvoice = await createApprovedInvoiceWithPdf(
      e2eElectron.api,
    );
    const sourceBackupSha256Before = await sha256File(fixture.backupPath);
    const sourceDatabaseSha256Before = await sha256File(
      fixture.sourceDatabaseFilePath,
    );

    const pageBeforeImport = e2eElectron.page;
    await openWorkspaceDialog(pageBeforeImport);
    await pageBeforeImport
      .getByRole('button', { name: 'Tuo yritys varmuuskopiosta' })
      .click();
    await pageBeforeImport
      .getByRole('textbox', { name: 'Yrityksen nimi' })
      .fill(importedWorkspaceLabel);
    await e2eElectron.performRelaunchingOperation(async () => {
      const passwordWindowPromise = waitForAdditionalWindow(
        e2eElectron.electronApp,
      );
      await pageBeforeImport
        .getByRole('button', { name: 'Valitse varmuuskopio' })
        .click();
      const passwordWindow = await passwordWindowPromise;
      await passwordWindow.locator('#password').fill(fixture.password);
      await clickPasswordWindowButtonAndWaitForClose(
        passwordWindow,
        '#submit',
      );
    });

    expect(await sha256File(fixture.backupPath)).toBe(
      sourceBackupSha256Before,
    );
    expect(await sha256File(fixture.sourceDatabaseFilePath)).toBe(
      sourceDatabaseSha256Before,
    );
    await expectWorkspaceBrand(e2eElectron.page, originalWorkspaceLabel);
    await openWorkspaceDialog(e2eElectron.page);
    await expect(workspaceRow(e2eElectron.page, importedWorkspaceLabel)).toBeVisible();
    await closeWorkspaceDialog(e2eElectron.page);
    await assertNoWorkspaceImportSecretExposure(e2eElectron, fixture);

    const pageBeforeSwitchToImported = e2eElectron.page;
    await chooseWorkspaceForSwitch(
      pageBeforeSwitchToImported,
      importedWorkspaceLabel,
    );
    await e2eElectron.performRelaunchingOperation(async () => {
      await pageBeforeSwitchToImported
        .getByRole('button', { exact: true, name: 'Vaihda yritys' })
        .click();
    });

    await assertSingleHealthyDesktopRuntime(e2eElectron);
    await expectWorkspaceBrand(e2eElectron.page, importedWorkspaceLabel);
    await expectCustomerVisibility(
      e2eElectron.api,
      fixture.customerName,
      true,
    );
    await expectCustomerVisibility(
      e2eElectron.api,
      originalCustomerName,
      false,
    );
    expect(
      (await e2eElectron.api.get(`/invoices/${fixture.invoiceId}`)).status(),
    ).toBe(200);
    expect(
      (await e2eElectron.api.get(`/invoices/${originalInvoice.invoiceId}`)).status(),
    ).toBe(404);
    expect(
      await readActiveInvoicePdfSha256(e2eElectron, fixture.invoiceId),
    ).toBe(fixture.pdfSha256);

    const pageBeforeSwitchToOriginal = e2eElectron.page;
    await chooseWorkspaceForSwitch(
      pageBeforeSwitchToOriginal,
      originalWorkspaceLabel,
    );
    await e2eElectron.performRelaunchingOperation(async () => {
      await pageBeforeSwitchToOriginal
        .getByRole('button', { exact: true, name: 'Vaihda yritys' })
        .click();
    });
    await expectCustomerVisibility(e2eElectron.api, originalCustomerName, true);
    await assertNoWorkspaceImportSecretExposure(e2eElectron, fixture);
  });

  test('DESK-WORKSPACE-PASSWORD-001 @critical @recovery cancels the password prompt without workspace mutation', async ({
    e2eElectron,
  }) => {
    const fixture = requireWorkspaceBackupFixture(e2eElectron);
    const registryBefore = readWorkspaceRegistry(e2eElectron);
    const runtimeIdBefore = e2eElectron.runtime.runtimeInstanceId;

    await openWorkspaceDialog(e2eElectron.page);
    await e2eElectron.page
      .getByRole('button', { name: 'Tuo yritys varmuuskopiosta' })
      .click();
    await e2eElectron.page
      .getByRole('textbox', { name: 'Yrityksen nimi' })
      .fill('Peruttu salasanavaihe');
    const passwordWindowPromise = waitForAdditionalWindow(
      e2eElectron.electronApp,
    );
    await e2eElectron.page
      .getByRole('button', { name: 'Valitse varmuuskopio' })
      .click();
    const passwordWindow = await passwordWindowPromise;
    await clickPasswordWindowButtonAndWaitForClose(passwordWindow, '#cancel');

    await expect(
      e2eElectron.page.getByRole('button', {
        name: 'Lisää yritys Ekyyn',
      }),
    ).toBeVisible();
    expect(e2eElectron.runtime.runtimeInstanceId).toBe(runtimeIdBefore);
    expect(readWorkspaceRegistry(e2eElectron)).toBe(registryBefore);
    await assertNoWorkspaceImportSecretExposure(e2eElectron, fixture);
    await assertSingleHealthyDesktopRuntime(e2eElectron);
  });
});

test.describe('workspace backup file selection cancellation', () => {
  test.use({
    e2eNativeOpenDialogMode: 'cancel',
    e2eNativeOpenDialogPurpose: 'workspaceBackupImport',
  });

  test('DESK-WORKSPACE-CANCEL-001 @critical @recovery cancels native backup selection without workspace mutation', async ({
    e2eElectron,
  }) => {
    const registryBefore = readWorkspaceRegistry(e2eElectron);
    const runtimeIdBefore = e2eElectron.runtime.runtimeInstanceId;

    await openWorkspaceDialog(e2eElectron.page);
    await e2eElectron.page
      .getByRole('button', { name: 'Tuo yritys varmuuskopiosta' })
      .click();
    await e2eElectron.page
      .getByRole('textbox', { name: 'Yrityksen nimi' })
      .fill('Peruttu tiedostovalinta');
    await e2eElectron.page
      .getByRole('button', { name: 'Valitse varmuuskopio' })
      .click();

    await expect(
      e2eElectron.page.getByRole('button', {
        name: 'Lisää yritys Ekyyn',
      }),
    ).toBeVisible();
    expect(e2eElectron.runtime.runtimeInstanceId).toBe(runtimeIdBefore);
    expect(readWorkspaceRegistry(e2eElectron)).toBe(registryBefore);
    await assertSingleHealthyDesktopRuntime(e2eElectron);
  });
});

async function openWorkspaceDialog(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /^Vaihda yritystä\. Aktiivinen yritys:/u })
    .click();
  await expect(page.getByRole('dialog', { name: 'Yritykset' })).toBeVisible();
}

async function closeWorkspaceDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sulje yritysvalikko' }).click();
  await expect(page.getByRole('dialog', { name: 'Yritykset' })).toHaveCount(0);
}

function workspaceRow(page: Page, workspaceLabel: string): Locator {
  return page
    .locator('li')
    .filter({ has: page.getByText(workspaceLabel, { exact: true }) });
}

async function chooseWorkspaceForSwitch(
  page: Page,
  workspaceLabel: string,
): Promise<void> {
  await openWorkspaceDialog(page);
  await workspaceRow(page, workspaceLabel)
    .getByRole('button', { name: 'Avaa yritys' })
    .click();
  await expect(page.getByRole('heading', { name: 'Avaa yritys' })).toBeVisible();
  await expect(
    page
      .getByRole('dialog', { name: 'Yritykset' })
      .getByText(workspaceLabel, { exact: true }),
  ).toBeVisible();
}

async function expectWorkspaceBrand(
  page: Page,
  workspaceLabel: string,
): Promise<void> {
  await expect(workspaceBrandButton(page, workspaceLabel)).toBeVisible();
}

function workspaceBrandButton(
  page: Page,
  workspaceLabel: string,
): Locator {
  return page.getByRole('button', {
    name: `Vaihda yritystä. Aktiivinen yritys: ${workspaceLabel}`,
  });
}

async function expectCustomerVisibility(
  api: APIRequestContext,
  customerName: string,
  expectedVisible: boolean,
): Promise<void> {
  const response = await api.get('/customers');
  expect(response.status()).toBe(200);
  const body = await response.text();
  if (expectedVisible) {
    expect(body).toContain(customerName);
  } else {
    expect(body).not.toContain(customerName);
  }
}

async function readActiveInvoicePdfSha256(
  harness: IsolatedElectronHarness,
  invoiceId: string,
): Promise<string> {
  const workspace = readElectronE2eActiveWorkspace(
    harness.runtime.userDataPath,
  );
  const document = readWorkspaceBackupInvoiceDocument(
    workspace.databaseFilePath,
    invoiceId,
  );
  const filePath = resolveWorkspaceBackupStoragePath(
    workspace.documentsRoot,
    document.storagePath,
  );
  expect(existsSync(filePath)).toBe(true);
  const fileSha256 = await sha256File(filePath);
  expect(fileSha256).toBe(document.sha256);
  return fileSha256;
}

async function assertSingleHealthyDesktopRuntime(
  harness: IsolatedElectronHarness,
): Promise<void> {
  const metrics = await readElectronProcessMetrics(harness.electronApp);
  expect(metrics.backendIsRunning).toBe(true);
  expect(metrics.backendStartCount).toBe(1);
  expect(metrics.windowCount).toBe(1);
}

function requireWorkspaceBackupFixture(
  harness: IsolatedElectronHarness,
) {
  if (harness.workspaceBackupFixture === undefined) {
    throw new Error('Workspace backup fixture is unavailable.');
  }
  return harness.workspaceBackupFixture;
}

function readWorkspaceRegistry(harness: IsolatedElectronHarness): string {
  return readFileSync(
    join(harness.runtime.userDataPath, 'workspace-registry-v1.json'),
    'utf8',
  );
}

async function assertNoWorkspaceImportSecretExposure(
  harness: IsolatedElectronHarness,
  fixture: NonNullable<IsolatedElectronHarness['workspaceBackupFixture']>,
): Promise<void> {
  const rendererContent = await harness.page.evaluate(() => ({
    bridgeKeys: Object.keys(
      (window as typeof window & { ekyDesktop?: unknown }).ekyDesktop ?? {},
    ),
    text: document.documentElement.textContent ?? '',
  }));
  const serializedRendererContent = JSON.stringify(rendererContent);
  expect(serializedRendererContent).not.toContain(fixture.backupPath);
  expect(serializedRendererContent).not.toContain(fixture.password);

  const observations = existsSync(harness.runtime.observationsPath)
    ? readFileSync(harness.runtime.observationsPath, 'utf8')
    : '';
  expect(observations).not.toContain(fixture.backupPath);
  expect(observations).not.toContain(fixture.password);
  expect(observations).not.toContain(fixture.sourceDatabaseFilePath);
}

function waitForAdditionalWindow(
  electronApp: ElectronApplication,
): Promise<Page> {
  return new Promise((resolveWindow, rejectWindow) => {
    const timeout = setTimeout(() => {
      rejectWindow(new Error('Electron password window was not created.'));
    }, 15_000);
    electronApp.once('window', (page) => {
      void page
        .waitForLoadState('load', { timeout: 10_000 })
        .then(() => {
          clearTimeout(timeout);
          resolveWindow(page);
        })
        .catch((error: unknown) => {
          clearTimeout(timeout);
          rejectWindow(error);
        });
    });
  });
}

async function clickPasswordWindowButtonAndWaitForClose(
  passwordWindow: Page,
  selector: '#cancel' | '#submit',
): Promise<void> {
  const closed = passwordWindow.waitForEvent('close');
  await passwordWindow.locator(selector).click();
  await closed;
}
