import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { createWorkspaceDeletionExecutionProof } from '../../../desktop/e2e/workspaceDeletionExecutionProof.js';
import { createWorkspaceDeletionJournalPaths } from '../../../desktop/src/workspaces/deletion/workspaceDeletionJournalStore.js';
import { workspaceDeletionInventoriesDirectoryName } from '../../../desktop/src/workspaces/deletion/workspaceDeletionInventoryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { deriveWorkspaceRoot } from '../../../desktop/src/workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceIdValidation.js';
import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import { expect, test, type IsolatedElectronHarness } from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';

type MainGlobal = typeof globalThis & { __EKY_ELECTRON_E2E__: {
  workspaceDeletionExecutionProof: Pick<ReturnType<typeof createWorkspaceDeletionExecutionProof>, 'execute' | 'snapshot'> & {
    prepareRecovery(request: unknown): Promise<void>;
  };
  backendIsRunning(): boolean;
  backendStartCount(): number;
} };

test.use({ e2eSelectorProfile: 'empty' });

for (const keepForeign of [true, false]) {
  test(`DESK-DELETE-UI-001 @critical @security @recovery deletes through the production form preload and default main command (last company: ${!keepForeign})`, async ({ e2eElectron }) => {
    const targetLabel = 'Synthetic public deletion', foreignLabel = 'Synthetic public retained company';
    if (keepForeign) await createCompany(e2eElectron, foreignLabel);
    await createCompany(e2eElectron, targetLabel);
    await openCompany(e2eElectron, targetLabel);
    const target = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
    const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
    expect((await e2eElectron.api.get(`/invoices/${invoice.invoiceId}/pdf`)).status()).toBe(200);
    expect((await e2eElectron.api.put('/company-settings/email-secret', {
      data: { secret: 'Synthetic public deletion secret 2026!' },
    })).status()).toBe(200);
    expect(readFileSync(target.databaseFilePath).subarray(0, 16).toString()).toBe('SQLite format 3\0');
    expect(existsSync(target.emailSecretFilePath)).toBe(true);
    const before = readRegistry(e2eElectron);
    const foreign = before.workspaces.find(entry => entry.workspaceId !== target.workspaceId);
    expect(before.workspaces).toHaveLength(keepForeign ? 2 : 1);
    expect(foreign === undefined).toBe(!keepForeign);
    if (foreign !== undefined) expect(foreign.workspaceLabel).toBe(foreignLabel);
    const foreignRoot = foreign === undefined ? undefined : join(e2eElectron.runtime.userDataPath, 'workspaces', foreign.workspaceId);
    const foreignBytes = foreignRoot === undefined ? undefined : treeBytes(foreignRoot);
    const external = join(e2eElectron.runRoot, 'public-deletion-external.pdf');
    const externalBytes = Buffer.from('%PDF-1.7\nSynthetic public external archive\n%%EOF\n');
    writeFileSync(external, externalBytes, { flag: 'wx' });
    expect(await e2eElectron.electronApp.evaluate(() =>
      (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionExecutionProof.snapshot().request)).toBe('notStarted');
    expect(await e2eElectron.page.evaluate(() => 'ekyWorkspaceDeletionProof' in window)).toBe(false);
    await e2eElectron.page.getByRole('button', {
      name: `Vaihda yritystä. Aktiivinen yritys: ${targetLabel}`, exact: true,
    }).click();
    const dialog = e2eElectron.page.getByRole('dialog');
    const row = dialog.getByRole('listitem').filter({ hasText: targetLabel });
    await row.getByRole('button', { name: 'Poista yritys', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Yrityksen lopullinen poisto', exact: true })).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'Jatka poistovahvistukseen', exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Vahvista yrityksen nimi', { exact: true }).fill(targetLabel);
    await dialog.getByRole('radio', { name: 'Jatkan ilman varmuuskopiota ja hyväksyn tietojen menetyksen', exact: true }).check();
    await expect(submit).toBeEnabled();
    const confirmationsBefore = await e2eElectron.electronApp.evaluate(() =>
      (globalThis as unknown as { __EKY_ELECTRON_E2E__: { nativeAdapterSnapshot(): { messageBoxCount: number } } })
        .__EKY_ELECTRON_E2E__.nativeAdapterSnapshot().messageBoxCount);
    const observationsPath = e2eElectron.runtime.observationsPath;
    const closed = await e2eElectron.performRelaunchingOperation(async () => { await submit.click(); });
    expect(e2eElectron.runtime.sessionSecret === closed.previousSessionSecret).toBe(false);
    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
    const confirmations = readFileSync(observationsPath, 'utf8').split(/\r?\n/u).filter(Boolean)
      .map(line => JSON.parse(line) as { operation: string }).filter(value => value.operation === 'showMessageBox');
    expect(confirmations).toHaveLength(confirmationsBefore + 2);
    assertRemoved(e2eElectron, target.workspaceRoot, foreign);
    if (foreignRoot !== undefined) expect(treeBytes(foreignRoot)).toEqual(foreignBytes);
    expect(readFileSync(external).equals(externalBytes)).toBe(true);
    expect(await e2eElectron.electronApp.evaluate(() =>
      (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendIsRunning())).toBe(false);
    const session = e2eElectron.runtime.sessionSecret;
    await e2eElectron.restart();
    expect(e2eElectron.runtime.sessionSecret === session).toBe(false);
    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
    assertRemoved(e2eElectron, target.workspaceRoot, foreign);
    if (foreignRoot !== undefined) expect(treeBytes(foreignRoot)).toEqual(foreignBytes);
    expect(readFileSync(external).equals(externalBytes)).toBe(true);
  });
}

for (const keepForeign of [false, true]) {
  const scenario = keepForeign ? 'DESK-DELETE-ACTIVE-001' : 'DESK-DELETE-LAST-001';
  test(`${scenario} @critical @security @recovery deletes the active company through the real main service`, async ({ e2eElectron }) => {
    const targetLabel = 'Synthetic final deletion';
    const foreignLabel = 'Synthetic retained company';
    if (keepForeign) await createCompany(e2eElectron, foreignLabel);
    await createCompany(e2eElectron, targetLabel);
    await openCompany(e2eElectron, targetLabel);
    const target = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
    const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
    expect((await e2eElectron.api.get(`/invoices/${invoice.invoiceId}/pdf`)).status()).toBe(200);
    expect((await e2eElectron.api.put('/company-settings/email-secret', {
      data: { secret: 'Synthetic deletion-only SMTP secret 2026!' },
    })).status()).toBe(200);
    expect(existsSync(target.databaseFilePath)).toBe(true);
    expect(readdirSync(target.documentsRoot, { recursive: true }).length).toBeGreaterThan(0);
    expect(existsSync(target.emailSecretFilePath)).toBe(true);

    // Independent external bytes live inside the fixture root, never user data.
    const external = join(e2eElectron.runRoot, 'retained-external.pdf');
    const externalBytes = Buffer.from('%PDF-1.7\nSynthetic external archive\n%%EOF\n');
    writeFileSync(external, externalBytes, { flag: 'wx' });
    const before = readRegistry(e2eElectron);
    const foreign = before.workspaces.find(entry => entry.workspaceId !== target.workspaceId);
    expect(foreign === undefined).toBe(!keepForeign);
    const foreignRoot = foreign === undefined ? undefined : join(e2eElectron.runtime.userDataPath, 'workspaces', foreign.workspaceId);
    const foreignBytes = foreignRoot === undefined ? undefined : treeBytes(foreignRoot);
    expect(await e2eElectron.electronApp.evaluate(() =>
      (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendIsRunning())).toBe(true);

    const receipt = await e2eElectron.electronApp.evaluate((_electron, request) =>
      (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionExecutionProof.execute(request),
    { formatVersion: 1, workspaceId: target.workspaceId, typedLabel: targetLabel, backupChoice: 'explicitDataLoss' });
    expect(receipt).toEqual({ formatVersion: 1, status: 'completed', navigation: 'selector' });
    expect(await e2eElectron.electronApp.evaluate(() =>
      (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendIsRunning())).toBe(false);
    assertRemoved(e2eElectron, target.workspaceRoot, foreign);
    if (foreignRoot !== undefined) expect(treeBytes(foreignRoot)).toEqual(foreignBytes);
    expect(readFileSync(external).equals(externalBytes)).toBe(true);

    const oldSession = e2eElectron.runtime.sessionSecret;
    await e2eElectron.restart();
    expect(e2eElectron.runtime.sessionSecret === oldSession).toBe(false);
    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
    expect(await e2eElectron.electronApp.evaluate(() =>
      (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendIsRunning())).toBe(false);
    assertRemoved(e2eElectron, target.workspaceRoot, foreign);
    if (foreignRoot !== undefined) expect(treeBytes(foreignRoot)).toEqual(foreignBytes);
    expect(readFileSync(external).equals(externalBytes)).toBe(true);
    if (foreign !== undefined) await expect(e2eElectron.page.getByText(foreign.workspaceLabel, { exact: true })).toBeVisible();
  });
}

test('DESK-DELETE-PASSIVE-001 @critical @security @recovery removes a used passive company and reopens only the previous company', async ({ e2eElectron }) => {
  const targetLabel = 'Synthetic passive deletion', retainedLabel = 'Synthetic previous company';
  await createCompany(e2eElectron, targetLabel);
  await createCompany(e2eElectron, retainedLabel);
  await openCompany(e2eElectron, targetLabel);
  const target = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
  await createApprovedInvoiceWithPdf(e2eElectron.api);
  expect((await e2eElectron.api.put('/company-settings/email-secret', {
    data: { secret: 'Synthetic passive target secret 2026!' },
  })).status()).toBe(200);
  expect(existsSync(target.emailSecretFilePath)).toBe(true);

  await e2eElectron.page.getByRole('button', {
    name: `Vaihda yritystä. Aktiivinen yritys: ${targetLabel}`, exact: true,
  }).click();
  await openCompany(e2eElectron, retainedLabel);
  const retained = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
  const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  expect((await e2eElectron.api.put('/company-settings/email-secret', {
    data: { secret: 'Synthetic previous company secret 2026!' },
  })).status()).toBe(200);
  const secretBytes = readFileSync(retained.emailSecretFilePath);
  const invoiceResponse = await e2eElectron.api.get(`/invoices/${invoice.invoiceId}`);
  expect(invoiceResponse.status()).toBe(200);
  const invoiceData = await invoiceResponse.json();
  const pdfResponse = await e2eElectron.api.get(`/invoices/${invoice.invoiceId}/pdf`);
  expect(pdfResponse.status()).toBe(200);
  const pdfBytes = await pdfResponse.body();
  const receipt = await e2eElectron.electronApp.evaluate((_electron, request) =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionExecutionProof.execute(request),
  { formatVersion: 1, workspaceId: target.workspaceId, typedLabel: targetLabel, backupChoice: 'explicitDataLoss' });
  expect(receipt).toEqual({ formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' });
  expect(await e2eElectron.electronApp.evaluate(() =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendIsRunning())).toBe(false);
  expect(existsSync(target.workspaceRoot)).toBe(false);
  expect(readRegistry(e2eElectron).activeWorkspaceId).toBe(retained.workspaceId);
  expect(readRegistry(e2eElectron).workspaces.map(entry => entry.workspaceId)).toEqual([retained.workspaceId]);
  assertDeletionArtifactsAbsent(e2eElectron);
  expect(readFileSync(retained.emailSecretFilePath).equals(secretBytes)).toBe(true);

  const previousSession = e2eElectron.runtime.sessionSecret;
  // The test explicitly requests a restart; this is not an automatic UI return.
  await e2eElectron.restart();
  expect(e2eElectron.runtime.sessionSecret === previousSession).toBe(false);
  expect(readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath).workspaceId).toBe(retained.workspaceId);
  const afterInvoice = await e2eElectron.api.get(`/invoices/${invoice.invoiceId}`);
  expect(afterInvoice.status()).toBe(200);
  expect(await afterInvoice.json()).toEqual(invoiceData);
  const afterPdf = await e2eElectron.api.get(`/invoices/${invoice.invoiceId}/pdf`);
  expect(afterPdf.status()).toBe(200);
  expect((await afterPdf.body()).equals(pdfBytes)).toBe(true);
  expect(readFileSync(retained.emailSecretFilePath).equals(secretBytes)).toBe(true);
  expect(existsSync(target.workspaceRoot)).toBe(false);
  assertDeletionArtifactsAbsent(e2eElectron);
});

test('DESK-DELETE-FAULT-001 @critical @security @recovery removes a corrupt database without starting a business backend', async ({ e2eElectron }) => {
  const label = 'Synthetic faulty deletion';
  await createCompany(e2eElectron, label);
  const registry = readRegistry(e2eElectron);
  expect(registry.activeWorkspaceId).toBeNull();
  expect(registry.workspaces).toHaveLength(1);
  const entry = registry.workspaces[0]!;
  const root = deriveWorkspaceRoot(e2eElectron.runtime.userDataPath, validateWorkspaceId(entry.workspaceId), 1).workspaceRoot;
  const database = join(root, 'runtime', 'data', 'eky.sqlite');
  const databaseStat = lstatSync(database);
  expect(databaseStat.isFile()).toBe(true);
  expect(databaseStat.isSymbolicLink()).toBe(false);
  expect(databaseStat.nlink).toBe(1);
  expect(readFileSync(database).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  const state = await e2eElectron.electronApp.evaluate(() => {
    const main = (globalThis as MainGlobal).__EKY_ELECTRON_E2E__;
    return { running: main.backendIsRunning(), starts: main.backendStartCount() };
  });
  expect(state).toEqual({ running: false, starts: 0 });
  // Only this closed, freshly created synthetic database is fault-injected.
  const corrupt = Buffer.from('Synthetic invalid SQLite file, not customer data.');
  writeFileSync(database, corrupt, { flag: 'r+' });
  expect(readFileSync(database).subarray(0, corrupt.length).equals(corrupt)).toBe(true);
  expect(await e2eElectron.electronApp.evaluate((_electron, request) =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionExecutionProof.execute(request),
  { formatVersion: 1, workspaceId: entry.workspaceId, typedLabel: label, backupChoice: 'explicitDataLoss' }))
    .toEqual({ formatVersion: 1, status: 'completed', navigation: 'selector' });
  expect(await e2eElectron.electronApp.evaluate(() =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendStartCount())).toBe(0);
  assertRemoved(e2eElectron, root, undefined);
  await e2eElectron.restart();
  await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
  expect(await e2eElectron.electronApp.evaluate(() =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendStartCount())).toBe(0);
  assertRemoved(e2eElectron, root, undefined);
});

test('DESK-DELETE-RECOVERY-001 @critical @security @recovery transfers actual startup ownership through the production form to terminal deletion', async ({ e2eElectron }) => {
  const targetLabel = 'Synthetic interrupted recovery target', foreignLabel = 'Synthetic recovery retained company';
  await createCompany(e2eElectron, foreignLabel);
  await createCompany(e2eElectron, targetLabel);
  await openCompany(e2eElectron, targetLabel);
  const target = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
  const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  expect((await e2eElectron.api.get(`/invoices/${invoice.invoiceId}/pdf`)).status()).toBe(200);
  expect((await e2eElectron.api.put('/company-settings/email-secret', {
    data: { secret: 'Synthetic recovery deletion SMTP secret 2026!' },
  })).status()).toBe(200);
  await e2eElectron.page.getByRole('button', {
    name: `Vaihda yritystä. Aktiivinen yritys: ${targetLabel}`, exact: true,
  }).click();
  await openCompany(e2eElectron, foreignLabel);
  const retained = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
  const retainedInvoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  const retainedInvoiceData = await (await e2eElectron.api.get(`/invoices/${retainedInvoice.invoiceId}`)).json();
  const retainedPdf = await (await e2eElectron.api.get(`/invoices/${retainedInvoice.invoiceId}/pdf`)).body();
  expect((await e2eElectron.api.put('/company-settings/email-secret', {
    data: { secret: 'Synthetic retained recovery company secret 2026!' },
  })).status()).toBe(200);
  const foreign = readRegistry(e2eElectron).workspaces.find(entry => entry.workspaceId !== target.workspaceId)!;
  expect(foreign.workspaceLabel).toBe(foreignLabel);
  const foreignRoot = join(e2eElectron.runtime.userDataPath, 'workspaces', foreign.workspaceId);
  const external = join(e2eElectron.runRoot, 'recovery-retained-external.pdf');
  const externalBytes = Buffer.from('%PDF-1.7\nSynthetic recovery external archive\n%%EOF\n');
  writeFileSync(external, externalBytes, { flag: 'wx' });
  await e2eElectron.electronApp.evaluate((_electron, request) =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionExecutionProof.prepareRecovery(request),
  { workspaceId: target.workspaceId });
  const registryBefore = readFileSync(join(e2eElectron.runtime.userDataPath, WORKSPACE_REGISTRY_FILE_NAME));
  const targetBefore = treeBytes(target.workspaceRoot), foreignBefore = treeBytes(foreignRoot);
  const retainedSecret = readFileSync(retained.emailSecretFilePath);
  expect(readFileSync(target.databaseFilePath).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  expect(existsSync(target.emailSecretFilePath)).toBe(true);
  const previousSession = e2eElectron.runtime.sessionSecret;
  await e2eElectron.restart();
  expect(e2eElectron.runtime.sessionSecret === previousSession).toBe(false);
  await expect(e2eElectron.page.getByRole('heading', { name: 'Yrityksen palautushallinta', exact: true })).toBeVisible();
  const status = await e2eElectron.page.evaluate(() => (window as typeof window & { ekyDesktop: {
    getWorkspaceManagementStatus(): Promise<unknown>;
  } }).ekyDesktop.getWorkspaceManagementStatus());
  expect(status).toEqual({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
    maintenanceState: 'idle', operationState: 'idle', persistedActiveWorkspaceId: retained.workspaceId,
    target: { workspaceId: target.workspaceId, workspaceLabel: targetLabel } });
  expect(readFileSync(join(e2eElectron.runtime.userDataPath, WORKSPACE_REGISTRY_FILE_NAME)).equals(registryBefore)).toBe(true);
  expect(treeBytes(target.workspaceRoot)).toEqual(targetBefore);
  expect(treeBytes(foreignRoot)).toEqual(foreignBefore);
  expect(await e2eElectron.electronApp.evaluate(() => {
    const main = (globalThis as MainGlobal).__EKY_ELECTRON_E2E__;
    return { starts: main.backendStartCount(), running: main.backendIsRunning() };
  })).toEqual({ starts: 0, running: false });
  expect(await e2eElectron.electronApp.evaluate(() =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionExecutionProof.snapshot().request)).toBe('notStarted');
  const confirmationsBefore = await e2eElectron.electronApp.evaluate(() =>
    (globalThis as unknown as { __EKY_ELECTRON_E2E__: { nativeAdapterSnapshot(): { messageBoxCount: number } } })
      .__EKY_ELECTRON_E2E__.nativeAdapterSnapshot().messageBoxCount);
  const recoverySession = e2eElectron.runtime.sessionSecret;
  await e2eElectron.page.getByRole('button', { name: 'Poista yritys', exact: true }).click();
  await expect(e2eElectron.page.getByRole('radio', { name: 'Luo ja tarkista varmuuskopio ennen poistoa', exact: true })).toHaveCount(0);
  await e2eElectron.page.getByLabel('Vahvista yrityksen nimi', { exact: true }).fill(targetLabel);
  const loss = e2eElectron.page.getByRole('radio', { name: 'Jatkan ilman varmuuskopiota ja hyväksyn tietojen menetyksen', exact: true });
  await expect(loss).not.toBeChecked();
  await loss.check();
  e2eElectron.selectWorkspaceDeletionObservationRuntime();
  await e2eElectron.page.getByRole('button', { name: 'Jatka poistovahvistukseen', exact: true }).click();
  await expect(e2eElectron.page.getByRole('status').filter({ hasText: 'Yritys poistettiin. Voit sulkea Ekyn.' }))
    .toHaveText('Yritys poistettiin. Voit sulkea Ekyn.', { timeout: 100_000 });
  expect(e2eElectron.runtime.sessionSecret === recoverySession).toBe(true);
  expect(await e2eElectron.electronApp.evaluate(() =>
    (globalThis as unknown as { __EKY_ELECTRON_E2E__: { nativeAdapterSnapshot(): { messageBoxCount: number } } })
      .__EKY_ELECTRON_E2E__.nativeAdapterSnapshot().messageBoxCount)).toBe(confirmationsBefore + 2);
  expect(await e2eElectron.electronApp.evaluate(() =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionExecutionProof.snapshot().request)).toBe('notStarted');
  expect(e2eElectron.page.isClosed()).toBe(false);
  assertRemoved(e2eElectron, target.workspaceRoot, foreign, retained.workspaceId);
  expect(treeBytes(foreignRoot)).toEqual(foreignBefore);
  expect(readFileSync(external).equals(externalBytes)).toBe(true);
  expect(await e2eElectron.electronApp.evaluate(() =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendStartCount())).toBe(0);
  await e2eElectron.restart();
  await expect(e2eElectron.page.getByRole('button', {
    name: `Vaihda yritystä. Aktiivinen yritys: ${foreignLabel}`, exact: true,
  })).toBeVisible();
  assertRemoved(e2eElectron, target.workspaceRoot, foreign, retained.workspaceId);
  expect(readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath).workspaceId).toBe(retained.workspaceId);
  expect(await (await e2eElectron.api.get(`/invoices/${retainedInvoice.invoiceId}`)).json()).toEqual(retainedInvoiceData);
  expect((await (await e2eElectron.api.get(`/invoices/${retainedInvoice.invoiceId}/pdf`)).body()).equals(retainedPdf)).toBe(true);
  expect(readFileSync(retained.emailSecretFilePath).equals(retainedSecret)).toBe(true);
  expect(readFileSync(external).equals(externalBytes)).toBe(true);
  expect(await e2eElectron.electronApp.evaluate(() =>
    (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.backendStartCount())).toBe(1);
});

async function createCompany(harness: IsolatedElectronHarness, label: string) {
  await expect(harness.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
  await harness.page.getByRole('button', { name: 'Lisää yritys Ekyyn' }).click();
  await harness.page.getByRole('textbox', { name: 'Yrityksen nimi' }).fill(label);
  await harness.performRelaunchingOperation(async () => {
    await harness.page.getByRole('button', { name: 'Luo yritys', exact: true }).click();
  });
}

async function openCompany(harness: IsolatedElectronHarness, label: string) {
  await harness.page.getByRole('listitem').filter({
    has: harness.page.getByText(label, { exact: true }),
  }).getByRole('button', { name: 'Avaa yritys', exact: true }).click();
  await harness.performRelaunchingOperation(async () => {
    await harness.page.getByRole('button', { name: 'Vaihda yritys', exact: true }).click();
  });
  await expect(harness.page.getByRole('button', {
    name: `Vaihda yritystä. Aktiivinen yritys: ${label}`, exact: true,
  })).toBeVisible();
}

function readRegistry(harness: IsolatedElectronHarness): {
  activeWorkspaceId: string | null; workspaces: { workspaceId: string; workspaceLabel: string }[];
} {
  return JSON.parse(readFileSync(join(harness.runtime.userDataPath, WORKSPACE_REGISTRY_FILE_NAME), 'utf8'));
}

function assertRemoved(harness: IsolatedElectronHarness, targetRoot: string,
  foreign: { workspaceId: string; workspaceLabel: string } | undefined, activeWorkspaceId: string | null = null) {
  expect(existsSync(targetRoot)).toBe(false);
  const registry = readRegistry(harness);
  expect(registry.activeWorkspaceId).toBe(activeWorkspaceId);
  expect(registry.workspaces).toEqual(foreign === undefined ? [] : [foreign]);
  assertDeletionArtifactsAbsent(harness);
}

function assertDeletionArtifactsAbsent(harness: IsolatedElectronHarness) {
  const slots = createWorkspaceDeletionJournalPaths(harness.runtime.userDataPath);
  for (const path of [slots.currentPath, slots.nextPath, slots.backupPath]) expect(existsSync(path)).toBe(false);
  const inventories = join(slots.directoryPath, workspaceDeletionInventoriesDirectoryName);
  if (existsSync(inventories)) expect(readdirSync(inventories)).toEqual([]);
  assertNoQuarantine(harness.runtime.userDataPath);
}

function assertNoQuarantine(root: string) {
  for (const name of readdirSync(root)) {
    expect(name.startsWith('.workspace-delete-')).toBe(false);
    const path = join(root, name), stat = lstatSync(path);
    expect(stat.isSymbolicLink()).toBe(false);
    if (stat.isDirectory()) assertNoQuarantine(path);
  }
}

function treeBytes(root: string): Record<string, string> {
  expect(lstatSync(root).isSymbolicLink()).toBe(false);
  const result: Record<string, string> = {};
  const visit = (relative: string) => {
    const path = join(root, relative), stat = lstatSync(path);
    expect(stat.isSymbolicLink()).toBe(false);
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(relative, name));
    else {
      expect(stat.isFile()).toBe(true);
      result[relative] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  visit(''); return result;
}
