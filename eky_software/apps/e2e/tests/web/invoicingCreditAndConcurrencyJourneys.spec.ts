import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import {
  approveCurrentCreditDraft,
  createCreditDraftFromCurrentInvoice,
  setPartialSourceCredit,
} from '../../src/journeys/invoicingCreditJourney.js';
import {
  approveCurrentInvoiceDraft,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  openApprovedInvoiceFromList,
  openInvoicingWorkspace,
  seedInvoiceJourneyPrerequisites,
  sendCurrentInvoiceThroughFakeSmtp,
} from '../../src/journeys/invoicingWebJourney.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedWebTest.js';

test('INV-CREDIT-001 @critical creates a bounded partial credit and groups it with the source invoice', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E partially credited invoice',
  });
  const sourceInvoice = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page);

  const firstCreditDraftId =
    await createCreditDraftFromCurrentInvoice(e2eWeb.page);
  await setPartialSourceCredit(e2eWeb.page, {
    creditedQuantity: '1',
    excludedLinePositions: [2],
  });
  const creditInvoice = await approveCurrentCreditDraft(e2eWeb.page);
  expect(creditInvoice.draftId).toBe(firstCreditDraftId);
  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page);
  await expect(
    e2eWeb.page.getByRole('button', {
      name: `Avaa alkuperäinen lasku ${sourceInvoice.invoiceNumber}`,
    }),
  ).toBeVisible();

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
  await expect(
    e2eWeb.page.getByText('Osittain hyvitetty', { exact: true }),
  ).toBeVisible();
  await expect(
    e2eWeb.page
      .getByText('Hyvitettävissä jäljellä', { exact: true })
      .locator('..')
      .getByText('163,15 €', { exact: true }),
  ).toBeVisible();

  const contextResponse = await e2eWeb.api.get(
    `/invoices/${sourceInvoice.invoiceId}/credit-context`,
  );
  expect(contextResponse.status()).toBe(200);
  await expect(contextResponse.json()).resolves.toEqual({
    creditContext: expect.objectContaining({
      activeCreditDraftId: null,
      creditInvoices: [
        expect.objectContaining({
          id: creditInvoice.invoiceId,
          invoiceKind: 'credit',
          status: 'sent',
        }),
      ],
      creditStatus: 'partial',
      remainingCreditableGrossCents: 16_315,
      sourceInvoiceId: sourceInvoice.invoiceId,
    }),
  });
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT invoice_kind, credited_invoice_id, status,
               total_gross_cents
        FROM invoices
        WHERE id = ?
      `,
      creditInvoice.invoiceId,
    ),
  ).toEqual([
    {
      credited_invoice_id: sourceInvoice.invoiceId,
      invoice_kind: 'credit',
      status: 'sent',
      total_gross_cents: 12_550,
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_documents
        WHERE invoice_id = ?
      `,
      creditInvoice.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);

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
  await expect(
    creditedInvoices.getByRole('button', {
      name: `Hyvityslasku ${creditInvoice.invoiceNumber}`,
    }),
  ).toBeVisible();

  await creditedInvoices
    .getByRole('button', {
      name: `Laskunumero ${sourceInvoice.invoiceNumber}`,
    })
    .click();
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: `Lasku ${sourceInvoice.invoiceNumber}`,
    }),
  ).toBeVisible();
  await createCreditDraftFromCurrentInvoice(e2eWeb.page);
  await e2eWeb.page
    .getByRole('group', { name: 'Rivi 1' })
    .getByLabel('Hyvitettävä määrä')
    .fill('2');
  await e2eWeb.page
    .getByRole('button', { name: 'Hyväksy hyvityslasku', exact: true })
    .click();
  await expect(
    e2eWeb.page.getByText(
      'Tarkista hyvitysrivit, määrät, hinnat, ALV-kannat ja mahdollinen palautustili.',
    ),
  ).toBeVisible();
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM invoices',
    ),
  ).toEqual([{ count: 2 }]);
});

test('INV-DOUBLECLICK-001 @critical keeps approval and delivery single under rapid double clicks', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const draft = await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E double click invoice',
  });
  const approved = await approveCurrentInvoiceDraft(e2eWeb.page, {
    clickCount: 2,
  });
  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page, {
    clickCount: 2,
  });

  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS invoice_count,
               COUNT(DISTINCT invoice_number) AS invoice_numbers
        FROM invoices
        WHERE source_draft_id = ?
      `,
      draft.id,
    ),
  ).toEqual([{ invoice_count: 1, invoice_numbers: 1 }]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT last_sequence_number
        FROM invoice_number_sequences
      `,
    ),
  ).toEqual([{ last_sequence_number: 1 }]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_delivery_events
        WHERE invoice_id = ? AND status = 'succeeded'
      `,
      approved.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      'SELECT status FROM invoices WHERE id = ?',
      approved.invoiceId,
    ),
  ).toEqual([{ status: 'sent' }]);

  await e2eWeb.page.reload();
  await openInvoicingWorkspace(e2eWeb.page);
  await openApprovedInvoiceFromList(
    e2eWeb.page,
    approved.invoiceNumber,
  );
  await expect(
    e2eWeb.page.getByText('Lähetetty', { exact: true }),
  ).toBeVisible();
});
