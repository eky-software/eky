import type { APIRequestContext } from '@playwright/test';

import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../data/syntheticBusinessInputs.js';

export interface EnduranceApiWorkloadResult {
  approvedInvoiceCount: number;
  customerCount: number;
  invoiceDraftCount: number;
  pdfDocumentCount: number;
}

const customerIterations = 100;
const invoiceDraftIterations = 100;
const pdfIterations = 25;

export async function runEnduranceApiWorkload(
  api: APIRequestContext,
): Promise<EnduranceApiWorkloadResult> {
  await expectStatus(
    api.put('/company-settings', {
      data: createSyntheticCompanySettingsInput({
        emailDeliveryProvider: 'dryRun',
      }),
    }),
    200,
    'company settings update',
  );
  await expectStatus(
    api.put('/invoice-numbering-settings', {
      data: {
        firstSequenceNumber: 1,
        fiscalYearStartMonth: 1,
        mode: 'calendarYearSequence',
        sequencePadding: 4,
      },
    }),
    200,
    'invoice numbering settings update',
  );

  const customerIds: string[] = [];
  for (let index = 1; index <= customerIterations; index += 1) {
    const sequence = String(index).padStart(3, '0');
    const createResponse = await api.post('/customers', {
      data: createSyntheticCustomerInput({
        businessId: '',
        customerNumber: `END-C-${sequence}`,
        email: `customer-${sequence}@example.invalid`,
        name: `Synthetic Endurance Customer ${sequence}`,
        streetAddress: `Endurancekatu ${String(index)}`,
      }),
    });
    assertStatus(createResponse.status(), 201, 'customer create');
    const customerId = String(
      ((await createResponse.json()) as { customer: { id: string } }).customer
        .id,
    );
    customerIds.push(customerId);

    await expectStatus(
      api.put(`/customers/${customerId}`, {
        data: createSyntheticCustomerInput({
          businessId: '',
          customerNumber: `END-C-${sequence}`,
          email: `customer-${sequence}@example.invalid`,
          name: `Updated Endurance Customer ${sequence}`,
          streetAddress: `Updated Endurancekatu ${String(index)}`,
        }),
      }),
      200,
      'customer update',
    );
    const listResponse = await api.get('/customers');
    assertStatus(listResponse.status(), 200, 'customer list');
    const customerCount = (
      (await listResponse.json()) as { customers: unknown[] }
    ).customers.length;
    if (customerCount !== index) {
      throw new Error('Customer endurance list count was inconsistent.');
    }
  }

  const draftIds: string[] = [];
  for (let index = 1; index <= invoiceDraftIterations; index += 1) {
    const customerId = customerIds[(index - 1) % customerIds.length];
    if (customerId === undefined) {
      throw new Error('Invoice endurance customer was unavailable.');
    }
    const sequence = String(index).padStart(3, '0');
    const createResponse = await api.post('/invoice-drafts', {
      data: createSyntheticInvoiceDraftInput(customerId, {
        orderNumber: `END-ORDER-${sequence}`,
        subject: `Synthetic Endurance Invoice ${sequence}`,
      }),
    });
    assertStatus(createResponse.status(), 201, 'invoice draft create');
    const draftId = String(
      ((await createResponse.json()) as { invoiceDraft: { id: string } })
        .invoiceDraft.id,
    );
    draftIds.push(draftId);

    await expectStatus(
      api.put(`/invoice-drafts/${draftId}`, {
        data: createSyntheticInvoiceDraftInput(customerId, {
          note: `Updated synthetic endurance draft ${sequence}`,
          orderNumber: `END-ORDER-${sequence}`,
          subject: `Updated Endurance Invoice ${sequence}`,
        }),
      }),
      200,
      'invoice draft update',
    );
    await expectStatus(
      api.get(`/invoice-drafts/${draftId}`),
      200,
      'invoice draft read',
    );
  }

  for (const draftId of draftIds.slice(0, pdfIterations)) {
    const approvalResponse = await api.post(
      `/invoice-drafts/${draftId}/approve`,
    );
    assertStatus(approvalResponse.status(), 200, 'invoice approval');
    const invoiceId = String(
      (
        (await approvalResponse.json()) as {
          approvedInvoice: { invoiceId: string };
        }
      ).approvedInvoice.invoiceId,
    );
    await expectStatus(
      api.post(`/invoices/${invoiceId}/pdf`),
      200,
      'invoice PDF generation',
    );
  }

  return {
    approvedInvoiceCount: pdfIterations,
    customerCount: customerIterations,
    invoiceDraftCount: invoiceDraftIterations,
    pdfDocumentCount: pdfIterations,
  };
}

async function expectStatus(
  responsePromise: ReturnType<APIRequestContext['get']>,
  expectedStatus: number,
  operation: string,
): Promise<void> {
  const response = await responsePromise;
  assertStatus(response.status(), expectedStatus, operation);
}

function assertStatus(
  actualStatus: number,
  expectedStatus: number,
  operation: string,
): void {
  if (actualStatus !== expectedStatus) {
    throw new Error(
      `Unexpected ${operation} response status: ${String(actualStatus)}; expected ${String(expectedStatus)}.`,
    );
  }
}
