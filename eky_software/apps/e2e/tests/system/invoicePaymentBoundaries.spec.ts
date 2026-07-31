import type { APIRequestContext, APIResponse } from '@playwright/test';

import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
import {
  expect,
  test,
  type IsolatedBackendHarness,
} from '../../src/fixtures/isolatedBackendTest.js';
import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';

const paidOn = '2026-07-30';

test('INV-PAYMENT-003 @security rejects unauthenticated, unknown and ineligible invoice payment mutations without writes', async ({
  e2eBackend,
}) => {
  const customerId = await seedPaymentPrerequisites(e2eBackend.api);
  const approved = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'E2E approved payment boundary',
  );
  const cancelled = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'E2E cancelled payment boundary',
  );
  await cancelInvoice(e2eBackend.api, cancelled);
  const fullyCreditedSource = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'E2E fully credited payment boundary',
  );
  await markInvoiceSent(e2eBackend.api, fullyCreditedSource.id);
  const creditInvoice = await createFullCreditInvoice(
    e2eBackend.api,
    fullyCreditedSource.id,
  );

  const unauthenticatedResponse = await e2eBackend.anonymousApi.put(
    `/invoices/${approved.id}/payment`,
    { data: { paidOn } },
  );
  expect(unauthenticatedResponse.status()).toBe(401);

  const cases: readonly [string, Promise<APIResponse>, number][] = [
    [
      'unknown or outside the trusted company scope',
      markInvoicePaid(
        e2eBackend.api,
        'invoice-from-another-company',
      ),
      404,
    ],
    [
      'approved invoice',
      markInvoicePaid(e2eBackend.api, approved.id),
      409,
    ],
    [
      'cancelled invoice',
      markInvoicePaid(e2eBackend.api, cancelled.id),
      409,
    ],
    [
      'credit invoice',
      markInvoicePaid(e2eBackend.api, creditInvoice.id),
      409,
    ],
    [
      'fully credited source invoice',
      markInvoicePaid(e2eBackend.api, fullyCreditedSource.id),
      409,
    ],
  ];

  for (const [name, responsePromise, expectedStatus] of cases) {
    const response = await responsePromise;
    expect(response.status(), name).toBe(expectedStatus);
    const responseText = await response.text();
    expect(responseText).not.toContain('dev-company');
    expect(responseText).not.toContain('SQL');
    expect(responseText).not.toContain('stack');
  }

  expect(
    readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM invoice_payment_events',
    ),
  ).toEqual([{ count: 0 }]);
  expect(
    readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      `
        SELECT COUNT(*) AS count
        FROM invoices
        WHERE payment_state = 'paid'
      `,
    ),
  ).toEqual([{ count: 0 }]);
  expect((await e2eBackend.api.get('/health')).status()).toBe(200);
});

async function seedPaymentPrerequisites(
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
      customerNumber: 'E2E-PAYMENT-BOUNDARY',
      name: 'Payment Boundary Customer Oy',
    }),
  });
  expect(customerResponse.status()).toBe(201);
  const customerBody = (await customerResponse.json()) as {
    customer: { id: string };
  };

  return customerBody.customer.id;
}

async function createApprovedInvoice(
  api: APIRequestContext,
  customerId: string,
  subject: string,
): Promise<{ id: string; number: string }> {
  const draftResponse = await api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, { subject }),
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

async function markInvoiceSent(
  api: APIRequestContext,
  invoiceId: string,
): Promise<void> {
  const pdfResponse = await api.post(`/invoices/${invoiceId}/pdf`);
  expect([200, 201]).toContain(pdfResponse.status());
  const sentResponse = await api.post(`/invoices/${invoiceId}/mark-sent`, {
    data: { deliveryMethod: 'manual' },
  });
  expect(sentResponse.status()).toBe(200);
}

async function createFullCreditInvoice(
  api: APIRequestContext,
  invoiceId: string,
): Promise<{ id: string }> {
  const draftResponse = await api.post(
    `/invoices/${invoiceId}/credit-draft`,
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

async function cancelInvoice(
  api: APIRequestContext,
  invoice: { id: string; number: string },
): Promise<void> {
  const response = await api.post(`/invoices/${invoice.id}/cancel`, {
    data: {
      cancellationReason: 'Synthetic payment boundary cancellation',
      confirmationInvoiceNumber: invoice.number,
    },
  });
  expect(response.status()).toBe(200);
}

function markInvoicePaid(
  api: APIRequestContext,
  invoiceId: string,
): Promise<APIResponse> {
  return api.put(`/invoices/${invoiceId}/payment`, {
    data: { paidOn },
  });
}
