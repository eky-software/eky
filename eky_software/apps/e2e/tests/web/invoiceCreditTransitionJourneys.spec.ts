import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import {
  approveCurrentCreditDraft,
  createCreditDraftFromCurrentInvoice,
  setPartialSourceCredit,
} from '../../src/journeys/invoicingCreditJourney.js';
import { markCurrentInvoicePaidThroughUi } from '../../src/journeys/invoicePaymentJourney.js';
import {
  approveCurrentInvoiceDraft,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  seedInvoiceJourneyPrerequisites,
  sendCurrentInvoiceThroughFakeSmtp,
  type ApprovedInvoiceIdentity,
} from '../../src/journeys/invoicingWebJourney.js';
import {
  expect,
  test,
  type IsolatedWebHarness,
} from '../../src/fixtures/isolatedWebTest.js';

test('INV-MULTICREDIT-001 @critical reaches full credit through two bounded credit invoices and blocks a third', async ({
  e2eWeb,
}) => {
  const sourceInvoice = await createSentStandardInvoice(
    e2eWeb,
    'E2E multiple credit invoice',
  );

  await createCreditDraftFromCurrentInvoice(e2eWeb.page);
  await setPartialSourceCredit(e2eWeb.page, {
    creditedQuantity: '1',
    excludedLinePositions: [2],
  });
  const firstCredit = await approveCurrentCreditDraft(e2eWeb.page);
  await openSourceInvoiceFromCredit(e2eWeb, sourceInvoice);

  await createCreditDraftFromCurrentInvoice(e2eWeb.page);
  const secondCredit = await approveCurrentCreditDraft(e2eWeb.page);
  await openSourceInvoiceFromCredit(e2eWeb, sourceInvoice);

  await expect(
    e2eWeb.page.getByText('Hyvitetty kokonaan', { exact: true }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByRole('button', { name: 'Hyvitä lasku' }),
  ).toHaveCount(0);

  const contextResponse = await e2eWeb.api.get(
    `/invoices/${sourceInvoice.invoiceId}/credit-context`,
  );
  expect(contextResponse.status()).toBe(200);
  const contextBody = await contextResponse.json();
  expect(contextBody).toEqual({
    creditContext: expect.objectContaining({
      activeCreditDraftId: null,
      creditInvoices: expect.arrayContaining([
        expect.objectContaining({ id: firstCredit.invoiceId }),
        expect.objectContaining({ id: secondCredit.invoiceId }),
      ]),
      creditStatus: 'full',
      remainingCreditableGrossCents: 0,
      sourceInvoiceId: sourceInvoice.invoiceId,
    }),
  });
  expect(contextBody.creditContext.creditInvoices).toHaveLength(2);

  const thirdCreditResponse = await e2eWeb.api.post(
    `/invoices/${sourceInvoice.invoiceId}/credit-draft`,
  );
  expect(thirdCreditResponse.status()).toBe(409);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoices
        WHERE credited_invoice_id = ?
      `,
      sourceInvoice.invoiceId,
    ),
  ).toEqual([{ count: 2 }]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_drafts
        WHERE credited_invoice_id = ?
          AND status = 'draft'
          AND approved_invoice_id IS NULL
      `,
      sourceInvoice.invoiceId,
    ),
  ).toEqual([{ count: 0 }]);

  await e2eWeb.page
    .getByRole('button', { name: 'Takaisin luonnoksiin' })
    .click();
  const creditedInvoices = e2eWeb.page.getByRole('table', {
    name: 'Hyvitetyt laskut',
  });
  await expect(
    creditedInvoices.getByRole('button', {
      name: `Laskunumero ${sourceInvoice.invoiceNumber}`,
    }),
  ).toBeVisible();

  const approvedInvoices = e2eWeb.page.getByRole('table', {
    name: 'Hyväksytyt laskut',
  });
  await expect(
    approvedInvoices.getByRole('button', {
      name: `Hyvityslasku ${firstCredit.invoiceNumber}`,
    }),
  ).toBeVisible();
  await expect(
    approvedInvoices.getByRole('button', {
      name: `Hyvityslasku ${secondCredit.invoiceNumber}`,
    }),
  ).toBeVisible();
});

test('INV-PAYMENT-CREDIT-001 @critical preserves payment history while a paid invoice becomes fully credited', async ({
  e2eWeb,
}) => {
  const sourceInvoice = await createSentStandardInvoice(
    e2eWeb,
    'E2E paid then credited invoice',
  );
  const payment = await markCurrentInvoicePaidThroughUi(
    e2eWeb.page,
    '2026-07-30',
  );

  await createCreditDraftFromCurrentInvoice(e2eWeb.page);
  await setPartialSourceCredit(e2eWeb.page, {
    creditedQuantity: '1',
    excludedLinePositions: [2],
  });
  await approveCurrentCreditDraft(e2eWeb.page);
  await openSourceInvoiceFromCredit(e2eWeb, sourceInvoice);
  await createCreditDraftFromCurrentInvoice(e2eWeb.page);
  await approveCurrentCreditDraft(e2eWeb.page);
  await openSourceInvoiceFromCredit(e2eWeb, sourceInvoice);

  await expect(
    e2eWeb.page.getByText('Hyvitetty kokonaan', { exact: true }),
  ).toBeVisible();
  await expect(
    e2eWeb.page
      .getByRole('region', { name: 'Maksutila' })
      .getByText('Maksettu', { exact: true }),
  ).toBeVisible();
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT payment_state, paid_on, paid_amount_cents, payment_source
        FROM invoices
        WHERE id = ?
      `,
      sourceInvoice.invoiceId,
    ),
  ).toEqual([
    {
      paid_amount_cents: payment.paidAmountCents,
      paid_on: '2026-07-30',
      payment_source: 'manual',
      payment_state: 'paid',
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT action, paid_on, amount_cents
        FROM invoice_payment_events
        WHERE invoice_id = ?
        ORDER BY occurred_at, rowid
      `,
      sourceInvoice.invoiceId,
    ),
  ).toEqual([
    {
      action: 'paymentMarkedPaid',
      amount_cents: payment.paidAmountCents,
      paid_on: '2026-07-30',
    },
  ]);
});

test('INV-REVERSE-CREDIT-001 @critical preserves reverse-charge treatment from delivery through credit PDF', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    lines: [
      {
        description: 'Synthetic reverse charge credit work',
        quantity: '1',
        unitPrice: '124',
      },
    ],
    performancePeriod: {
      type: 'singleDate',
      date: '2026-07-29',
    },
    subject: 'E2E reverse charge credit invoice',
    taxTreatment: 'reverseChargeConstruction',
  });
  const sourceInvoice = await approveCurrentInvoiceDraft(e2eWeb.page, {
    reverseCharge: true,
  });
  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page);

  await createCreditDraftFromCurrentInvoice(e2eWeb.page);
  const creditInvoice = await approveCurrentCreditDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);

  const creditResponse = await e2eWeb.api.get(
    `/invoices/${creditInvoice.invoiceId}`,
  );
  expect(creditResponse.status()).toBe(200);
  await expect(creditResponse.json()).resolves.toEqual({
    invoice: expect.objectContaining({
      creditedInvoiceId: sourceInvoice.invoiceId,
      invoiceKind: 'credit',
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
  await expect(
    e2eWeb.page.getByRole('heading', { name: 'ALV-erittely' }),
  ).toHaveCount(0);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM invoice_documents WHERE invoice_id = ?',
      creditInvoice.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
});

async function createSentStandardInvoice(
  e2eWeb: IsolatedWebHarness,
  subject: string,
): Promise<ApprovedInvoiceIdentity> {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject,
  });
  const invoice = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page);

  return invoice;
}

async function openSourceInvoiceFromCredit(
  e2eWeb: IsolatedWebHarness,
  sourceInvoice: ApprovedInvoiceIdentity,
): Promise<void> {
  await e2eWeb.page
    .getByRole('button', {
      name: `Avaa alkuperäinen lasku ${sourceInvoice.invoiceNumber}`,
    })
    .click();
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: `Lasku ${sourceInvoice.invoiceNumber}`,
    }),
  ).toBeVisible();
}
