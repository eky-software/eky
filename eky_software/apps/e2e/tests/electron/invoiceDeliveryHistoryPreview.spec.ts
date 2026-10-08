import { createSyntheticCompanySettingsInput } from '../../src/data/syntheticBusinessInputs.js';
import { closeElectronPdfPreviews, readElectronPdfPreviewUrls } from '../../src/electron/electronMainCapabilities.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';
import { approveCurrentInvoiceDraft, openApprovedInvoiceFromList, openInvoiceDraftFromList, openInvoicingWorkspace } from '../../src/journeys/invoicingWebJourney.js';

test('DESK-HISTORY-PDF-001 @critical @security opens immutable history through the real renderer and native preview', async ({ e2eElectron }) => {
  const { api, page, electronApp } = e2eElectron;
  const invoice = await createApprovedInvoiceWithPdf(api);
  expect((await api.put('/company-settings', {
    data: createSyntheticCompanySettingsInput({ emailDeliveryProvider: 'dnaSmtp' }),
  })).status()).toBe(200);
  const originalResponse = await api.get(`/invoices/${invoice.invoiceId}/pdf`);
  expect(originalResponse.status()).toBe(200);
  const oldBytes = await originalResponse.body();
  const invoiceResponse = await api.get(`/invoices/${invoice.invoiceId}`);
  expect(invoiceResponse.status()).toBe(200);
  const { invoice: originalInvoice } = await invoiceResponse.json();

  // Fake SMTP setup goes through the test-owned API context. This case proves
  // production history preview, not the separately tested native send dialog.
  const message = { to: 'unused@example.invalid', cc: '', subject: 'Synthetic self test', body: 'Synthetic body' };
  const prepare = await api.post(`/invoices/${invoice.invoiceId}/email/smtp-test/prepare`, { data: message });
  expect(prepare.status()).toBe(200);
  const { preparation } = await prepare.json();
  const send = await api.post(`/invoices/${invoice.invoiceId}/email/smtp-test/send`, { data: {
    ...message, attemptId: preparation.attemptId, authorizationToken: preparation.authorizationToken,
  } });
  expect(send.status()).toBe(200);
  const historyPath = `/invoices/${invoice.invoiceId}/delivery-events`;
  const historyResponse = await api.get(historyPath);
  expect(historyResponse.status()).toBe(200);
  const historyBefore = await historyResponse.json();
  expect(historyBefore.events).toEqual([expect.objectContaining({ sendMode: 'smtpTest', documentSource: 'revision' })]);
  const eventId = historyBefore.events[0].id as string;
  const eventPath = `${historyPath}/${eventId}/pdf`;
  const reopen = await api.post(`/invoices/${invoice.invoiceId}/reopen-for-edit`);
  expect(reopen.status()).toBe(200);
  const { invoiceDraftId } = await reopen.json();
  await openInvoicingWorkspace(page);
  await openInvoiceDraftFromList(page, originalInvoice.subject);
  const draftHistory = page.getByRole('region', { name: 'Toimitushistoria' });
  await expect(draftHistory.getByText('Testilähetys itselle', { exact: true })).toBeVisible();
  await draftHistory.getByRole('button', { name: 'Avaa tapahtuman PDF', exact: true }).click();
  await expect.poll(() => readElectronPdfPreviewUrls(electronApp)).toEqual([`eky://app${eventPath}`]);
  await closeElectronPdfPreviews(electronApp);
  await expect.poll(() => electronApp.windows().length).toBe(1);
  // Mutate through the open editor so its normal list invalidation runs.
  const updated = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `/invoice-drafts/${invoiceDraftId}`);
  await page.getByLabel('Aihe', { exact: true }).fill('Synthetic second revision');
  await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  expect((await updated).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Laskuluonnoksen muutokset tallennettu.' })).toBeVisible();
  expect(await approveCurrentInvoiceDraft(page)).toMatchObject({ ...invoice, draftId: invoiceDraftId });
  const created = await api.post(`/invoices/${invoice.invoiceId}/pdf`);
  expect([200, 201]).toContain(created.status());
  const currentResponse = await api.get(`/invoices/${invoice.invoiceId}/pdf`);
  expect(currentResponse.status()).toBe(200);
  expect(await currentResponse.body()).not.toEqual(oldBytes);

  await openInvoicingWorkspace(page);
  await openApprovedInvoiceFromList(page, invoice.invoiceNumber);
  const history = page.getByRole('region', { name: 'Toimitushistoria' });
  await expect(history.getByText('Testilähetys itselle', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Avaa tapahtuman PDF', exact: true }).click();
  await expect.poll(() => readElectronPdfPreviewUrls(electronApp)).toEqual([`eky://app${eventPath}`]);
  await expect.poll(() => electronApp.windows().length).toBe(2);
  const historicalResponse = await api.get(eventPath);
  expect(historicalResponse.status()).toBe(200);
  expect(await historicalResponse.body()).toEqual(oldBytes);
  expect(await (await api.get(historyPath)).json()).toEqual(historyBefore);
  const preview = electronApp.windows().find(window => window.url() === `eky://app${eventPath}`);
  expect(preview).toBeDefined();
  expect(await preview!.evaluate(() => ({
    process: typeof (window as unknown as { process?: unknown }).process,
    require: typeof (window as unknown as { require?: unknown }).require,
    opener: window.opener === null,
  }))).toEqual({ process: 'undefined', require: 'undefined', opener: true });
  await closeElectronPdfPreviews(electronApp);
  await expect.poll(() => electronApp.windows().length).toBe(1);
});
