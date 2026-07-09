import { describe, expect, it } from 'vitest';

import type { GetApprovedInvoiceInput } from '../application/getApprovedInvoice.js';
import type { ListApprovedInvoicesInput } from '../application/listApprovedInvoices.js';
import type { ReopenApprovedInvoiceForEditingInput } from '../application/reopenApprovedInvoiceForEditing.js';
import type { MarkApprovedInvoiceSentInput } from '../application/markApprovedInvoiceSent.js';
import type { CopyApprovedInvoiceToDraftInput } from '../application/copyApprovedInvoiceToDraft.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from '../application/generateApprovedInvoicePdfDocument.js';
import type {
  ApprovedInvoicePdfDocumentFile,
  GetApprovedInvoicePdfDocumentInput,
} from '../application/getApprovedInvoicePdfDocument.js';
import type {
  GetApprovedInvoicePdfMetadataInput,
} from '../application/getApprovedInvoicePdfMetadata.js';
import type {
  PrepareApprovedInvoiceEmailDryRunInput,
} from '../application/prepareApprovedInvoiceEmailDryRun.js';
import type { ApprovedInvoiceEmailPreview } from '../application/approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
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

  it('marks an approved invoice as sent in the company scope', async () => {
    const sentInvoice = createApprovedInvoiceView({ status: 'sent' });
    const { app, getMarkSentInput } = createTestApp({
      sentInvoice,
    });

    const response = await app.request('/invoices/invoice-1/mark-sent', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({ invoice: sentInvoice });
    expect(response.status).toBe(200);
    expect(getMarkSentInput()).toMatchObject({
      actorUserId: 'dev-user',
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('prepares a dry-run invoice email in the company scope', async () => {
    const email = createApprovedInvoiceEmailPreview();
    const { app, getEmailInput } = createTestApp({ email });

    const response = await app.request('/invoices/invoice-1/email/dry-run', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({ email });
    expect(response.status).toBe(200);
    expect(getEmailInput()).toMatchObject({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('copies an approved invoice to a new draft in the company scope', async () => {
    const invoiceDraft = createInvoiceDraft();
    const { app, getCopyInput } = createTestApp({ copiedDraft: invoiceDraft });

    const response = await app.request('/invoices/invoice-1/copy-to-draft', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({ invoiceDraft });
    expect(response.status).toBe(201);
    expect(getCopyInput()).toMatchObject({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns a safe 404 when copying an invoice outside the company scope', async () => {
    const { app } = createTestApp({
      copyError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/copy-to-draft', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
    expect(response.status).toBe(404);
  });

  it('returns a safe 404 when marking an invoice sent outside the company scope', async () => {
    const { app } = createTestApp({
      markSentError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/mark-sent', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
    expect(response.status).toBe(404);
  });

  it('returns a safe 404 when preparing email for an invoice outside the company scope', async () => {
    const { app } = createTestApp({
      emailError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/email/dry-run', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
    expect(response.status).toBe(404);
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
  copiedDraft?: InvoiceDraft;
  copyError?: Error;
  document?: ApprovedInvoiceDocumentMetadata;
  email?: ApprovedInvoiceEmailPreview;
  emailError?: Error;
  error?: Error;
  invoice?: ApprovedInvoiceView;
  invoices?: ApprovedInvoiceSummary[];
  markSentError?: Error;
  pdfDocument?: ApprovedInvoicePdfDocumentFile;
  pdfError?: Error;
  sentInvoice?: ApprovedInvoiceView;
}) {
  let input: GetApprovedInvoiceInput | undefined;
  let copyInput: CopyApprovedInvoiceToDraftInput | undefined;
  let listInput: ListApprovedInvoicesInput | undefined;
  let reopenInput: ReopenApprovedInvoiceForEditingInput | undefined;
  let markSentInput: MarkApprovedInvoiceSentInput | undefined;
  let emailInput: PrepareApprovedInvoiceEmailDryRunInput | undefined;
  let generatePdfInput: GenerateApprovedInvoicePdfDocumentInput | undefined;
  let pdfInput: GetApprovedInvoicePdfDocumentInput | undefined;
  let pdfMetadataInput: GetApprovedInvoicePdfMetadataInput | undefined;
  const app = createApprovedInvoiceRoutes({
    async copyApprovedInvoiceToDraft(nextInput) {
      copyInput = nextInput;

      if (options.copyError !== undefined) {
        throw options.copyError;
      }

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.copiedDraft ?? createInvoiceDraft();
    },
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
    async markApprovedInvoiceSent(nextInput) {
      markSentInput = nextInput;

      if (options.markSentError !== undefined) {
        throw options.markSentError;
      }

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.sentInvoice ?? createApprovedInvoiceView({ status: 'sent' });
    },
    async prepareApprovedInvoiceEmailDryRun(nextInput) {
      emailInput = nextInput;

      if (options.emailError !== undefined) {
        throw options.emailError;
      }

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.email ?? createApprovedInvoiceEmailPreview();
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
    getCopyInput: () => copyInput,
    getEmailInput: () => emailInput,
    getInput: () => input,
    getListInput: () => listInput,
    getMarkSentInput: () => markSentInput,
    getPdfInput: () => pdfInput,
    getPdfMetadataInput: () => pdfMetadataInput,
    getReopenInput: () => reopenInput,
  };
}

function createApprovedInvoiceEmailPreview(): ApprovedInvoiceEmailPreview {
  return {
    attachment: {
      documentId: 'document-1',
      fileName: 'lasku-20260001.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 8,
    },
    body: 'Hei,\n\nLiitteenä lasku 20260001.',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    provider: 'dryRun',
    subject: 'Lasku 20260001',
    to: 'recipient@example.fi',
  };
}

function createInvoiceDraft(): InvoiceDraft {
  return {
    billingRecipientCustomerId: null,
    companyId: 'dev-company',
    createdAt: '2026-07-08T10:00:00.000Z',
    customerId: 'customer-1',
    deliveryAddressText: '',
    dueDate: '2026-07-22',
    id: 'draft-copy-1',
    invoiceDate: '2026-07-08',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 10000,
        code: 'WORK',
        description: 'Work',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 12550,
        id: 'line-1',
        netCents: 10000,
        position: 1,
        priceInputMode: 'net',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    note: '',
    orderNumber: '',
    paymentTermDays: 14,
    priceInputMode: 'net',
    reminderPeriodDays: 8,
    status: 'draft',
    subject: 'Copied invoice',
    totals: {
      grossTotalCents: 12550,
      netTotalCents: 10000,
      vatBreakdown: [
        {
          grossCents: 12550,
          netCents: 10000,
          vatCents: 2550,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2550,
    },
    updatedAt: '2026-07-08T10:00:00.000Z',
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

function createApprovedInvoiceSummary(
  overrides: Partial<ApprovedInvoiceSummary> = {},
): ApprovedInvoiceSummary {
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
    ...overrides,
  };
}

function createApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
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
    ...overrides,
  };
}
