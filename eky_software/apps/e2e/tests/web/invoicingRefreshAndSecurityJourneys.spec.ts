import { readE2eOperationalLogs } from '../../src/assertions/readE2eOperationalLogs.js';
import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { securityPayloadCorpus } from '../../src/data/securityPayloadCorpus.js';
import {
  approveCurrentInvoiceDraft,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  openApprovedInvoiceFromList,
  openInvoiceDraftFromList,
  openInvoicingWorkspace,
  seedInvoiceJourneyPrerequisites,
  sendCurrentInvoiceThroughFakeSmtp,
} from '../../src/journeys/invoicingWebJourney.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedWebTest.js';

test('INV-REFRESH-001 reopens persisted draft, approved and sent states after refresh', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const subject = 'E2E refresh invoice';
  const draft = await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject,
  });

  await e2eWeb.page.reload();
  await openInvoicingWorkspace(e2eWeb.page);
  await openInvoiceDraftFromList(e2eWeb.page, subject);
  await expect(e2eWeb.page.getByLabel('Aihe')).toHaveValue(subject);

  const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
  await e2eWeb.page.reload();
  await openInvoicingWorkspace(e2eWeb.page);
  await openApprovedInvoiceFromList(
    e2eWeb.page,
    approved.invoiceNumber,
  );
  await expect(
    e2eWeb.page
      .locator('span.status-pill')
      .filter({ hasText: /^Hyväksytty$/ }),
  ).toBeVisible();

  await createCurrentInvoicePdf(e2eWeb.page);
  await sendCurrentInvoiceThroughFakeSmtp(e2eWeb.page);
  await e2eWeb.page.reload();
  await openInvoicingWorkspace(e2eWeb.page);
  await openApprovedInvoiceFromList(
    e2eWeb.page,
    approved.invoiceNumber,
  );
  await expect(
    e2eWeb.page.getByText('Lähetetty', { exact: true }),
  ).toBeVisible();
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT invoices.status, invoice_drafts.id AS draft_id
        FROM invoices
        JOIN invoice_drafts
          ON invoice_drafts.id = invoices.source_draft_id
        WHERE invoices.id = ?
      `,
      approved.invoiceId,
    ),
  ).toEqual([{ draft_id: draft.id, status: 'sent' }]);
});

test('SEC-XSS-001 @security renders hostile customer and invoice text without execution or external access', async ({
  e2eWeb,
}) => {
  const hostileCustomerName = `${securityPayloadCorpus.htmlText} Synthetic Oy`;
  const hostileAddress = `${securityPayloadCorpus.svgText} Testikatu 7`;
  const hostileSubject =
    '<img src="https://outside.invalid/subject" onerror="globalThis.__ekyInjected=true">';
  const hostileNote = `${securityPayloadCorpus.svgText} Synthetic note`;
  const hostileDescription =
    '<script>globalThis.open("https://outside.invalid/popup")</script>';
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb, {
    customerInput: {
      name: hostileCustomerName,
      streetAddress: hostileAddress,
    },
  });
  await e2eWeb.page.evaluate(() => {
    (
      globalThis as typeof globalThis & { __ekyInjected?: boolean }
    ).__ekyInjected = false;
  });
  let popupCount = 0;
  e2eWeb.page.on('popup', () => {
    popupCount += 1;
  });

  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    lines: [
      {
        description: hostileDescription,
        quantity: '1',
        unitPrice: '10',
      },
    ],
    note: hostileNote,
    subject: hostileSubject,
  });
  const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);

  await expect(
    e2eWeb.page.getByText(hostileCustomerName, { exact: true }),
  ).toHaveCount(2);
  await expect(
    e2eWeb.page.getByText(hostileAddress, { exact: true }),
  ).toHaveCount(2);
  await expect(
    e2eWeb.page.getByText(hostileSubject, { exact: true }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByText(hostileNote, { exact: true }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByText(hostileDescription, { exact: true }),
  ).toBeVisible();
  expect(
    await e2eWeb.page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __ekyInjected?: boolean;
          }
        ).__ekyInjected,
    ),
  ).toBe(false);
  expect(popupCount).toBe(0);

  const pdfResponse = await e2eWeb.api.get(
    `/invoices/${approved.invoiceId}/pdf`,
  );
  expect(pdfResponse.status()).toBe(200);
  expect((await pdfResponse.body()).subarray(0, 5).toString('ascii')).toBe(
    '%PDF-',
  );

  const logs = readE2eOperationalLogs(e2eWeb.paths.logsRoot);
  for (const privateValue of [
    hostileCustomerName,
    hostileAddress,
    hostileSubject,
    hostileNote,
    hostileDescription,
  ]) {
    expect(logs).not.toContain(privateValue);
  }
});
