import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertWorkspaceBackupSchemaRejection } from '../../src/assertions/assertWorkspaceBackupSchemaRejection.js';
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { readElectronProcessMetrics } from '../../src/electron/electronMainCapabilities.js';
import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';
import { createSchemaRejectedWorkspaceBackup } from '../../src/workspaces/createSchemaRejectedWorkspaceBackup.js';
import { readWorkspaceBackupInvoiceDocument, resolveWorkspaceBackupStoragePath, sha256File } from '../../src/workspaces/workspaceBackupSystemTestSupport.js';

const preservedCustomerName = 'Synthetic Preserved Workspace Customer Oy';
const scenarios = [
  { id: 'DESK-WORKSPACE-IMPORT-SCHEMA-001', stage: 'import', purpose: 'workspaceBackupImport', fixture: 'synthetic' },
  { id: 'DESK-WORKSPACE-REPLACE-SCHEMA-001', stage: 'replace', purpose: 'workspaceBackupReplacement', fixture: 'activeReplacement' },
] as const;

for (const scenario of scenarios) {
  test.describe(`${scenario.stage} schema rejection`, () => {
    test.use({
      e2eDialogMode: 'accept',
      e2eNativeOpenDialogPurpose: scenario.purpose,
      e2eWorkspaceBackupFixture: scenario.fixture,
    });

    test(`${scenario.id} @critical @recovery @security @fault preserves data and the first safe cause through main, restart and support`, async ({ e2eElectron }) => {
      const fixture = e2eElectron.workspaceBackupFixture;
      if (fixture === undefined) throw new Error('SCHEMA_FIXTURE_BACKUP_MISSING');
      const invoiceId = scenario.stage === 'replace' ? fixture.invoiceId : (await createApprovedInvoiceWithPdf(e2eElectron.api)).invoiceId;
      const created = await e2eElectron.api.post('/customers', {
        data: createSyntheticCustomerInput({ customerNumber: 'E2E-SCHEMA-PRESERVED', name: preservedCustomerName }),
      });
      expect(created.status()).toBe(201);
      const customersResponse = await e2eElectron.api.get('/customers');
      expect(customersResponse.status()).toBe(200);
      const customersBefore = await customersResponse.json();
      expect(JSON.stringify(customersBefore)).toContain(preservedCustomerName);
      const invoiceResponse = await e2eElectron.api.get(`/invoices/${invoiceId}`);
      expect(invoiceResponse.status()).toBe(200);
      const invoiceBefore = await invoiceResponse.json();
      const activeBefore = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
      const document = readWorkspaceBackupInvoiceDocument(activeBefore.databaseFilePath, invoiceId);
      const pdfPath = resolveWorkspaceBackupStoragePath(activeBefore.documentsRoot, document.storagePath);
      const pdfSha256Before = await sha256File(pdfPath);
      expect(pdfSha256Before).toBe(document.sha256);
      const registryPath = join(e2eElectron.runtime.userDataPath, 'workspace-registry-v1.json');
      const registryBefore = readFileSync(registryPath);
      const sourceDatabaseSha256Before = await sha256File(fixture.sourceDatabaseFilePath);
      const modified = await createSchemaRejectedWorkspaceBackup({
        fixture,
        preparationRoot: join(e2eElectron.paths.tempRoot, 'schema-rejected-backup'),
        runRoot: e2eElectron.runRoot,
      });

      const pageBefore = e2eElectron.page;
      const oldRuntimeId = e2eElectron.runtime.runtimeInstanceId;
      const oldSessionSecret = e2eElectron.runtime.sessionSecret;
      const oldObservationsPath = e2eElectron.runtime.observationsPath;
      await pageBefore.getByRole('button', { name: /^Vaihda yrityst\u00e4\. Aktiivinen yritys:/u }).click();
      await expect(pageBefore.getByRole('dialog', { name: 'Yritykset' })).toBeVisible();
      if (scenario.stage === 'import') {
        await pageBefore.getByRole('button', { name: 'Tuo yritys varmuuskopiosta' }).click();
        await pageBefore.getByRole('textbox', { name: 'Yrityksen nimi' }).fill('Synthetic Rejected Schema');
      } else {
        await pageBefore.getByRole('button', { name: 'Korvaa tiedot varmuuskopiosta' }).click();
        await expect(pageBefore.getByRole('heading', { name: 'Aktiivisen yrityksen palautus' })).toBeVisible();
      }
      await e2eElectron.performRelaunchingOperation(async () => {
        const passwordWindowPromise = e2eElectron.electronApp.waitForEvent('window');
        await pageBefore.getByRole('button', { name: scenario.stage === 'import' ? 'Valitse varmuuskopio' : 'Jatka tiedoston valintaan' }).click();
        const passwordWindow = await passwordWindowPromise;
        await passwordWindow.waitForLoadState('load');
        await passwordWindow.locator('#password').fill(fixture.password);
        const passwordClosed = passwordWindow.waitForEvent('close');
        await passwordWindow.locator('#submit').click();
        await passwordClosed;
      });
      expect(pageBefore.isClosed()).toBe(true);
      expect(e2eElectron.runtime.runtimeInstanceId).not.toBe(oldRuntimeId);
      expect(e2eElectron.runtime.sessionSecret).not.toBe(oldSessionSecret);
      await expect(e2eElectron.page.getByRole('button', { name: 'Vaihda yrityst\u00e4. Aktiivinen yritys: Oma yritys' })).toBeVisible();
      await assertWorkspaceBackupSchemaRejection({ harness: e2eElectron, oldObservationsPath, oldSessionSecret, stage: scenario.stage, preservedCustomerName, preservedInvoiceId: invoiceId });

      expect(readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath)).toEqual(activeBefore);
      expect(readFileSync(registryPath)).toEqual(registryBefore);
      const customersAfter = await e2eElectron.api.get('/customers');
      expect(customersAfter.status()).toBe(200);
      expect(await customersAfter.json()).toEqual(customersBefore);
      const invoiceAfter = await e2eElectron.api.get(`/invoices/${invoiceId}`);
      expect(invoiceAfter.status()).toBe(200);
      expect(await invoiceAfter.json()).toEqual(invoiceBefore);
      expect(await sha256File(pdfPath)).toBe(pdfSha256Before);
      expect(await sha256File(fixture.sourceDatabaseFilePath)).toBe(sourceDatabaseSha256Before);
      expect(await sha256File(fixture.backupPath)).toBe(modified.backupSha256);
      expect(await sha256File(modified.modifiedDatabasePath)).toBe(modified.modifiedDatabaseSha256);
      expect(await readElectronProcessMetrics(e2eElectron.electronApp)).toMatchObject({ backendIsRunning: true, backendStartCount: 1, windowCount: 1 });
    });
  });
}
