import { Buffer } from 'node:buffer';
import type { BrowserContext, Download, Locator, Route } from '@playwright/test';
import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import {
  approveCurrentInvoiceDraft, createCurrentInvoicePdf, createInvoiceDraftThroughUi,
  openApprovedInvoiceFromList, openInvoiceDraftFromList, openInvoicingWorkspace,
  reopenCurrentInvoiceForEditing, seedInvoiceJourneyPrerequisites,
} from '../../src/journeys/invoicingWebJourney.js';

test('INV-HISTORY-PDF-UI-001 @critical preserves the earlier test PDF after editing and reapproval', async ({ e2eWeb }, testInfo) => {
  const { page, api, context } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(page, { customerId: customer.customerId, subject: 'Synthetic first revision' });
  const invoice = await approveCurrentInvoiceDraft(page);
  await createCurrentInvoicePdf(page);
  const pdfPath = `/invoices/${invoice.invoiceId}/pdf`;
  const original = await api.get(pdfPath);
  expect(original.status()).toBe(200);
  const oldBytes = await original.body();

  await page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
  await page.getByText('Testitoiminnot', { exact: true }).click();
  const sent = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/email/smtp-test/send'));
  await page.getByRole('button', { name: 'Lähetä hallittu SMTP-testi', exact: true }).click();
  expect((await sent).status()).toBe(200);
  const history = page.getByRole('region', { name: 'Toimitushistoria' });
  await expect(history.getByText('Testilähetys itselle', { exact: true })).toBeVisible();
  const eventsBefore = await (await api.get(`/invoices/${invoice.invoiceId}/delivery-events`)).json();
  const eventId = eventsBefore.events[0].id as string;
  const eventPath = `/invoices/${invoice.invoiceId}/delivery-events/${eventId}/pdf`;

  await reopenCurrentInvoiceForEditing(page);
  await expect(history.getByText('Testilähetys itselle', { exact: true })).toBeVisible();
  // Re-enter without the preceding approved view's in-memory invoice identity.
  await openInvoicingWorkspace(page);
  await openInvoiceDraftFromList(page, 'Synthetic first revision');
  await expect(history.getByText('Testilähetys itselle', { exact: true })).toBeVisible();
  const draftPreview = await openHistoryDownload(context,
    history.getByRole('button', { name: 'Avaa tapahtuman PDF', exact: true }));
  expect(new URL(draftPreview.download.url()).pathname).toBe(eventPath);
  const draftStream = await draftPreview.download.createReadStream();
  const draftChunks: Buffer[] = [];
  for await (const chunk of draftStream) draftChunks.push(Buffer.from(chunk));
  expect(Buffer.concat(draftChunks)).toEqual(oldBytes);
  await draftPreview.popup.close();
  await page.screenshot({ path: testInfo.outputPath('draft-history-pdf.png') });
  const reopenedPdf = await api.get(eventPath);
  expect(reopenedPdf.status()).toBe(200);
  expect(await reopenedPdf.body()).toEqual(oldBytes);
  const updated = page.waitForResponse(response => response.request().method() === 'PUT'
    && /\/invoice-drafts\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.getByLabel('Aihe', { exact: true }).fill('Synthetic changed second revision');
  await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  expect((await updated).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Laskuluonnoksen muutokset tallennettu.' })).toBeVisible();
  expect(await approveCurrentInvoiceDraft(page)).toEqual(invoice);
  await createCurrentInvoicePdf(page);
  const current = await api.get(pdfPath);
  expect(current.status()).toBe(200);
  expect(await current.body()).not.toEqual(oldBytes);
  const historical = await api.get(eventPath);
  expect(historical.status()).toBe(200);
  expect(await historical.body()).toEqual(oldBytes);

  const action = history.getByRole('button', { name: 'Avaa tapahtuman PDF', exact: true });
  await page.evaluate(() => {
    const originalOpen = window.open;
    window.open = () => { window.open = originalOpen; return null; };
  });
  await action.click();
  await expect(history.getByRole('alert')).toHaveText(/Tapahtuman PDF:ää ei voitu avata/);
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.method()); });
  const { popup, download } = await openHistoryDownload(context, action);
  expect(new URL(download.url()).pathname).toBe(eventPath);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(oldBytes);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  expect(writes).toEqual([]);
  await expect(history.getByRole('alert')).toHaveCount(0);
  expect(await (await api.get(`/invoices/${invoice.invoiceId}/delivery-events`)).json()).toEqual(eventsBefore);

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await action.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`history-pdf-${viewport.width}.png`) });
  }
});

test('INV-HISTORY-PDF-UI-002 @critical ignores a previous invoice response after selecting another invoice', async ({ e2eWeb }) => {
  const { page, api, context } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(page, { customerId: customer.customerId, subject: 'Synthetic older selection' });
  const older = await approveCurrentInvoiceDraft(page);
  await createInvoiceDraftThroughUi(page, { customerId: customer.customerId, subject: 'Synthetic current selection' });
  const current = await approveCurrentInvoiceDraft(page);
  await page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
  await page.getByText('Testitoiminnot', { exact: true }).click();
  const sent = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/email/smtp-test/send'));
  await page.getByRole('button', { name: 'Lähetä hallittu SMTP-testi', exact: true }).click();
  expect((await sent).status()).toBe(200);
  const events = await (await api.get(`/invoices/${current.invoiceId}/delivery-events`)).json();
  expect(events.events).toHaveLength(1);
  const eventPath = `/invoices/${current.invoiceId}/delivery-events/${events.events[0].id}/pdf`;

  await openInvoicingWorkspace(page);
  const oldPath = `/invoices/${older.invoiceId}`;
  let held!: Route;
  let captured!: () => void;
  const ready = new Promise<void>(resolve => { captured = resolve; });
  await page.route(`**${oldPath}`, route => { held = route; captured(); });
  await page.getByRole('button', { name: `Laskunumero ${older.invoiceNumber}`, exact: true }).click();
  await ready;
  await openInvoicingWorkspace(page);
  await openApprovedInvoiceFromList(page, current.invoiceNumber);
  const response = await held.fetch();
  expect(response.status()).toBe(200);
  const received = page.waitForResponse(item => new URL(item.url()).pathname === oldPath);
  await held.fulfill({ response });
  await (await received).finished();

  const history = page.getByRole('region', { name: 'Toimitushistoria' });
  const { popup, download } = await openHistoryDownload(context,
    history.getByRole('button', { name: 'Avaa tapahtuman PDF', exact: true }));
  expect(new URL(download.url()).pathname).toBe(eventPath);
  await expect(page.getByRole('heading', { name: `Lasku ${current.invoiceNumber}`, exact: true })).toBeVisible();
  await expect(history.getByText('Testilähetys itselle', { exact: true })).toBeVisible();
  await popup.close();

  // Customers mounts invoicing with a direct target under the real StrictMode.
  await page.getByRole('button', { name: 'Asiakkaat', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`${customer.customerNumber}.*${customer.customerName}`) }).click();
  await page.getByRole('button', { name: `Avaa lasku ${current.invoiceNumber}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `Lasku ${current.invoiceNumber}`, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Toimitushistoria' })
    .getByRole('button', { name: 'Avaa tapahtuman PDF', exact: true })).toBeEnabled();
});

async function openHistoryDownload(context: BrowserContext, action: Locator) {
  // Headless Chromium downloads PDF responses; native preview is a separate test.
  const downloaded = new Promise<Download>(resolve => {
    context.once('page', popup => { popup.once('download', resolve); });
  });
  const opened = context.waitForEvent('page');
  await action.click();
  return { popup: await opened, download: await downloaded };
}
