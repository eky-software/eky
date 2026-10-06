import { closeElectronPdfPreviews, readElectronPdfPreviewUrls } from '../../src/electron/electronMainCapabilities.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';
import {
  approveCurrentInvoiceDraft,
  createCurrentInvoicePdf,
  openApprovedInvoiceFromList,
  openInvoicingWorkspace,
  reopenCurrentInvoiceForEditing,
} from '../../src/journeys/invoicingWebJourney.js';

test('DESK-PDF-REVISION-001 @critical replaces an open current PDF after reapproval', async ({ e2eElectron }) => {
  const { api, page, electronApp } = e2eElectron;
  const invoice = await createApprovedInvoiceWithPdf(api);
  const pdfPath = `/invoices/${invoice.invoiceId}/pdf`;
  const expectedUrl = `eky://app${pdfPath}`;
  const firstResponse = await api.get(pdfPath);
  expect(firstResponse.status()).toBe(200);
  const firstBytes = await firstResponse.body();
  await openInvoicingWorkspace(page);
  await openApprovedInvoiceFromList(page, invoice.invoiceNumber);
  await page.getByRole('button', { name: 'Avaa PDF', exact: true }).click();
  await expect.poll(() => readElectronPdfPreviewUrls(electronApp)).toEqual([expectedUrl]);
  const firstPreview = electronApp.windows().find(window => window.url() === expectedUrl);
  expect(firstPreview).toBeDefined();

  // Keep the nonmodal preview open while the real editor publishes a new revision.
  await page.bringToFront();
  const draftId = await reopenCurrentInvoiceForEditing(page);
  const updated = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `/invoice-drafts/${draftId}`);
  await page.getByLabel('Aihe', { exact: true }).fill('Synthetic replacement revision');
  await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  expect((await updated).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Laskuluonnoksen muutokset tallennettu.' })).toBeVisible();
  expect(await approveCurrentInvoiceDraft(page)).toMatchObject({ ...invoice, draftId });
  await openInvoicingWorkspace(page);
  await openApprovedInvoiceFromList(page, invoice.invoiceNumber);
  await createCurrentInvoicePdf(page);
  const currentResponse = await api.get(pdfPath);
  expect(currentResponse.status()).toBe(200);
  expect(await currentResponse.body()).not.toEqual(firstBytes);
  expect(firstPreview!.isClosed()).toBe(false);

  await page.getByRole('button', { name: 'Avaa PDF', exact: true }).click();
  await expect.poll(() => firstPreview!.isClosed()).toBe(true);
  await expect.poll(() => readElectronPdfPreviewUrls(electronApp)).toEqual([expectedUrl]);
  await expect.poll(() => electronApp.windows().length).toBe(2);
  const currentPreview = electronApp.windows().find(window => window.url() === expectedUrl);
  expect(currentPreview).toBeDefined();
  expect(currentPreview).not.toBe(firstPreview);
  await closeElectronPdfPreviews(electronApp);
  await expect.poll(() => electronApp.windows().length).toBe(1);
});
