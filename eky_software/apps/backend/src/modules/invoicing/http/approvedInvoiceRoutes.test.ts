import { describe, expect, it } from 'vitest';

import type { GetApprovedInvoiceInput } from '../application/getApprovedInvoice.js';
import type { ListApprovedInvoicesInput } from '../application/listApprovedInvoices.js';
import type { ReopenApprovedInvoiceForEditingInput } from '../application/reopenApprovedInvoiceForEditing.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from '../application/generateApprovedInvoicePdfDocument.js';
import type {
  ApprovedInvoicePdfDocumentFile,
  GetApprovedInvoicePdfDocumentInput,
} from '../application/getApprovedInvoicePdfDocument.js';
import type {
  GetApprovedInvoicePdfMetadataInput,
} from '../application/getApprovedInvoicePdfMetadata.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { createApprovedInvoiceRoutes } from './approvedInvoiceRoutes.js';

describe('approved invoice routes', () => {
  it('returns approved invoice summaries in the company scope', async () => {
    const invoiceSummary = createApprovedInvoiceSummary();
    const { app, getListInput } = createTestApp({
      invoices: [invoiceSummary],
    });

    const response = await app.request('/invoices');

    await expect(response.json()).resolves.toEqual({
      invoices: [invoiceSummary],
    });
    expect(response.status).toBe(200);
    expect(getListInput()).toEqual({ companyId: 'dev-company' });
  });

  it('returns an approved invoice by id', async () => {
    const invoice = createApprovedInvoiceView();
    const { app, getInput } = createTestApp({ invoice });

    const response = await app.request('/invoices/invoice-1');

    await expect(response.json()).resolves.toEqual({ invoice });
    expect(response.status).toBe(200);
    expect(getInput()).toEqual({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns a safe 404 when the invoice is not found in the company scope', async () => {
    const { app } = createTestApp({
      error: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing-invoice');

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
    expect(response.status).toBe(404);
  });

  it('returns the snapshot response shape needed by print and preview flows', async () => {
    const { app } = createTestApp({ invoice: createApprovedInvoiceView() });

    const response = await app.request('/invoices/invoice-1');
    const body = await response.json();

    expect(body.invoice).toMatchObject({
      invoiceNumber: '20260001',
      referenceNumber: '202600017',
      companyNameSnapshot: 'Example Builder Oy',
      companyVatNumberSnapshot: 'FI76543210',
      companyIbanSnapshot: 'FI2112345600000785',
      customerNameSnapshot: 'Example Customer Oy',
      billingRecipientNameSnapshot: 'Billing Recipient Oy',
      latePaymentInterestBasisPoints: 950,
      reminderPeriodDays: 8,
      deliveryAddressText: 'Worksite Street 4',
      totals: {
        netTotalCents: 10000,
        vatTotalCents: 2550,
        grossTotalCents: 12550,
      },
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 10000,
          vatCents: 2550,
          grossCents: 12550,
        },
      ],
    });
  });

  it('reopens an approved invoice for editing in the company scope', async () => {
    const { app, getReopenInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/reopen-for-edit', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      invoiceDraftId: 'draft-1',
      invoiceId: 'invoice-1',
    });
    expect(response.status).toBe(200);
    expect(getReopenInput()).toMatchObject({
      actorUserId: 'dev-user',
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('creates approved invoice PDF metadata in the company scope', async () => {
    const document = createApprovedInvoiceDocumentMetadata();
    const { app, getGeneratePdfInput } = createTestApp({ document });

    const response = await app.request('/invoices/invoice-1/pdf', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({ document });
    expect(response.status).toBe(200);
    expect(getGeneratePdfInput()).toMatchObject({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns approved invoice PDF with inline content headers', async () => {
    const pdfDocument = createApprovedInvoicePdfDocumentFile();
    const { app, getPdfInput } = createTestApp({ pdfDocument });

    const response = await app.request('/invoices/invoice-1/pdf');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe(
      'inline; filename="lasku-20260001.pdf"',
    );
    await expect(response.arrayBuffer()).resolves.toEqual(
      pdfDocument.content.buffer,
    );
    expect(getPdfInput()).toEqual({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns approved invoice PDF metadata when the stored PDF exists', async () => {
    const document = createApprovedInvoiceDocumentMetadata();
    const { app, getPdfMetadataInput } = createTestApp({ document });

    const response = await app.request('/invoices/invoice-1/pdf/metadata');

    await expect(response.json()).resolves.toEqual({ document });
    expect(response.status).toBe(200);
    expect(getPdfMetadataInput()).toEqual({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns a safe 404 when the approved invoice PDF is missing', async () => {
    const { app } = createTestApp({
      pdfError: new ApprovedInvoiceDocumentNotFoundError(),
    });

    const response = await app.request('/invoices/missing/pdf');

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice document was not found.',
    });
    expect(response.status).toBe(404);
  });

  it('returns a safe 404 when approved invoice PDF metadata is missing', async () => {
    const { app } = createTestApp({
      pdfError: new ApprovedInvoiceDocumentNotFoundError(),
    });

    const response = await app.request('/invoices/missing/pdf/metadata');

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice document was not found.',
    });
    expect(response.status).toBe(404);
  });

  it('returns a safe 404 when reopening an invoice outside the company scope', async () => {
    const { app } = createTestApp({
      error: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/reopen-for-edit', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
    expect(response.status).toBe(404);
  });
});

function createTestApp(options: {
  document?: ApprovedInvoiceDocumentMetadata;
  error?: Error;
  invoice?: ApprovedInvoiceView;
  invoices?: ApprovedInvoiceSummary[];
  pdfDocument?: ApprovedInvoicePdfDocumentFile;
  pdfError?: Error;
}) {
  let input: GetApprovedInvoiceInput | undefined;
  let listInput: ListApprovedInvoicesInput | undefined;
  let reopenInput: ReopenApprovedInvoiceForEditingInput | undefined;
  let generatePdfInput: GenerateApprovedInvoicePdfDocumentInput | undefined;
  let pdfInput: GetApprovedInvoicePdfDocumentInput | undefined;
  let pdfMetadataInput: GetApprovedInvoicePdfMetadataInput | undefined;
  const app = createApprovedInvoiceRoutes({
    async generateApprovedInvoicePdfDocument(nextInput) {
      generatePdfInput = nextInput;

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.document ?? createApprovedInvoiceDocumentMetadata();
    },
    async getApprovedInvoice(nextInput) {
      input = nextInput;

      if (options.error !== undefined) {
        throw options.error;
      }

      if (options.invoice === undefined) {
        throw new ApprovedInvoiceNotFoundError();
      }

      return options.invoice;
    },
    async listApprovedInvoices(nextInput) {
      listInput = nextInput;

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.invoices ?? [];
    },
    async getApprovedInvoicePdfDocument(nextInput) {
      pdfInput = nextInput;

      if (options.pdfError !== undefined) {
        throw options.pdfError;
      }

      return options.pdfDocument ?? createApprovedInvoicePdfDocumentFile();
    },
    async getApprovedInvoicePdfMetadata(nextInput) {
      pdfMetadataInput = nextInput;

      if (options.pdfError !== undefined) {
        throw options.pdfError;
      }

      return options.document ?? createApprovedInvoiceDocumentMetadata();
    },
    async reopenApprovedInvoiceForEditing(nextInput) {
      reopenInput = nextInput;

      if (options.error !== undefined) {
        throw options.error;
      }

      return {
        draftId: 'draft-1',
        invoiceId: nextInput.invoiceId,
      };
    },
  });

  return {
    app,
    getGeneratePdfInput: () => generatePdfInput,
    getInput: () => input,
    getListInput: () => listInput,
    getPdfInput: () => pdfInput,
    getPdfMetadataInput: () => pdfMetadataInput,
    getReopenInput: () => reopenInput,
  };
}

function createApprovedInvoiceDocumentMetadata(): ApprovedInvoiceDocumentMetadata {
  return {
    id: 'document-1',
    companyId: 'dev-company',
    invoiceId: 'invoice-1',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    storagePath: 'dev-company/invoice-1/approved-invoice.pdf',
    mimeType: 'application/pdf',
    sha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sizeBytes: 8,
    createdAt: '2026-07-05T10:00:00.000Z',
  };
}

function createApprovedInvoicePdfDocumentFile(): ApprovedInvoicePdfDocumentFile {
  return {
    content: new Uint8Array([37, 80, 68, 70, 45, 116, 101, 115]),
    metadata: createApprovedInvoiceDocumentMetadata(),
  };
}

function createApprovedInvoiceSummary(): ApprovedInvoiceSummary {
  return {
    id: 'invoice-1',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    grossTotalCents: 12550,
    approvedAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  };
}

function createApprovedInvoiceView(): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    companyId: 'dev-company',
    sourceDraftId: 'draft-1',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    seriesKey: 'default',
    sequenceScope: 'calendar-year:2026',
    sequenceNumber: 1,
    numberingMode: 'calendarYearSequence',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    customerBusinessIdSnapshot: '1234567-8',
    customerTypeSnapshot: 'company',
    customerEmailSnapshot: 'customer@example.fi',
    customerPhoneSnapshot: '040 111 2222',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerPostalCodeSnapshot: '00100',
    customerCitySnapshot: 'Helsinki',
    companyNameSnapshot: 'Example Builder Oy',
    companyBusinessIdSnapshot: '7654321-0',
    companyVatNumberSnapshot: 'FI76543210',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyPostalCodeSnapshot: '33100',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyPhoneSnapshot: '03 123 4567',
    companyWebsiteSnapshot: 'www.example-builder.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyBicSnapshot: 'NDEAFIHH',
    companyBankNameSnapshot: 'Example Bank',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientPhoneSnapshot: '040 333 4444',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 3',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientCitySnapshot: 'Espoo',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Invoice note',
    deliveryAddressText: 'Worksite Street 4',
    lines: [
      {
        id: 'line-1',
        lineOrder: 1,
        code: 'WORK',
        description: 'Work',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatRateBasisPoints: 2550,
        discount: { type: 'none' },
        baseCents: 10000,
        discountCents: 0,
        netCents: 10000,
        vatCents: 2550,
        grossCents: 12550,
      },
    ],
    totals: {
      netTotalCents: 10000,
      vatTotalCents: 2550,
      grossTotalCents: 12550,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 10000,
          vatCents: 2550,
          grossCents: 12550,
        },
      ],
    },
    vatBreakdown: [
      {
        vatRateBasisPoints: 2550,
        netCents: 10000,
        vatCents: 2550,
        grossCents: 12550,
      },
    ],
    createdAt: '2026-06-13T10:00:00.000Z',
    approvedAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  };
}
