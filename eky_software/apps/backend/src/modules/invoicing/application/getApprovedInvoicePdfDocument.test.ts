import { describe, expect, it, vi } from 'vitest';

import type { InvoiceDocumentPreviewReader } from '../ports/invoiceDocumentPreviewReader.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';
import { createDocumentMetadata } from './generateApprovedInvoicePdfDocument.fixture.js';
import { getApprovedInvoicePdfDocument } from './getApprovedInvoicePdfDocument.js';
import { getApprovedInvoicePdfMetadata } from './getApprovedInvoicePdfMetadata.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentReadConflictError } from './invoiceDocumentReadConflictError.js';

function fixture() {
  const document = createDocumentMetadata();
  const input = { companyId: document.companyId, invoiceId: document.invoiceId };
  const content = new TextEncoder().encode('%PDF-synthetic');
  const findPreviewDocumentId = vi.fn<InvoiceDocumentPreviewReader['findPreviewDocumentId']>().mockResolvedValue(document.id);
  const findDocumentById = vi.fn<InvoiceDocumentRepository['findDocumentById']>().mockResolvedValue(document);
  const readVerifiedDocument = vi.fn(async () => content);
  return {
    document, input, content, findPreviewDocumentId, findDocumentById, readVerifiedDocument,
    dependencies: {
      invoiceDocumentPreviewReader: { findPreviewDocumentId },
      invoiceDocumentRepository: { findDocumentById },
      invoiceDocumentStorage: { readVerifiedDocument },
    },
  };
}

describe.each([
  ['file', getApprovedInvoicePdfDocument],
  ['metadata', getApprovedInvoicePdfMetadata],
] as const)('approved invoice PDF %s', (kind, read) => {
  it('reads exact metadata and verified bytes, then rechecks the preview selection', async () => {
    const f = fixture();
    const result = await read(f.input, f.dependencies);
    expect(result).toEqual(kind === 'file' ? { metadata: f.document, content: f.content } : f.document);
    expect(f.findDocumentById).toHaveBeenCalledExactlyOnceWith({ ...f.input, documentId: f.document.id });
    expect(f.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(f.document);
    expect(f.findPreviewDocumentId.mock.calls).toEqual([[f.input], [f.input]]);
    expect(f.findPreviewDocumentId.mock.invocationCallOrder[1]).toBeGreaterThan(f.readVerifiedDocument.mock.invocationCallOrder[0]!);
  });

  it('keeps the not-found result for an absent scoped preview', async () => {
    const f = fixture();
    f.findPreviewDocumentId.mockResolvedValue(undefined);
    await expect(read(f.input, f.dependencies)).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
    expect(f.findDocumentById).not.toHaveBeenCalled();
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it('does not treat a broken selected reference as an absent PDF', async () => {
    const f = fixture();
    f.findDocumentById.mockResolvedValue(undefined);
    await expect(read(f.input, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it.each([undefined, 'newer-document'])('rejects a changed selection after the file read (%s)', async (next) => {
    const f = fixture();
    f.findPreviewDocumentId.mockResolvedValueOnce(f.document.id).mockResolvedValueOnce(next);
    await expect(read(f.input, f.dependencies)).rejects.toEqual(new InvoiceDocumentReadConflictError());
    expect(f.readVerifiedDocument).toHaveBeenCalledTimes(1);
    expect(f.findDocumentById).toHaveBeenCalledTimes(1);
  });

  it('preserves a byte failure without fallback, removal or regeneration', async () => {
    const f = fixture();
    f.readVerifiedDocument.mockRejectedValue(new Error('private-synthetic-storage-error'));
    await expect(read(f.input, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(f.findPreviewDocumentId).toHaveBeenCalledTimes(1);
    expect(f.findDocumentById).toHaveBeenCalledTimes(1);
  });

  it.each(['companyId', 'invoiceId'] as const)('validates %s before selection', async (field) => {
    const f = fixture();
    await expect(read({ ...f.input, [field]: ' ' }, f.dependencies)).rejects.toThrow();
    expect(f.findPreviewDocumentId).not.toHaveBeenCalled();
    expect(f.findDocumentById).not.toHaveBeenCalled();
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });
});
