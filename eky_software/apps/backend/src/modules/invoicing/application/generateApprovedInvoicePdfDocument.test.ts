import { describe, expect, it } from 'vitest';

import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  generateApprovedInvoicePdfDocument,
} from './generateApprovedInvoicePdfDocument.js';

describe('generateApprovedInvoicePdfDocument', () => {
  it('renders an approved invoice PDF, writes it to storage, and stores metadata', async () => {
    const dependencies = createDependencies();

    const metadata = await generateApprovedInvoicePdfDocument(
      createInput(),
      dependencies,
    );

    expect(metadata).toMatchObject({
      companyId: 'dev-company',
      documentType: 'approved_invoice_pdf',
      fileName: 'lasku-20260001.pdf',
      invoiceId: 'invoice-1',
      mimeType: 'application/pdf',
      sizeBytes: 8,
      storagePath: 'dev-company/invoice-1/approved-invoice.pdf',
    });
    expect(metadata.sha256).toBe(
      '9d26fb5bd7159f32638ed3f1b58e2cd5c375e2febbaa863b3c09df778fa39704',
    );
    expect(dependencies.repository.savedDocuments).toEqual([metadata]);
    expect(dependencies.storage.writes).toEqual([
      {
        content: new Uint8Array([37, 80, 68, 70, 45, 116, 101, 115]),
        storagePath: 'dev-company/invoice-1/approved-invoice.pdf',
      },
    ]);
  });

  it('returns existing metadata without rendering or writing a duplicate PDF', async () => {
    const existingDocument = createDocumentMetadata();
    const dependencies = createDependencies({
      existingDocument,
    });

    await expect(
      generateApprovedInvoicePdfDocument(createInput(), dependencies),
    ).resolves.toEqual(existingDocument);

    expect(dependencies.renderCalls).toBe(0);
    expect(dependencies.storage.reads).toEqual([
      'dev-company/invoice-1/approved-invoice.pdf',
    ]);
    expect(dependencies.storage.writes).toEqual([]);
    expect(dependencies.repository.savedDocuments).toEqual([]);
  });

  it('uses a credit invoice filename for a credit snapshot', async () => {
    const dependencies = createDependencies({
      invoice: {
        ...createApprovedInvoiceView(),
        creditedInvoiceId: 'source-invoice-1',
        creditedInvoiceNumber: '20260001',
        creditedInvoiceDate: '2026-07-01',
        invoiceKind: 'credit',
        invoiceNumber: '20260002',
      },
    });

    const metadata = await generateApprovedInvoicePdfDocument(
      createInput(),
      dependencies,
    );

    expect(metadata.fileName).toBe('hyvityslasku-20260002.pdf');
  });

  it('regenerates the PDF when metadata exists but the local file is missing', async () => {
    const existingDocument = createDocumentMetadata();
    const dependencies = createDependencies({
      existingDocument,
      missingStoragePaths: [existingDocument.storagePath],
    });

    const metadata = await generateApprovedInvoicePdfDocument(
      createInput(),
      dependencies,
    );

    expect(metadata.id).not.toBe(existingDocument.id);
    expect(dependencies.repository.deletedDocuments).toEqual([
      {
        companyId: 'dev-company',
        documentType: 'approved_invoice_pdf',
        invoiceId: 'invoice-1',
      },
    ]);
    expect(dependencies.renderCalls).toBe(1);
    expect(dependencies.storage.writes).toHaveLength(1);
  });

  it('throws a safe not-found error when the approved invoice is not available', async () => {
    const dependencies = createDependencies({
      invoice: null,
    });

    await expect(
      generateApprovedInvoicePdfDocument(createInput(), dependencies),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());
  });
});

function createInput() {
  return {
    companyId: 'dev-company',
    createdAt: '2026-07-05T10:00:00.000Z',
    invoiceId: 'invoice-1',
  };
}

function createDependencies(options: {
  existingDocument?: ApprovedInvoiceDocumentMetadata;
  invoice?: ApprovedInvoiceView | null;
  missingStoragePaths?: string[];
} = {}) {
  const repository = new FakeInvoiceDocumentRepository(options.existingDocument);
  const storage = new FakeInvoiceDocumentStorage(options.missingStoragePaths);
  const invoice =
    'invoice' in options ? options.invoice : createApprovedInvoiceView();
  const reader = new FakeApprovedInvoiceReader(invoice);
  let renderCalls = 0;

  return {
    approvedInvoiceReader: reader,
    get renderCalls() {
      return renderCalls;
    },
    invoiceDocumentRepository: repository,
    invoiceDocumentStorage: storage,
    repository,
    async renderApprovedInvoicePdf(): Promise<Uint8Array> {
      renderCalls += 1;

      return new Uint8Array([37, 80, 68, 70, 45, 116, 101, 115]);
    },
    storage,
  };
}

class FakeApprovedInvoiceReader implements ApprovedInvoiceReader {
  constructor(private readonly invoice: ApprovedInvoiceView | null | undefined) {}

  async getApprovedInvoiceById(): Promise<ApprovedInvoiceView | undefined> {
    return this.invoice ?? undefined;
  }

  async listApprovedInvoiceSummaries(): Promise<never> {
    throw new Error('Not implemented in this PDF document test.');
  }
}

class FakeInvoiceDocumentRepository implements InvoiceDocumentRepository {
  deletedDocuments: Array<{
    companyId: string;
    documentType: string;
    invoiceId: string;
  }> = [];
  savedDocuments: ApprovedInvoiceDocumentMetadata[] = [];

  constructor(
    private readonly existingDocument: ApprovedInvoiceDocumentMetadata | undefined,
  ) {}

  async deleteDocumentsForInvoice(
    companyId: string,
    invoiceId: string,
    documentType: 'approved_invoice_pdf',
  ): Promise<string[]> {
    this.deletedDocuments.push({ companyId, documentType, invoiceId });

    return [createDocumentMetadata().storagePath];
  }

  async findDocumentForInvoice(): Promise<
    ApprovedInvoiceDocumentMetadata | undefined
  > {
    return this.existingDocument;
  }

  async saveDocument(
    metadata: ApprovedInvoiceDocumentMetadata,
  ): Promise<ApprovedInvoiceDocumentMetadata> {
    this.savedDocuments.push(metadata);

    return metadata;
  }
}

class FakeInvoiceDocumentStorage implements InvoiceDocumentStorage {
  reads: string[] = [];
  writes: Array<{ content: Uint8Array; storagePath: string }> = [];

  constructor(private readonly missingStoragePaths: string[] = []) {}

  async deleteFile(): Promise<void> {
    throw new Error('Not implemented in this PDF document test.');
  }

  async readFile(storagePath: string): Promise<Uint8Array> {
    this.reads.push(storagePath);

    if (this.missingStoragePaths.includes(storagePath)) {
      throw new Error('Missing test file.');
    }

    return new Uint8Array([37, 80, 68, 70]);
  }

  async writeFile(storagePath: string, content: Uint8Array): Promise<void> {
    this.writes.push({ content, storagePath });
  }
}

function createDocumentMetadata(): ApprovedInvoiceDocumentMetadata {
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

function createApprovedInvoiceView(): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    companyId: 'dev-company',
    sourceDraftId: 'draft-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
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
    companyEmailSnapshot: 'office@example.fi',
    companyPhoneSnapshot: '040 000 0000',
    companyWebsiteSnapshot: 'www.example-builder.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyBicSnapshot: 'NDEAFIHH',
    companyBankNameSnapshot: 'Test Bank',
    billingRecipientCustomerId: null,
    billingRecipientCustomerNumberSnapshot: '1001',
    billingRecipientNameSnapshot: 'Example Customer Oy',
    billingRecipientBusinessIdSnapshot: '1234567-8',
    billingRecipientCustomerTypeSnapshot: 'company',
    billingRecipientEmailSnapshot: 'customer@example.fi',
    billingRecipientPhoneSnapshot: '040 111 2222',
    billingRecipientStreetAddressSnapshot: 'Customer Street 1',
    billingRecipientPostalCodeSnapshot: '00100',
    billingRecipientCitySnapshot: 'Helsinki',
    invoiceDate: '2026-07-05',
    dueDate: '2026-07-19',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    taxTreatment: 'normalVat',
    taxTreatmentLabelSnapshot: '',
    taxLegalBasisSnapshot: '',
    performancePeriod: { type: 'invoiceDate' },
    refundIbanSnapshot: '',
    subject: 'Test invoice',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    lines: [],
    totals: {
      netTotalCents: 0,
      vatBreakdown: [],
      vatTotalCents: 0,
      grossTotalCents: 0,
    },
    vatBreakdown: [],
    createdAt: '2026-07-05T10:00:00.000Z',
    approvedAt: '2026-07-05T10:00:00.000Z',
    updatedAt: '2026-07-05T10:00:00.000Z',
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
  };
}
