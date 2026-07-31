import type { APIResponse, Page, Response } from '@playwright/test';

import { readE2eOperationalLogs } from '../../src/assertions/readE2eOperationalLogs.js';
import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { releaseE2eDatabaseFault } from '../../src/environment/releaseE2eDatabaseFault.js';
import type { IsolatedWebHarness } from '../../src/fixtures/isolatedWebTest.js';
import {
  approveCurrentInvoiceDraft,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  seedInvoiceJourneyPrerequisites,
} from '../../src/journeys/invoicingWebJourney.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedWebTest.js';

const smtpSecret = 'synthetic-e2e-secret';
const privateEmailBody = 'Synthetic private fault email body';
const privateRecipient = 'invoice-recipient@example.invalid';

test.describe('PDF storage fault', () => {
  test.use({ e2eFaultPlan: { kind: 'pdfStorageWriteFailed' } });

  test('INV-PDF-FAIL-001 @critical @fault preserves approval without partial PDF metadata', async ({
    e2eWeb,
  }) => {
    const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
    await createInvoiceDraftThroughUi(e2eWeb.page, {
      customerId: customer.customerId,
      subject: 'E2E PDF storage failure',
    });
    const approved = await approveCurrentInvoiceDraft(e2eWeb.page);

    expect(
      readE2eSqliteRows(
        e2eWeb.paths.databaseFilePath,
        'SELECT status FROM invoices WHERE id = ?',
        approved.invoiceId,
      ),
    ).toEqual([{ status: 'approved' }]);
    expect(
      readE2eSqliteRows(
        e2eWeb.paths.databaseFilePath,
        'SELECT COUNT(*) AS count FROM invoice_documents WHERE invoice_id = ?',
        approved.invoiceId,
      ),
    ).toEqual([{ count: 0 }]);

    const pdfResponsePromise = waitForResponse(
      e2eWeb.page,
      'POST',
      /\/invoices\/[^/]+\/pdf$/,
    );
    await e2eWeb.page.getByRole('button', { name: 'Luo PDF' }).click();
    expect((await pdfResponsePromise).status()).toBe(500);
    await expect(
      e2eWeb.page
        .getByRole('alert')
        .getByText('Palvelimen vastaus oli virheellinen.'),
    ).toBeVisible();

    await expectSafeDiagnosticEvidence(e2eWeb, [
      'invoicePdf.generationFailed',
    ]);
    await expectInvoicingActivity(e2eWeb, 'invoice.approved');
    expectNoPrivateOperationalData(e2eWeb);

    const invoiceResponse = await e2eWeb.api.get(
      `/invoices/${approved.invoiceId}`,
    );
    expect(invoiceResponse.status()).toBe(200);
  });
});

for (const smtpScenario of [
  {
    expectedEvent: 'smtp.authenticationFailed',
    expectedStatus: 'failed',
    id: 'INV-SMTP-AUTH-001',
    outcome: 'authenticationFailed',
  },
  {
    expectedEvent: 'smtp.tlsFailed',
    expectedStatus: 'failed',
    id: 'INV-SMTP-TLS-001',
    outcome: 'tlsFailed',
  },
  {
    expectedEvent: 'smtp.deliveryFailed',
    expectedStatus: 'failed',
    id: 'INV-SMTP-REJECT-001',
    outcome: 'deliveryFailed',
  },
  {
    expectedEvent: 'smtp.deliveryOutcomeUnknown',
    expectedStatus: 'outcomeUnknown',
    id: 'INV-SMTP-UNKNOWN-001',
    outcome: 'outcomeUnknown',
  },
] as const) {
  test.describe(`${smtpScenario.id} SMTP fault`, () => {
    test.use({
      e2eFaultPlan: {
        kind: 'smtp',
        outcome: smtpScenario.outcome,
      },
    });

    test(`${smtpScenario.id} @critical @fault records a bounded delivery outcome without marking the invoice sent`, async ({
      e2eWeb,
    }) => {
      const approved = await createApprovedInvoiceWithPdf(
        e2eWeb,
        `E2E ${smtpScenario.id}`,
      );
      const sendResponse = await sendCurrentInvoiceExpectingFailure(
        e2eWeb.page,
        smtpScenario.expectedStatus === 'outcomeUnknown',
      );
      expect(sendResponse.status()).toBe(502);

      expect(
        readE2eSqliteRows(
          e2eWeb.paths.databaseFilePath,
          'SELECT status FROM invoices WHERE id = ?',
          approved.invoiceId,
        ),
      ).toEqual([{ status: 'approved' }]);
      expect(
        readE2eSqliteRows(
          e2eWeb.paths.databaseFilePath,
          `
            SELECT status, technical_error_code
            FROM invoice_delivery_events
            WHERE invoice_id = ? AND provider = 'smtp'
          `,
          approved.invoiceId,
        ),
      ).toEqual([
        {
          status: smtpScenario.expectedStatus,
          technical_error_code: technicalErrorCode(smtpScenario.outcome),
        },
      ]);

      await expectSafeDiagnosticEvidence(e2eWeb, [
        smtpScenario.expectedEvent,
        smtpScenario.expectedStatus === 'outcomeUnknown'
          ? 'invoiceDelivery.outcomeUnknown'
          : 'invoiceDelivery.providerFailed',
      ]);
      await expectInvoicingActivity(
        e2eWeb,
        smtpScenario.expectedStatus === 'outcomeUnknown'
          ? 'invoice.deliveryOutcomeUnknown'
          : 'invoice.deliveryFailed',
      );
      expectNoPrivateOperationalData(e2eWeb);

      if (smtpScenario.expectedStatus === 'outcomeUnknown') {
        const blockedResponse = await e2eWeb.api.post(
          `/invoices/${approved.invoiceId}/email/smtp/prepare`,
          {
            data: {
              body: privateEmailBody,
              cc: '',
              subject: 'Synthetic blocked retry',
              to: privateRecipient,
            },
          },
        );
        expect(blockedResponse.status()).toBe(409);
      }

      expect((await e2eWeb.api.get('/health')).status()).toBe(200);
    });
  });
}

test.describe('invoice approval database fault', () => {
  test.use({
    e2eFaultPlan: {
      failOnCall: 1,
      kind: 'databaseWriteFailed',
      operation: 'approveInvoice',
    },
  });

  test('DB-ROLLBACK-001 @critical @fault rolls back approval and succeeds after the injected fault is released', async ({
    e2eWeb,
  }) => {
    const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
    const draft = await createInvoiceDraftThroughUi(e2eWeb.page, {
      customerId: customer.customerId,
      subject: 'E2E approval rollback',
    });

    const failedApproval = await approveCurrentInvoiceExpectingFailure(
      e2eWeb.page,
    );
    expect(failedApproval.status()).toBe(500);
    await expect(
      e2eWeb.page
        .getByRole('alert')
        .getByText('Palvelimen vastaus oli virheellinen.'),
    ).toBeVisible();

    expect(
      readE2eSqliteRows(
        e2eWeb.paths.databaseFilePath,
        'SELECT status, approved_invoice_id FROM invoice_drafts WHERE id = ?',
        draft.id,
      ),
    ).toEqual([{ approved_invoice_id: null, status: 'draft' }]);
    for (const table of [
      'invoices',
      'invoice_lines',
      'invoice_documents',
      'invoice_audit_events',
      'invoice_number_sequences',
    ]) {
      expect(
        readE2eSqliteRows(
          e2eWeb.paths.databaseFilePath,
          `SELECT COUNT(*) AS count FROM ${table}`,
        ),
      ).toEqual([{ count: 0 }]);
    }
    expect((await e2eWeb.api.get('/health')).status()).toBe(200);

    releaseE2eDatabaseFault(
      e2eWeb.paths.databaseFilePath,
      'approveInvoice',
    );
    await e2eWeb.page
      .getByRole('region', { name: 'Hyväksynnän vahvistus' })
      .getByRole('button', { name: 'Peruuta' })
      .click();
    const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
    expect(
      readE2eSqliteRows(
        e2eWeb.paths.databaseFilePath,
        'SELECT status FROM invoices WHERE id = ?',
        approved.invoiceId,
      ),
    ).toEqual([{ status: 'approved' }]);
    await expectInvoicingActivity(e2eWeb, 'invoice.approved');
    expectNoPrivateOperationalData(e2eWeb);
  });
});

test.describe('invoice payment event database fault', () => {
  test.use({
    e2eFaultPlan: {
      failOnCall: 1,
      kind: 'databaseWriteFailed',
      operation: 'markInvoicePaidEvent',
    },
  });

  test('INV-PAYMENT-006 @critical @fault rolls back the payment projection when the append-only event write fails', async ({
    e2eWeb,
  }) => {
    const approved = await createSentInvoiceForPaymentFault(e2eWeb);
    const failedResponse = await e2eWeb.api.put(
      `/invoices/${approved.invoiceId}/payment`,
      { data: { paidOn: '2026-07-30' } },
    );

    expect(failedResponse.status()).toBe(500);
    const failureText = await failedResponse.text();
    expect(failureText).not.toContain('E2E_DATABASE_WRITE_FAILED');
    expect(failureText).not.toContain('SQL');
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
          SELECT COUNT(*) AS count
          FROM invoice_payment_events
          WHERE invoice_id = ?
        `,
        approved.invoiceId,
      ),
    ).toEqual([{ count: 0 }]);

    releaseE2eDatabaseFault(
      e2eWeb.paths.databaseFilePath,
      'markInvoicePaidEvent',
    );
    const successfulResponse = await e2eWeb.api.put(
      `/invoices/${approved.invoiceId}/payment`,
      { data: { paidOn: '2026-07-30' } },
    );
    expect(successfulResponse.status()).toBe(200);
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
    expect((await e2eWeb.api.get('/health')).status()).toBe(200);
  });
});

test.describe('operational log writer fault', () => {
  test.use({ e2eFaultPlan: { kind: 'operationalLogWriteFailed' } });

  test('OBS-LOG-WRITE-001 @critical @fault keeps the business result and mandatory audit without recursion', async ({
    e2eWeb,
  }) => {
    const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
    await createInvoiceDraftThroughUi(e2eWeb.page, {
      customerId: customer.customerId,
      subject: 'E2E logger failure',
    });
    const approved = await approveCurrentInvoiceDraft(e2eWeb.page);

    expect(
      readE2eSqliteRows(
        e2eWeb.paths.databaseFilePath,
        `
          SELECT invoices.status, invoice_audit_events.action
          FROM invoices
          JOIN invoice_audit_events
            ON invoice_audit_events.invoice_id = invoices.id
          WHERE invoices.id = ?
        `,
        approved.invoiceId,
      ),
    ).toEqual([{ action: 'invoice.approved', status: 'approved' }]);
    await expectInvoicingActivity(e2eWeb, 'invoice.approved');

    const diagnostics = await readJsonResponse(
      await e2eWeb.api.get('/diagnostics/events'),
    );
    const support = await readJsonResponse(
      await e2eWeb.api.get('/diagnostics/support-bundle-data'),
    );
    expect(diagnostics).toEqual({ diagnosticEvents: [] });
    expect(support).toEqual(
      expect.objectContaining({
        diagnosticEvents: [],
        incidentSummaries: [],
      }),
    );
    expect(readE2eOperationalLogs(e2eWeb.paths.logsRoot)).toBe('');
    expect((await e2eWeb.api.get('/health')).status()).toBe(200);
  });
});

async function createApprovedInvoiceWithPdf(
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
  return approved;
}

async function createSentInvoiceForPaymentFault(
  e2eWeb: IsolatedWebHarness,
) {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId,
    subject: 'E2E payment event rollback',
  });
  const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
  await createCurrentInvoicePdf(e2eWeb.page);
  const sentResponse = await e2eWeb.api.post(
    `/invoices/${approved.invoiceId}/mark-sent`,
    { data: { deliveryMethod: 'manual' } },
  );
  expect(sentResponse.status()).toBe(200);

  return approved;
}

async function sendCurrentInvoiceExpectingFailure(
  page: Page,
  outcomeUnknown: boolean,
): Promise<Response> {
  await page.getByRole('button', { name: 'Valmistele sähköposti' }).click();
  await page.getByRole('heading', { name: 'Sähköpostin esikatselu' }).waitFor();
  await page.getByLabel('Viestin sisältö').fill(privateEmailBody);

  const responsePromise = waitForResponse(
    page,
    'POST',
    /\/invoices\/[^/]+\/email\/smtp\/send$/,
  );
  await page.getByRole('button', { name: 'Lähetä lasku' }).click();
  const response = await responsePromise;
  await expect(
    page.getByText(
      outcomeUnknown
        ? 'Lähetyksen lopputulosta ei voitu varmistaa. Älä lähetä heti uudelleen. Tarkista toimitushistoria ja varmista vastaanottajalta toimituksen tila.'
        : 'Laskun sähköpostia ei voitu lähettää. Laskua ei merkitty lähetetyksi.',
    ),
  ).toBeVisible();
  return response;
}

async function approveCurrentInvoiceExpectingFailure(
  page: Page,
): Promise<Response> {
  await page.getByRole('button', { name: 'Hyväksy laskuksi' }).click();
  const confirmation = page.getByRole('region', {
    name: 'Hyväksynnän vahvistus',
  });
  await confirmation.waitFor();
  const responsePromise = waitForResponse(
    page,
    'POST',
    /\/invoice-drafts\/[^/]+\/approve$/,
  );
  await confirmation
    .getByRole('button', { name: 'Hyväksy laskuksi' })
    .click();
  return responsePromise;
}

async function expectSafeDiagnosticEvidence(
  e2eWeb: IsolatedWebHarness,
  eventNames: readonly string[],
): Promise<void> {
  const diagnostics = await readJsonResponse(
    await e2eWeb.api.get('/diagnostics/events?limit=200'),
  );
  const support = await readJsonResponse(
    await e2eWeb.api.get('/diagnostics/support-bundle-data'),
  );
  const diagnosticsText = JSON.stringify(diagnostics);
  const supportText = JSON.stringify(support);

  for (const eventName of eventNames) {
    expect(diagnosticsText).toContain(eventName);
    expect(supportText).toContain(eventName);
  }
  for (const forbiddenValue of [
    smtpSecret,
    privateEmailBody,
    privateRecipient,
  ]) {
    expect(diagnosticsText).not.toContain(forbiddenValue);
    expect(supportText).not.toContain(forbiddenValue);
  }
}

async function expectInvoicingActivity(
  e2eWeb: IsolatedWebHarness,
  activityType: string,
): Promise<void> {
  const response = await e2eWeb.api.get(
    '/activity?category=invoicing&pageSize=100',
  );
  expect(response.status()).toBe(200);
  expect(JSON.stringify(await response.json())).toContain(activityType);
}

function expectNoPrivateOperationalData(e2eWeb: IsolatedWebHarness): void {
  const logs = readE2eOperationalLogs(e2eWeb.paths.logsRoot);
  for (const forbiddenValue of [
    smtpSecret,
    privateEmailBody,
    privateRecipient,
  ]) {
    expect(logs).not.toContain(forbiddenValue);
  }
}

function technicalErrorCode(
  outcome:
    | 'authenticationFailed'
    | 'deliveryFailed'
    | 'outcomeUnknown'
    | 'tlsFailed',
): string {
  return {
    authenticationFailed: 'E2E_SMTP_AUTHENTICATION_FAILED',
    deliveryFailed: 'E2E_SMTP_DELIVERY_FAILED',
    outcomeUnknown: 'E2E_SMTP_OUTCOME_UNKNOWN',
    tlsFailed: 'E2E_SMTP_TLS_FAILED',
  }[outcome];
}

function waitForResponse(
  page: Page,
  method: string,
  pathPattern: RegExp,
): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      pathPattern.test(new URL(response.url()).pathname),
  );
}

async function readJsonResponse(
  response: APIResponse,
): Promise<unknown> {
  expect(response.status()).toBe(200);
  return response.json();
}
