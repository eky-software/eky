import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import {
  createCreditDraftFromCurrentInvoice,
  approveCurrentCreditDraft,
  setPartialSourceCredit,
} from '../../src/journeys/invoicingCreditJourney.js';
import {
  markCurrentInvoicePaidThroughUi,
  revertCurrentInvoicePaidMarkThroughUi,
} from '../../src/journeys/invoicePaymentJourney.js';
import {
  approveCurrentInvoiceDraft,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  seedInvoiceJourneyPrerequisites,
  sendCurrentInvoiceThroughFakeSmtp,
} from '../../src/journeys/invoicingWebJourney.js';
import {
  expect,
  test,
  type IsolatedWebHarness,
} from '../../src/fixtures/isolatedWebTest.js';

const paidOn = '2026-07-30';

test('INV-PAYMENT-001 @critical marks a sent standard invoice paid with backend-owned amount and safe activity', async ({
  e2eWeb,
}) => {
  const approved = await createSentInvoice(
    e2eWeb,
    'E2E manual payment',
  );
  const invoiceBefore = await readApprovedInvoice(
    e2eWeb,
    approved.invoiceId,
  );

  const payment = await markCurrentInvoicePaidThroughUi(
    e2eWeb.page,
    paidOn,
  );

  expect(payment).toEqual({
    invoiceId: approved.invoiceId,
    invoiceNumber: approved.invoiceNumber,
    paidAmountCents: invoiceBefore.totals.grossTotalCents,
    paidOn,
    paymentSource: 'manual',
    paymentState: 'paid',
  });
  await expect(
    e2eWeb.page
      .getByRole('region', { name: 'Maksutila' })
      .getByText('Maksettu', { exact: true }),
  ).toBeVisible();
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT status, payment_state, paid_on, paid_amount_cents,
               payment_source
        FROM invoices
        WHERE id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([
    {
      paid_amount_cents: invoiceBefore.totals.grossTotalCents,
      paid_on: paidOn,
      payment_source: 'manual',
      payment_state: 'paid',
      status: 'sent',
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT action, paid_on, amount_cents
        FROM invoice_payment_events
        WHERE invoice_id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([
    {
      action: 'paymentMarkedPaid',
      amount_cents: invoiceBefore.totals.grossTotalCents,
      paid_on: paidOn,
    },
  ]);

  const activityResponse = await e2eWeb.api.get(
    '/activity?category=invoicing&pageSize=100',
  );
  expect(activityResponse.status()).toBe(200);
  const activityText = JSON.stringify(await activityResponse.json());
  expect(activityText).toContain('invoice.paymentMarkedPaid');
  expect(activityText).toContain(approved.invoiceNumber);
  expect(activityText).not.toContain(
    String(invoiceBefore.totals.grossTotalCents),
  );
  expect(activityText).not.toContain('local-owner');
});

test('INV-PAYMENT-002 @critical reverts the current payment projection without deleting history', async ({
  e2eWeb,
}) => {
  const approved = await createSentInvoice(
    e2eWeb,
    'E2E payment revert',
  );
  await markCurrentInvoicePaidThroughUi(e2eWeb.page, paidOn);

  const payment = await revertCurrentInvoicePaidMarkThroughUi(e2eWeb.page);

  expect(payment).toEqual({
    invoiceId: approved.invoiceId,
    invoiceNumber: approved.invoiceNumber,
    paidAmountCents: null,
    paidOn: null,
    paymentSource: null,
    paymentState: 'unpaid',
  });
  await expect(
    e2eWeb.page
      .getByRole('region', { name: 'Maksutila' })
      .getByText('Avoin', { exact: true }),
  ).toBeVisible();
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT payment_state, paid_on, paid_amount_cents, payment_source
        FROM invoices
        WHERE id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([
    {
      paid_amount_cents: null,
      paid_on: null,
      payment_source: null,
      payment_state: 'unpaid',
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
      approved.invoiceId,
    ),
  ).toEqual([
    {
      action: 'paymentMarkedPaid',
      amount_cents: expect.any(Number),
      paid_on: paidOn,
    },
    {
      action: 'paymentMarkReverted',
      amount_cents: expect.any(Number),
      paid_on: paidOn,
    },
  ]);
});

test('INV-PAYMENT-004 @cross-module uses the remaining amount after a partial credit and shows the paid marker only under credited invoices', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E partially credited payment',
  });
  const sourceInvoice = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page);
  await createCreditDraftFromCurrentInvoice(e2eWeb.page);
  await setPartialSourceCredit(e2eWeb.page, {
    creditedQuantity: '1',
    excludedLinePositions: [2],
  });
  await approveCurrentCreditDraft(e2eWeb.page);

  await e2eWeb.page
    .getByRole('button', {
      name: `Avaa alkuperäinen lasku ${sourceInvoice.invoiceNumber}`,
    })
    .click();
  const creditContextResponse = await e2eWeb.api.get(
    `/invoices/${sourceInvoice.invoiceId}/credit-context`,
  );
  expect(creditContextResponse.status()).toBe(200);
  const creditContext = (await creditContextResponse.json()) as {
    creditContext: { remainingCreditableGrossCents: number };
  };

  const payment = await markCurrentInvoicePaidThroughUi(
    e2eWeb.page,
    paidOn,
  );
  expect(payment.paidAmountCents).toBe(
    creditContext.creditContext.remainingCreditableGrossCents,
  );

  await e2eWeb.page.getByRole('button', { name: 'Asiakkaat' }).click();
  await e2eWeb.page
    .getByRole('button', {
      name: new RegExp(
        `${escapeRegExp(customer.customerNumber)}.*${escapeRegExp(customer.customerName)}`,
      ),
    })
    .click();
  const creditedSection = e2eWeb.page.getByRole('region', {
    name: 'Hyvitetyt ja osittain hyvitetyt',
  });
  await expect(
    creditedSection.getByText(sourceInvoice.invoiceNumber, { exact: true }),
  ).toBeVisible();
  const creditedInvoiceRow = creditedSection.getByRole('row', {
    name: new RegExp(escapeRegExp(sourceInvoice.invoiceNumber)),
  });
  const creditedInvoiceStatus = creditedInvoiceRow.getByRole('cell').nth(4);
  await expect(creditedInvoiceStatus).toContainText(
    'Osittain hyvitetty · Maksettu',
  );
  await expect(creditedInvoiceStatus).toContainText('Maksupäivä 30.07.2026');
  await expect(
    e2eWeb.page.getByRole('heading', { level: 3, name: 'Maksetut' }),
  ).toHaveCount(0);
});

test('INV-PAYMENT-005 @critical keeps duplicate concurrent mark-paid requests idempotent', async ({
  e2eWeb,
}) => {
  const approved = await createSentInvoice(
    e2eWeb,
    'E2E duplicate payment',
  );

  const responses = await Promise.all([
    markInvoicePaid(e2eWeb, approved.invoiceId, paidOn),
    markInvoicePaid(e2eWeb, approved.invoiceId, paidOn),
  ]);

  expect(responses.map((response) => response.status())).toEqual([200, 200]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT payment_state
        FROM invoices
        WHERE id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([{ payment_state: 'paid' }]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_payment_events
        WHERE invoice_id = ? AND action = 'paymentMarkedPaid'
      `,
      approved.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
});

async function createSentInvoice(
  e2eWeb: IsolatedWebHarness,
  subject: string,
) {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject,
  });
  const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page);

  return approved;
}

async function readApprovedInvoice(
  e2eWeb: IsolatedWebHarness,
  invoiceId: string,
): Promise<{ totals: { grossTotalCents: number } }> {
  const response = await e2eWeb.api.get(`/invoices/${invoiceId}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    invoice: { totals: { grossTotalCents: number } };
  };

  return body.invoice;
}

function markInvoicePaid(
  e2eWeb: IsolatedWebHarness,
  invoiceId: string,
  date: string,
) {
  return e2eWeb.api.put(`/invoices/${invoiceId}/payment`, {
    data: { paidOn: date },
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
