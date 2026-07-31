import { createHash } from 'node:crypto';

import { readE2eOperationalLogs } from '../../src/assertions/readE2eOperationalLogs.js';
import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import {
  approveCurrentInvoiceDraft,
  cancelCurrentApprovedInvoice,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  openApprovedInvoiceFromList,
  openInvoiceDraftFromList,
  openInvoicingWorkspace,
  seedInvoiceJourneyPrerequisites,
} from '../../src/journeys/invoicingWebJourney.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedWebTest.js';

test('INV-LIFECYCLE-001 @critical completes the invoice lifecycle without exposing email content', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const subject = 'E2E lifecycle invoice';
  const privateEmailBody = 'Synthetic private E2E email body';
  const draft = await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject,
  });

  expect(draft).toEqual({
    grossTotalCents: 28_865,
    id: expect.any(String),
    netTotalCents: 23_000,
    vatTotalCents: 5_865,
  });
  await expect(e2eWeb.page.getByText('288,65 €')).toBeVisible();

  await e2eWeb.page.reload();
  await openInvoicingWorkspace(e2eWeb.page);
  await openInvoiceDraftFromList(e2eWeb.page, subject);
  await expect(
    e2eWeb.page.getByRole('group', { name: 'Rivi 1' }).getByLabel('Määrä'),
  ).toHaveValue('2,00');
  await expect(
    e2eWeb.page.getByRole('group', { name: 'Rivi 2' }).getByLabel('Määrä'),
  ).toHaveValue('1,50');

  const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await e2eWeb.page.getByLabel('Viestin sisältö').waitFor({ state: 'hidden' });
  await e2eWeb.page.getByRole('button', { name: 'Valmistele sähköposti' }).click();
  await e2eWeb.page.getByLabel('Viestin sisältö').fill(privateEmailBody);
  const sendResponsePromise = e2eWeb.page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/invoices\/[^/]+\/email\/smtp\/send$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await e2eWeb.page.getByRole('button', { name: 'Lähetä lasku' }).click();
  const sendResponse = await sendResponsePromise;
  expect(sendResponse.status()).toBe(200);
  await expect(
    e2eWeb.page.getByText('Lasku lähetettiin ja merkittiin lähetetyksi.'),
  ).toBeVisible();

  const invoiceResponse = await e2eWeb.api.get(
    `/invoices/${approved.invoiceId}`,
  );
  expect(invoiceResponse.status()).toBe(200);
  const invoiceBody = (await invoiceResponse.json()) as {
    invoice: {
      invoiceNumber: string;
      status: string;
      totals: {
        grossTotalCents: number;
        netTotalCents: number;
        vatTotalCents: number;
      };
    };
  };
  expect(invoiceBody.invoice).toEqual(
    expect.objectContaining({
      invoiceNumber: approved.invoiceNumber,
      status: 'sent',
      totals: expect.objectContaining({
        grossTotalCents: 28_865,
        netTotalCents: 23_000,
        vatTotalCents: 5_865,
      }),
    }),
  );

  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT invoice_number, status, total_net_cents, total_vat_cents,
               total_gross_cents
        FROM invoices
        WHERE id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([
    {
      invoice_number: approved.invoiceNumber,
      status: 'sent',
      total_gross_cents: 28_865,
      total_net_cents: 23_000,
      total_vat_cents: 5_865,
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM invoice_documents WHERE invoice_id = ?',
      approved.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_delivery_events
        WHERE invoice_id = ? AND provider = 'smtp' AND status = 'succeeded'
      `,
      approved.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(DISTINCT invoice_number) AS invoice_numbers,
               COUNT(*) AS invoice_count
        FROM invoices
        WHERE source_draft_id = ?
      `,
      draft.id,
    ),
  ).toEqual([{ invoice_count: 1, invoice_numbers: 1 }]);

  await e2eWeb.page.getByRole('button', { name: 'Oma yritys' }).click();
  await e2eWeb.page.getByRole('button', { name: 'Tapahtumat' }).click();
  await expect(
    e2eWeb.page.getByText('Lasku toimitettu', { exact: true }),
  ).toBeVisible();
  await e2eWeb.page.getByRole('button', { name: 'Oma yritys' }).click();
  await e2eWeb.page.getByRole('button', { name: 'Diagnostiikka' }).click();
  await expect(
    e2eWeb.page
      .getByRole('main')
      .getByRole('heading', { level: 1, name: 'Diagnostiikka' }),
  ).toBeVisible();

  const logs = readE2eOperationalLogs(e2eWeb.paths.logsRoot);
  expect(logs).not.toContain(privateEmailBody);
  expect(logs).not.toContain('invoice-recipient@example.invalid');
});

test('INV-SNAPSHOT-001 @critical keeps approved invoice and PDF snapshots stable after master data changes', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const draft = await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E snapshot invoice',
  });
  const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  const pdfBefore = await readPdfHash(e2eWeb, approved.invoiceId);

  await updateCustomerMasterDataThroughUi(
    e2eWeb.page,
    customer.customerNumber,
  );
  await updateCompanyMasterDataThroughUi(e2eWeb.page);
  await openInvoicingWorkspace(e2eWeb.page);
  await openApprovedInvoiceFromList(e2eWeb.page, approved.invoiceNumber);

  await expect(
    e2eWeb.page.getByText('Synthetic Invoice Customer Oy', { exact: true }),
  ).toHaveCount(2);
  await expect(
    e2eWeb.page.getByText('Testikatu 1', { exact: true }),
  ).toHaveCount(2);
  await expect(
    e2eWeb.page.getByText('Synthetic Builder Oy', { exact: true }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByText('Synthetic Bank', { exact: true }),
  ).toBeVisible();

  const invoiceResponse = await e2eWeb.api.get(
    `/invoices/${approved.invoiceId}`,
  );
  expect(invoiceResponse.status()).toBe(200);
  await expect(invoiceResponse.json()).resolves.toEqual({
    invoice: expect.objectContaining({
      companyBankNameSnapshot: 'Synthetic Bank',
      companyNameSnapshot: 'Synthetic Builder Oy',
      customerNameSnapshot: 'Synthetic Invoice Customer Oy',
      customerStreetAddressSnapshot: 'Testikatu 1',
      sourceDraftId: draft.id,
    }),
  });
  expect(await readPdfHash(e2eWeb, approved.invoiceId)).toBe(pdfBefore);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT company_name_snapshot, company_bank_name_snapshot,
               customer_name_snapshot, customer_street_address_snapshot
        FROM invoices
        WHERE id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([
    {
      company_bank_name_snapshot: 'Synthetic Bank',
      company_name_snapshot: 'Synthetic Builder Oy',
      customer_name_snapshot: 'Synthetic Invoice Customer Oy',
      customer_street_address_snapshot: 'Testikatu 1',
    },
  ]);
});

test('INV-REVERSE-001 @critical approves reverse charge with zero VAT and an explicit performance period', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const draft = await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    lines: [
      {
        description: 'Synthetic reverse charge construction work',
        quantity: '1',
        unitPrice: '124',
      },
    ],
    performancePeriod: {
      type: 'dateRange',
      startDate: '2026-07-01',
      endDate: '2026-07-29',
    },
    subject: 'E2E reverse charge invoice',
    taxTreatment: 'reverseChargeConstruction',
  });

  expect(draft).toEqual({
    grossTotalCents: 12_400,
    id: expect.any(String),
    netTotalCents: 12_400,
    vatTotalCents: 0,
  });
  const approved = await approveCurrentInvoiceDraft(e2eWeb.page, {
    reverseCharge: true,
  });
  await createCurrentInvoicePdf(e2eWeb.page);

  const invoiceResponse = await e2eWeb.api.get(
    `/invoices/${approved.invoiceId}`,
  );
  expect(invoiceResponse.status()).toBe(200);
  await expect(invoiceResponse.json()).resolves.toEqual({
    invoice: expect.objectContaining({
      performancePeriod: {
        endDate: '2026-07-29',
        startDate: '2026-07-01',
        type: 'dateRange',
      },
      taxLegalBasisSnapshot: 'AVL 8 c §',
      taxTreatment: 'reverseChargeConstruction',
      taxTreatmentLabelSnapshot: 'Käännetty verovelvollisuus',
      totals: expect.objectContaining({
        grossTotalCents: 12_400,
        netTotalCents: 12_400,
        vatBreakdown: [],
        vatTotalCents: 0,
      }),
    }),
  });
  await expect(
    e2eWeb.page.getByText('Käännetty verovelvollisuus', { exact: true }),
  ).toBeVisible();
  await expect(e2eWeb.page.getByText('AVL 8 c §', { exact: true })).toBeVisible();
  await expect(
    e2eWeb.page.getByRole('heading', { name: 'ALV-erittely' }),
  ).toHaveCount(0);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_documents
        WHERE invoice_id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
});

test('INV-CANCEL-001 @critical cancels an undelivered invoice without deleting its PDF', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E cancellation invoice',
  });
  const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await cancelCurrentApprovedInvoice(e2eWeb.page, approved.invoiceNumber);

  await openApprovedInvoiceFromList(
    e2eWeb.page,
    approved.invoiceNumber,
  );
  await expect(
    e2eWeb.page.getByRole('button', { name: 'Valmistele sähköposti' }),
  ).toHaveCount(0);
  await expect(
    e2eWeb.page.getByRole('button', { name: 'Avaa PDF' }),
  ).toBeVisible();

  const invoiceResponse = await e2eWeb.api.get(
    `/invoices/${approved.invoiceId}`,
  );
  expect(invoiceResponse.status()).toBe(200);
  await expect(invoiceResponse.json()).resolves.toEqual({
    invoice: expect.objectContaining({
      cancellationReason: 'Synthetic E2E cancellation reason',
      status: 'cancelled',
    }),
  });
  const deliveryResponse = await e2eWeb.api.post(
    `/invoices/${approved.invoiceId}/email/smtp/prepare`,
    {
      data: {
        body: 'Synthetic blocked delivery',
        cc: '',
        subject: 'Synthetic blocked delivery',
        to: 'invoice-recipient@example.invalid',
      },
    },
  );
  expect(deliveryResponse.status()).toBe(404);
  const pdfResponse = await e2eWeb.api.get(
    `/invoices/${approved.invoiceId}/pdf`,
  );
  expect(pdfResponse.status()).toBe(200);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT status, cancellation_reason
        FROM invoices
        WHERE id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([
    {
      cancellation_reason: 'Synthetic E2E cancellation reason',
      status: 'cancelled',
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_delivery_events
        WHERE invoice_id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([{ count: 0 }]);
});

async function readPdfHash(
  e2eWeb: Parameters<typeof seedInvoiceJourneyPrerequisites>[0],
  invoiceId: string,
): Promise<string> {
  const response = await e2eWeb.api.get(`/invoices/${invoiceId}/pdf`);
  expect(response.status()).toBe(200);
  const bytes = await response.body();

  return createHash('sha256').update(bytes).digest('hex');
}

async function updateCustomerMasterDataThroughUi(
  page: Parameters<typeof createInvoiceDraftThroughUi>[0],
  customerNumber: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Asiakkaat' }).click();
  await page.getByLabel('Hae asiakasta').fill(customerNumber);
  await page
    .getByRole('button', { name: /Synthetic Invoice Customer Oy/ })
    .click();
  await page.getByRole('button', { name: 'Muokkaa' }).click();
  await page.getByLabel('Nimi *').fill('Changed Customer Oy');
  await page.getByLabel('Katuosoite').fill('Changed Street 99');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/customers\/[^/]+$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Tallenna muutokset' }).click();
  expect((await responsePromise).status()).toBe(200);
}

async function updateCompanyMasterDataThroughUi(
  page: Parameters<typeof createInvoiceDraftThroughUi>[0],
): Promise<void> {
  await page.getByRole('button', { name: 'Oma yritys' }).click();
  await page.getByLabel('Yrityksen nimi').fill('Changed Builder Oy');
  await page.getByLabel('Pankin nimi').fill('Changed Bank');
  await page.getByLabel('Katuosoite').fill('Changed Company Street 5');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === '/company-settings',
  );
  await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
}
