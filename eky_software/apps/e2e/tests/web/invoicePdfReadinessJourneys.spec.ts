import type { APIResponse, Route } from '@playwright/test';

import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import {
  approveCurrentCreditDraft,
  createCreditDraftFromCurrentInvoice,
} from '../../src/journeys/invoicingCreditJourney.js';
import {
  approveCurrentInvoiceDraft,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  seedInvoiceJourneyPrerequisites,
  sendCurrentInvoiceThroughFakeSmtp,
} from '../../src/journeys/invoicingWebJourney.js';

for (const { id, status, description } of [
  { id: 'INV-PDF-READY-001', status: 200, description: 'waits for the stored credit PDF metadata' },
  { id: 'INV-PDF-READY-002', status: 404, description: 'retains creation after a missing metadata response' },
  { id: 'INV-PDF-READY-003', status: 500, description: 'rejects a failed metadata response without claiming approval readiness' },
] as const) {
  test(`${id} @critical ${description}`, async ({ e2eWeb }) => {
    const { page, api, paths } = e2eWeb;
    const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
    await createInvoiceDraftThroughUi(page, {
      customerId: customer.customerId,
      lines: [{ description: 'Synthetic PDF readiness', quantity: '1', unitPrice: '124' }],
      performancePeriod: { type: 'singleDate', date: '2026-07-29' },
      subject: 'Synthetic credit PDF readiness',
      taxTreatment: 'reverseChargeConstruction',
    });
    const source = await approveCurrentInvoiceDraft(page, { reverseCharge: true });
    await createCurrentInvoicePdf(page);
    const sourceMetadata = await (await api.get(`/invoices/${source.invoiceId}/pdf/metadata`)).json();
    await sendCurrentInvoiceThroughFakeSmtp(page);
    await createCreditDraftFromCurrentInvoice(page);

    const pattern = '**/invoices/*/pdf/metadata';
    let held: { route: Route; response: APIResponse } | undefined;
    let routeError: unknown;
    let metadataRequests = 0;
    const handler = async (route: Route) => {
      if (new URL(route.request().url()).pathname === `/invoices/${source.invoiceId}/pdf/metadata`) {
        await route.fulfill({ status: 200, json: sourceMetadata });
        return;
      }
      metadataRequests += 1;
      try {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(held).toBeUndefined();
        held = { route, response };
      } catch (error) {
        routeError = error;
        await route.abort();
      }
    };
    await page.route(pattern, handler);
    let approval: ReturnType<typeof approveCurrentCreditDraft> | undefined;
    let completed = false;
    let approvalError: unknown;
    try {
      approval = approveCurrentCreditDraft(page);
      // Observe completion without turning a rejection into an unhandled error.
      void approval.then(() => { completed = true; }, error => { approvalError = error; });
      await expect.poll(() => held !== undefined || routeError !== undefined || approvalError !== undefined).toBe(true);
      if (routeError !== undefined) throw routeError;
      if (approvalError !== undefined) throw approvalError;
      await expect(page.getByRole('heading', { level: 2, name: /^Hyvityslasku / })).toBeVisible();
      await page.getByRole('button', { name: 'Luo PDF', exact: true }).click({ trial: true });
      // An unrelated successful metadata response must not complete this approval.
      expect(await page.evaluate(async (path) => (await fetch(path)).status,
        `/invoices/${source.invoiceId}/pdf/metadata`)).toBe(200);
      expect(completed, 'Credit approval must include its pending PDF metadata read.').toBe(false);

      const current = held!;
      try {
        if (status === 200) await current.route.fulfill({ response: current.response });
        else await current.route.fulfill({ status, json: { error: 'Synthetic PDF metadata response.' } });
      } finally {
        await current.response.dispose();
        held = undefined;
      }
      if (status === 500) {
        await expect(approval).rejects.toThrow('Approved invoice PDF metadata returned unexpected status 500.');
        expect(metadataRequests).toBe(1);
        return;
      }
      const credit = await approval;
      expect(metadataRequests).toBe(1);
      await expect(page.getByRole('button', {
        name: status === 200 ? 'Avaa PDF' : 'Luo PDF', exact: true,
      })).toBeVisible();
      if (status === 200) expect(await createCurrentInvoicePdf(page)).toBeNull();
      else await expect(page.getByRole('button', { name: 'Luo PDF', exact: true })).toBeEnabled();
      const metadata = await api.get(`/invoices/${credit.invoiceId}/pdf/metadata`);
      expect(metadata.status()).toBe(200);
      expect((await metadata.json()).document.invoiceId).toBe(credit.invoiceId);
      expect(readE2eSqliteRows(paths.databaseFilePath,
        'SELECT COUNT(*) AS count FROM invoice_documents WHERE invoice_id = ?', credit.invoiceId))
        .toEqual([{ count: 1 }]);
    } finally {
      try {
        if (held) await held.route.abort();
      } finally {
        await held?.response.dispose();
        await page.unroute(pattern, handler);
        if (approval) {
          if (!completed && approvalError === undefined) await page.close();
          await Promise.allSettled([approval]);
        }
      }
    }
  });
}

test('INV-PDF-READY-004 @critical @fault preserves approval failure when its pending PDF observation is cancelled', async ({ e2eWeb }) => {
  const { page, paths } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(page, {
    customerId: customer.customerId,
    subject: 'Synthetic credit approval rejection',
  });
  await approveCurrentInvoiceDraft(page);
  await sendCurrentInvoiceThroughFakeSmtp(page);
  await createCreditDraftFromCurrentInvoice(page);

  const pattern = '**/invoice-drafts/*/approve-credit';
  const handler = (route: Route) => route.fulfill({
    status: 500,
    json: { error: 'Synthetic credit approval rejection.' },
  });
  await page.route(pattern, handler);
  try {
    const failure: unknown = await approveCurrentCreditDraft(page).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error('Expected credit approval rejection.');
    const expected = 'Unexpected credit invoice approval response status: 500; expected 200.';
    expect(failure.message).toBe(expected);
    await page.unroute(pattern, handler);
    // Closing the owning page cancels the still-pending metadata observer.
    await page.close();
    expect(failure.message).toBe(expected);
    expect(readE2eSqliteRows(paths.databaseFilePath, 'SELECT COUNT(*) AS count FROM invoices'))
      .toEqual([{ count: 1 }]);
  } finally {
    if (!page.isClosed()) await page.unroute(pattern, handler);
  }
});
