import { createHash } from 'node:crypto';

import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import {
  approveCurrentInvoiceDraft,
  copyCurrentInvoiceToDraft,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  markCurrentInvoiceSentManually,
  openApprovedInvoiceFromList,
  openInvoicingWorkspace,
  reopenCurrentInvoiceForEditing,
  seedInvoiceJourneyPrerequisites,
  sendCurrentInvoiceThroughFakeSmtp,
} from '../../src/journeys/invoicingWebJourney.js';
import {
  expect,
  test,
  type IsolatedWebHarness,
} from '../../src/fixtures/isolatedWebTest.js';

test('INV-REAPPROVAL-001 @critical reapproves a changed invoice with the original identity and refreshed snapshot', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const draft = await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E reapproval invoice',
  });
  const firstApproval = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  const firstPdfHash = await readPdfHash(e2eWeb, firstApproval.invoiceId);

  const reopenedDraftId = await reopenCurrentInvoiceForEditing(e2eWeb.page);
  expect(reopenedDraftId).toBe(draft.id);
  const updateResponsePromise = e2eWeb.page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname ===
        `/invoice-drafts/${reopenedDraftId}`,
  );
  await e2eWeb.page
    .getByRole('group', { name: 'Rivi 1' })
    .getByLabel('Yksikköhinta')
    .fill('125');
  expect((await updateResponsePromise).status()).toBe(200);

  const secondApproval = await approveCurrentInvoiceDraft(e2eWeb.page);
  expect(secondApproval).toEqual(firstApproval);
  await createCurrentInvoicePdf(e2eWeb.page);
  const secondPdfHash = await readPdfHash(e2eWeb, firstApproval.invoiceId);
  expect(secondPdfHash).not.toBe(firstPdfHash);

  const invoiceResponse = await e2eWeb.api.get(
    `/invoices/${firstApproval.invoiceId}`,
  );
  expect(invoiceResponse.status()).toBe(200);
  await expect(invoiceResponse.json()).resolves.toEqual({
    invoice: expect.objectContaining({
      id: firstApproval.invoiceId,
      invoiceNumber: firstApproval.invoiceNumber,
      lines: [
        expect.objectContaining({
          description: 'Synthetic installation work',
          unitPriceCents: 12_500,
        }),
        expect.objectContaining({
          description: 'Synthetic materials',
          unitPriceCents: 2_000,
        }),
      ],
      status: 'approved',
    }),
  });
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT action
        FROM invoice_audit_events
        WHERE invoice_id = ?
        ORDER BY created_at, rowid
      `,
      firstApproval.invoiceId,
    ),
  ).toEqual([
    { action: 'invoice.approved' },
    { action: 'invoice.reopened_for_edit' },
    { action: 'invoice.reapproved' },
  ]);
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
});

test('INV-COPY-001 @critical copies a sent invoice into a distinct draft and approval identity', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const sourceDraft = await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E copy source invoice',
  });
  const sourceInvoice = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page);
  const sourcePdfHash = await readPdfHash(e2eWeb, sourceInvoice.invoiceId);

  const copiedDraft = await copyCurrentInvoiceToDraft(e2eWeb.page);
  expect(copiedDraft.draftId).not.toBe(sourceDraft.id);
  const copiedInvoice = await approveCurrentInvoiceDraft(e2eWeb.page);
  expect(copiedInvoice.invoiceId).not.toBe(sourceInvoice.invoiceId);
  expect(copiedInvoice.invoiceNumber).not.toBe(sourceInvoice.invoiceNumber);

  expect(await readPdfHash(e2eWeb, sourceInvoice.invoiceId)).toBe(
    sourcePdfHash,
  );
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT id, invoice_number, source_draft_id, status
        FROM invoices
        ORDER BY sequence_number
      `,
    ),
  ).toEqual([
    {
      id: sourceInvoice.invoiceId,
      invoice_number: sourceInvoice.invoiceNumber,
      source_draft_id: sourceDraft.id,
      status: 'sent',
    },
    {
      id: copiedInvoice.invoiceId,
      invoice_number: copiedInvoice.invoiceNumber,
      source_draft_id: copiedDraft.draftId,
      status: 'approved',
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_delivery_events
        WHERE invoice_id = ? AND status = 'succeeded'
      `,
      sourceInvoice.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM invoice_documents WHERE invoice_id = ?',
      sourceInvoice.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
});

test('INV-MANUAL-DELIVERY-001 @critical finalizes one manual delivery and survives refresh', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E manual delivery invoice',
  });
  const invoice = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await markCurrentInvoiceSentManually(e2eWeb.page);

  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT delivery_method, provider, status
        FROM invoice_delivery_events
        WHERE invoice_id = ?
      `,
      invoice.invoiceId,
    ),
  ).toEqual([
    {
      delivery_method: 'manual',
      provider: 'manual',
      status: 'succeeded',
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT action
        FROM invoice_audit_events
        WHERE invoice_id = ?
        ORDER BY created_at, rowid
      `,
      invoice.invoiceId,
    ),
  ).toEqual([
    { action: 'invoice.approved' },
    { action: 'invoice.marked_sent_manually' },
  ]);

  await e2eWeb.page.reload();
  await openInvoicingWorkspace(e2eWeb.page);
  await openApprovedInvoiceFromList(e2eWeb.page, invoice.invoiceNumber);
  await expect(e2eWeb.page.getByText('Lähetetty', { exact: true })).toBeVisible();
  await expect(e2eWeb.page.getByText('Käsin', { exact: true })).toBeVisible();
});

test('INV-RESEND-001 @critical resends the same invoice and current PDF as a new delivery event', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const sourceDraft = await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E resend invoice',
  });
  const invoice = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  await markCurrentInvoiceSentManually(e2eWeb.page);
  const pdfHashBeforeResend = await readPdfHash(
    e2eWeb,
    invoice.invoiceId,
  );

  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page, { resend: true });

  expect(await readPdfHash(e2eWeb, invoice.invoiceId)).toBe(
    pdfHashBeforeResend,
  );
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT delivery_method, provider, status
        FROM invoice_delivery_events
        WHERE invoice_id = ?
        ORDER BY created_at, rowid
      `,
      invoice.invoiceId,
    ),
  ).toEqual([
    {
      delivery_method: 'manual',
      provider: 'manual',
      status: 'succeeded',
    },
    {
      delivery_method: 'email',
      provider: 'smtp',
      status: 'succeeded',
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT invoice_number, status
        FROM invoices
        WHERE source_draft_id = ?
      `,
      sourceDraft.id,
    ),
  ).toEqual([
    {
      invoice_number: invoice.invoiceNumber,
      status: 'sent',
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM invoice_documents WHERE invoice_id = ?',
      invoice.invoiceId,
    ),
  ).toEqual([{ count: 1 }]);
});

async function readPdfHash(
  e2eWeb: IsolatedWebHarness,
  invoiceId: string,
): Promise<string> {
  const response = await e2eWeb.api.get(`/invoices/${invoiceId}/pdf`);
  expect(response.status()).toBe(200);

  return createHash('sha256')
    .update(await response.body())
    .digest('hex');
}
