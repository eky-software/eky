import { describe, expect, it } from 'vitest';

import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';
import { getApprovedInvoicePdfDocument } from './getApprovedInvoicePdfDocument.js';

describe('getApprovedInvoicePdfDocument', () => {
  it('returns metadata and file content for an existing PDF document', async () => {
    const metadata = createDocumentMetadata();
    const storage = new FakeInvoiceDocumentStorage(
      new Uint8Array([37, 80, 68, 70]),
    );

    await expect(
      getApprovedInvoicePdfDocument(
        { companyId: 'dev-company', invoiceId: 'invoice-1' },
        {
          invoiceDocumentRepository: new FakeInvoiceDocumentRepository(metadata),
          invoiceDocumentStorage: storage,
        },
      ),
    ).resolves.toEqual({
      content: new Uint8Array([37, 80, 68, 70]),
      metadata,
    });
  });

  it('throws a safe not-found error when metadata is missing', async () => {
    await expect(
      getApprovedInvoicePdfDocument(
        { companyId: 'dev-company', invoiceId: 'missing' },
        {
          invoiceDocumentRepository: new FakeInvoiceDocumentRepository(undefined),
          invoiceDocumentStorage: new FakeInvoiceDocumentStorage(
            new Uint8Array(),
          ),
        },
      ),
    ).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
  });

  it('throws a safe not-found error when the file is missing from storage', async () => {
    await expect(
      getApprovedInvoicePdfDocument(
        { companyId: 'dev-company', invoiceId: 'invoice-1' },
        {
          invoiceDocumentRepository: new FakeInvoiceDocumentRepository(
            createDocumentMetadata(),
          ),
          invoiceDocumentStorage: new FakeInvoiceDocumentStorage(undefined),
        },
      ),
    ).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
  });
});

class FakeInvoiceDocumentRepository implements InvoiceDocumentRepository {
  constructor(
    private readonly metadata: ApprovedInvoiceDocumentMetadata | undefined,
  ) {}

  async deleteDocumentsForInvoice(): Promise<string[]> {
    throw new Error('Not implemented in this get PDF document test.');
  }

  async findDocumentForInvoice(): Promise<
    ApprovedInvoiceDocumentMetadata | undefined
  > {
    return this.metadata;
  }

  async saveDocument(): Promise<ApprovedInvoiceDocumentMetadata> {
    throw new Error('Not implemented in this get PDF document test.');
  }
}

class FakeInvoiceDocumentStorage implements InvoiceDocumentStorage {
  constructor(private readonly content: Uint8Array | undefined) {}

  async deleteFile(): Promise<void> {
    throw new Error('Not implemented in this get PDF document test.');
  }

  async readFile(): Promise<Uint8Array> {
    if (this.content === undefined) {
      throw new Error('File missing.');
    }

    return this.content;
  }

  async writeFile(): Promise<void> {
    throw new Error('Not implemented in this get PDF document test.');
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
    sizeBytes: 4,
    createdAt: '2026-07-05T10:00:00.000Z',
  };
}
