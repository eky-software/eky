import type { APIRequestContext, APIResponse } from '@playwright/test';

import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../data/syntheticBusinessInputs.js';

export interface ApprovedInvoiceApiIdentity {
  invoiceId: string;
  invoiceNumber: string;
}

export async function createApprovedInvoiceWithPdf(
  api: APIRequestContext,
): Promise<ApprovedInvoiceApiIdentity> {
  await requireStatus(
    api.put('/company-settings', {
      data: createSyntheticCompanySettingsInput(),
    }),
    200,
    'company settings',
  );
  await requireStatus(
    api.put('/invoice-numbering-settings', {
      data: {
        firstSequenceNumber: 1,
        fiscalYearStartMonth: 1,
        mode: 'calendarYearSequence',
        sequencePadding: 4,
      },
    }),
    200,
    'invoice numbering settings',
  );

  const customerResponse = await requireStatus(
    api.post('/customers', {
      data: createSyntheticCustomerInput({
        customerNumber: 'DESK-E2E-1001',
        email: 'desktop-recipient@example.invalid',
        name: 'Desktop Synthetic Customer Oy',
      }),
    }),
    201,
    'customer',
  );
  const customerId = readNestedIdentifier(
    await customerResponse.json(),
    'customer',
    'id',
  );
  const draftResponse = await requireStatus(
    api.post('/invoice-drafts', {
      data: createSyntheticInvoiceDraftInput(customerId, {
        note: 'Synthetic Electron capability test invoice',
        subject: 'Desktop capability test invoice',
      }),
    }),
    201,
    'invoice draft',
  );
  const draftId = readNestedIdentifier(
    await draftResponse.json(),
    'invoiceDraft',
    'id',
  );
  const approvalResponse = await requireStatus(
    api.post(`/invoice-drafts/${draftId}/approve`),
    200,
    'invoice approval',
  );
  const approvalBody = await approvalResponse.json();
  const invoiceId = readNestedIdentifier(
    approvalBody,
    'approvedInvoice',
    'invoiceId',
  );
  const invoiceNumber = readNestedIdentifier(
    approvalBody,
    'approvedInvoice',
    'invoiceNumber',
  );

  await requireOneOfStatuses(
    api.post(`/invoices/${invoiceId}/pdf`),
    [200, 201],
    'approved invoice PDF',
  );

  return { invoiceId, invoiceNumber };
}

async function requireOneOfStatuses(
  responsePromise: Promise<APIResponse>,
  expectedStatuses: readonly number[],
  operation: string,
): Promise<APIResponse> {
  const response = await responsePromise;
  if (!expectedStatuses.includes(response.status())) {
    throw new Error(`Electron E2E ${operation} failed safely.`);
  }
  return response;
}

async function requireStatus(
  responsePromise: Promise<APIResponse>,
  expectedStatus: number,
  operation: string,
): Promise<APIResponse> {
  const response = await responsePromise;
  if (response.status() !== expectedStatus) {
    throw new Error(`Electron E2E ${operation} failed safely.`);
  }
  return response;
}

function readNestedIdentifier(
  value: unknown,
  parentField: string,
  identifierField: string,
): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(parentField in value)
  ) {
    throw new Error('Electron E2E response shape is invalid.');
  }
  const parent = (value as Record<string, unknown>)[parentField];
  if (
    typeof parent !== 'object' ||
    parent === null ||
    !(identifierField in parent)
  ) {
    throw new Error('Electron E2E response shape is invalid.');
  }
  const identifier = (parent as Record<string, unknown>)[identifierField];
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error('Electron E2E response identifier is invalid.');
  }
  return identifier;
}
