import { localRuntimeSessionHeaderName } from '../main/protocolPolicy.js';

interface CreateInvoicePdfPreviewSmokeFixtureInput {
  backendPort: number;
  runtimeSessionSecret: string;
}

export async function createInvoicePdfPreviewSmokeFixture(
  input: CreateInvoicePdfPreviewSmokeFixtureInput,
): Promise<string> {
  const request = createSmokeRequest(
    input.backendPort,
    input.runtimeSessionSecret,
  );

  await request('/company-settings', 'PUT', {
    bankName: 'Eky Smoke Bank',
    bic: 'NDEAFIHH',
    businessId: '1234567-8',
    city: 'Helsinki',
    companyName: 'Eky Desktop Smoke Oy',
    defaultHourlyRateCents: 6500,
    email: 'smoke@example.invalid',
    hourlyRateShortcut: 'työ',
    iban: 'FI2112345600000785',
    phone: '040 000 0000',
    postalCode: '00100',
    streetAddress: 'Testikatu 1',
    vatNumber: 'FI12345678',
    website: '',
  });
  await request('/invoice-numbering-settings', 'PUT', {
    firstSequenceNumber: 1,
    fiscalYearStartMonth: 1,
    mode: 'calendarYearSequence',
    sequencePadding: 4,
  });

  const customerResponse = await request('/customers', 'POST', {
    businessId: '7654321-0',
    city: 'Helsinki',
    comment: 'Synthetic packaged desktop smoke fixture',
    customerNumber: 'SMOKE-1',
    customerNumberMode: 'manual',
    customerType: 'company',
    email: 'customer@example.invalid',
    hourlyRateOverrideCents: null,
    managedByCustomerId: '',
    name: 'Eky Smoke Customer Oy',
    phone: '040 111 1111',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Asiakaskatu 2',
  });
  const customerId = readNestedIdentifier(
    customerResponse,
    'customer',
    'id',
  );
  const invoiceDate = new Date().toISOString().slice(0, 10);
  const draftInput = {
    customerId,
    deliveryAddressText: 'Paketoidun desktopin PDF-esikatselutesti',
    invoiceDate,
    lines: [
      {
        code: 'SMOKE',
        description: 'Synteettinen laskurivi PDF-esikatselun smoke-testiin',
        discount: { type: 'none' },
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 6500,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Tämä lasku sisältää vain synteettistä smoke-testidataa.',
    paymentTermDays: 14,
    priceInputMode: 'net',
    reminderPeriodDays: 8,
    subject: 'Desktop PDF smoke',
  };
  const draftResponse = await request('/invoice-drafts', 'POST', draftInput);
  const draftId = readNestedIdentifier(draftResponse, 'invoiceDraft', 'id');
  const approvalResponse = await request(
    `/invoice-drafts/${draftId}/approve`,
    'POST',
  );
  const invoiceId = readNestedIdentifier(
    approvalResponse,
    'approvedInvoice',
    'invoiceId',
  );

  const firstDocument = await request(`/invoices/${invoiceId}/pdf`, 'POST');
  const firstDocumentId = readNestedIdentifier(firstDocument, 'document', 'id');
  const firstPdf = await readSmokePdf(input, `/invoices/${invoiceId}/pdf`);
  const delivery = await request(`/invoices/${invoiceId}/email/dry-run/send`, 'POST', {
    to: 'customer@example.invalid',
    cc: '',
    subject: 'Synthetic first revision delivery',
    body: 'Synthetic dry-run only; no SMTP connection.',
  });
  const eventId = readNestedIdentifier(delivery, 'delivery', 'deliveryEventId');
  const reopened = await request(`/invoices/${invoiceId}/reopen-for-edit`, 'POST');
  const reopenedDraftId = readIdentifier(reopened, 'invoiceDraftId');
  if (reopenedDraftId !== draftId) {
    throw new Error('DESKTOP_SMOKE_INVOICE_REVISION_IDENTITY_FAILED');
  }
  await request(`/invoice-drafts/${draftId}`, 'PUT', {
    ...draftInput,
    subject: 'Desktop PDF smoke second revision',
  });
  const reapproved = await request(`/invoice-drafts/${draftId}/approve`, 'POST');
  if (
    readNestedIdentifier(reapproved, 'approvedInvoice', 'invoiceId') !== invoiceId ||
    readNestedIdentifier(reapproved, 'approvedInvoice', 'invoiceNumber') !==
      readNestedIdentifier(approvalResponse, 'approvedInvoice', 'invoiceNumber')
  ) {
    throw new Error('DESKTOP_SMOKE_INVOICE_REVISION_IDENTITY_FAILED');
  }
  const secondDocument = await request(`/invoices/${invoiceId}/pdf`, 'POST');
  const secondPdf = await readSmokePdf(input, `/invoices/${invoiceId}/pdf`);
  const historicalPdf = await readSmokePdf(
    input, `/invoices/${invoiceId}/delivery-events/${eventId}/pdf`,
  );
  if (
    readNestedIdentifier(secondDocument, 'document', 'id') === firstDocumentId ||
    firstPdf.equals(secondPdf) || !firstPdf.equals(historicalPdf)
  ) {
    throw new Error('DESKTOP_SMOKE_INVOICE_REVISION_CONTENT_FAILED');
  }

  return invoiceId;
}

async function readSmokePdf(
  input: CreateInvoicePdfPreviewSmokeFixtureInput,
  pathname: string,
): Promise<Buffer> {
  const response = await fetch(`http://127.0.0.1:${input.backendPort}${pathname}`, {
    headers: {
      accept: 'application/pdf',
      [localRuntimeSessionHeaderName]: input.runtimeSessionSecret,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || response.headers.get('content-type') !== 'application/pdf') {
    throw new Error('DESKTOP_SMOKE_INVOICE_REVISION_CONTENT_FAILED');
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new Error('DESKTOP_SMOKE_INVOICE_REVISION_CONTENT_FAILED');
  }
  return content;
}

function createSmokeRequest(
  backendPort: number,
  runtimeSessionSecret: string,
): (
  pathname: string,
  method: 'POST' | 'PUT',
  body?: Record<string, unknown>,
) => Promise<unknown> {
  return async (pathname, method, body) => {
    const headers = new Headers({
      accept: 'application/json',
      [localRuntimeSessionHeaderName]: runtimeSessionSecret,
    });
    const requestInit: RequestInit = {
      headers,
      method,
      signal: AbortSignal.timeout(10_000),
    };

    if (body !== undefined) {
      headers.set('content-type', 'application/json');
      requestInit.body = JSON.stringify(body);
    }

    const response = await fetch(
      `http://127.0.0.1:${backendPort}${pathname}`,
      requestInit,
    );

    if (!response.ok) {
      throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_FIXTURE_FAILED');
    }

    try {
      return await response.json();
    } catch {
      throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_FIXTURE_FAILED');
    }
  };
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
    throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_FIXTURE_FAILED');
  }

  const parent = (value as Record<string, unknown>)[parentField];

  return readIdentifier(parent, identifierField);
}

function readIdentifier(value: unknown, identifierField: string): string {
  if (typeof value !== 'object' || value === null || !(identifierField in value)) {
    throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_FIXTURE_FAILED');
  }

  const identifier = (value as Record<string, unknown>)[identifierField];

  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_FIXTURE_FAILED');
  }

  return identifier;
}
