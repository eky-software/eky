import type { APIRequestContext } from '@playwright/test';

import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedBackendTest.js';

const activationConfirmation = 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN';

test('DB-SQLITE-UPGRADE-001 @critical @recovery completes the invoicing lifecycle before and after restart', async ({
  e2eBackend,
}) => {
  assertDatabaseIntegrity(e2eBackend.paths.databaseFilePath);
  expect(
    readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM schema_migrations',
    ),
  ).toEqual([{ count: 38 }]);

  const customerId = await seedPrerequisites(e2eBackend.api);
  const sourceInvoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
  );

  const pdfResponse = await e2eBackend.api.post(
    `/invoices/${sourceInvoice.id}/pdf`,
  );
  expect([200, 201]).toContain(pdfResponse.status());
  const metadataResponse = await e2eBackend.api.get(
    `/invoices/${sourceInvoice.id}/pdf/metadata`,
  );
  expect(metadataResponse.status()).toBe(200);
  await expect(metadataResponse.json()).resolves.toEqual({
    document: expect.objectContaining({
      documentType: 'approved_invoice_pdf',
      invoiceId: sourceInvoice.id,
    }),
  });

  const deliveryResponse = await e2eBackend.api.post(
    `/invoices/${sourceInvoice.id}/mark-sent`,
    { data: { deliveryMethod: 'manual' } },
  );
  expect(deliveryResponse.status()).toBe(200);
  const paymentResponse = await e2eBackend.api.put(
    `/invoices/${sourceInvoice.id}/payment`,
    { data: { paidOn: '2026-08-03' } },
  );
  expect(paymentResponse.status()).toBe(200);

  const creditInvoice = await createFullCreditInvoice(
    e2eBackend.api,
    sourceInvoice.id,
  );
  await activateNextNumberingSeries(e2eBackend.api);

  expect(
    readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_documents
        WHERE invoice_id = ?
          AND document_type = 'approved_invoice_pdf'
      `,
      sourceInvoice.id,
    ),
  ).toEqual([{ count: 1 }]);
  expect(
    readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_delivery_events
        WHERE invoice_id = ?
          AND status = 'succeeded'
      `,
      sourceInvoice.id,
    ),
  ).toEqual([{ count: 1 }]);
  expect(
    readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoice_payment_events
        WHERE invoice_id = ?
          AND action = 'paymentMarkedPaid'
      `,
      sourceInvoice.id,
    ),
  ).toEqual([{ count: 1 }]);
  assertDatabaseIntegrity(e2eBackend.paths.databaseFilePath);

  const restarted = await e2eBackend.restartBackend();

  const sourceResponse = await restarted.api.get(
    `/invoices/${sourceInvoice.id}`,
  );
  expect(sourceResponse.status()).toBe(200);
  await expect(sourceResponse.json()).resolves.toEqual({
    invoice: expect.objectContaining({
      id: sourceInvoice.id,
      invoiceNumber: sourceInvoice.number,
      paymentState: 'paid',
      status: 'sent',
    }),
  });
  const creditResponse = await restarted.api.get(
    `/invoices/${creditInvoice.id}`,
  );
  expect(creditResponse.status()).toBe(200);
  await expect(creditResponse.json()).resolves.toEqual({
    invoice: expect.objectContaining({
      creditedInvoiceId: sourceInvoice.id,
      id: creditInvoice.id,
      invoiceKind: 'credit',
    }),
  });
  expect(
    readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM invoice_numbering_series_events',
    ),
  ).toEqual([{ count: 1 }]);
  assertDatabaseIntegrity(e2eBackend.paths.databaseFilePath);
});

async function seedPrerequisites(
  api: APIRequestContext,
): Promise<string> {
  expect(
    (
      await api.put('/company-settings', {
        data: createSyntheticCompanySettingsInput(),
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.put('/invoice-numbering-settings', {
        data: {
          firstSequenceNumber: 1,
          fiscalYearStartMonth: 1,
          mode: 'calendarYearSequence',
          sequencePadding: 4,
        },
      })
    ).status(),
  ).toBe(200);
  const customerResponse = await api.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: 'E2E-SQLITE-13',
      name: 'Synthetic SQLite Compatibility Customer Oy',
    }),
  });
  expect(customerResponse.status()).toBe(201);
  const body = (await customerResponse.json()) as {
    customer: { id: string };
  };
  return body.customer.id;
}

async function createApprovedInvoice(
  api: APIRequestContext,
  customerId: string,
): Promise<{ id: string; number: string }> {
  const draftResponse = await api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, {
      subject: 'Synthetic SQLite compatibility invoice',
    }),
  });
  expect(draftResponse.status()).toBe(201);
  const draftBody = (await draftResponse.json()) as {
    invoiceDraft: { id: string };
  };
  const approvalResponse = await api.post(
    `/invoice-drafts/${draftBody.invoiceDraft.id}/approve`,
  );
  expect(approvalResponse.status()).toBe(200);
  const approvalBody = (await approvalResponse.json()) as {
    approvedInvoice: { invoiceId: string; invoiceNumber: string };
  };
  return {
    id: approvalBody.approvedInvoice.invoiceId,
    number: approvalBody.approvedInvoice.invoiceNumber,
  };
}

async function createFullCreditInvoice(
  api: APIRequestContext,
  sourceInvoiceId: string,
): Promise<{ id: string }> {
  const draftResponse = await api.post(
    `/invoices/${sourceInvoiceId}/credit-draft`,
  );
  expect(draftResponse.status()).toBe(201);
  const draftBody = (await draftResponse.json()) as {
    creditInvoiceDraft: { id: string };
  };
  const approvalResponse = await api.post(
    `/invoice-drafts/${draftBody.creditInvoiceDraft.id}/approve-credit`,
  );
  expect(approvalResponse.status()).toBe(200);
  const approvalBody = (await approvalResponse.json()) as {
    approvedInvoice: { invoiceId: string };
  };
  return { id: approvalBody.approvedInvoice.invoiceId };
}

async function activateNextNumberingSeries(
  api: APIRequestContext,
): Promise<void> {
  const overviewResponse = await api.get('/invoice-numbering-series');
  expect(overviewResponse.status()).toBe(200);
  const overviewBody = (await overviewResponse.json()) as {
    invoiceNumberingSeriesOverview: { revision: number };
  };
  const previewQuery = new URLSearchParams({
    fiscalYearStartMonth: '1',
    mode: 'calendarYearSequence',
    previewDate: '2026-08-03',
    sequencePadding: '4',
  });
  const previewResponse = await api.get(
    `/invoice-numbering-series/activation-preview?${previewQuery.toString()}`,
  );
  expect(previewResponse.status()).toBe(200);
  const previewBody = (await previewResponse.json()) as {
    invoiceNumberingSeriesActivationPreview: {
      minimumFirstSequenceNumber: number;
    };
  };
  const activationResponse = await api.post(
    '/invoice-numbering-series/activate',
    {
      data: {
        confirmation: activationConfirmation,
        currentRevision:
          overviewBody.invoiceNumberingSeriesOverview.revision,
        firstSequenceNumber:
          previewBody.invoiceNumberingSeriesActivationPreview
            .minimumFirstSequenceNumber,
        fiscalYearStartMonth: 1,
        mode: 'calendarYearSequence',
        reasonCode: 'accountingRequirement',
        reasonNote: 'Synthetic SQLite compatibility transition',
        sequencePadding: 4,
      },
    },
  );
  expect(activationResponse.status()).toBe(201);
}

function assertDatabaseIntegrity(databaseFilePath: string): void {
  expect(
    readE2eSqliteRows(databaseFilePath, 'PRAGMA integrity_check'),
  ).toEqual([{ integrity_check: 'ok' }]);
  expect(
    readE2eSqliteRows(databaseFilePath, 'PRAGMA foreign_key_check'),
  ).toEqual([]);
}
