import { describe, expect, it, vi } from 'vitest';
import type { StoredInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { loadInvoiceEmailDeliveryDocument, type LoadInvoiceEmailDeliveryDocumentDependencies } from './loadInvoiceEmailDeliveryDocument.js';
import { createEmailDocument } from './loadInvoiceEmailDeliveryDocument.fixture.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';

function fixture() {
  const document = createEmailDocument();
  const input = { companyId: 'company-1', invoiceId: 'invoice-1', createdAt: '2026-10-05T12:00:00.000Z' };
  const dependencies = {
    ensureApprovedInvoicePdfDocument: vi.fn<LoadInvoiceEmailDeliveryDocumentDependencies['ensureApprovedInvoicePdfDocument']>().mockResolvedValue(document.metadata),
    readStoredInvoiceDocument: vi.fn<LoadInvoiceEmailDeliveryDocumentDependencies['readStoredInvoiceDocument']>().mockResolvedValue(document),
  };
  return { document, input, dependencies };
}

describe('loadInvoiceEmailDeliveryDocument', () => {
  it('reads the generated exact ID and preserves its verified buffer and revision target', async () => {
    const f = fixture();
    const result = await loadInvoiceEmailDeliveryDocument(f.input, f.dependencies);
    expect(f.dependencies.ensureApprovedInvoicePdfDocument).toHaveBeenCalledExactlyOnceWith(f.input);
    expect(f.dependencies.readStoredInvoiceDocument).toHaveBeenCalledExactlyOnceWith({ companyId: 'company-1', invoiceId: 'invoice-1', documentId: 'document-1' });
    expect(result).toEqual(f.document);
    expect(result.content).toBe(f.document.content);
    expect(result.content.some(value => value !== 0)).toBe(true);
  });

  it.each(['companyId', 'invoiceId'] as const)('rejects a generated wrong %s before reading', async (field) => {
    const f = fixture();
    f.dependencies.ensureApprovedInvoicePdfDocument.mockResolvedValue({ ...f.document.metadata, [field]: 'other' });
    await expect(loadInvoiceEmailDeliveryDocument(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(f.dependencies.readStoredInvoiceDocument).not.toHaveBeenCalled();
  });

  it.each<Partial<StoredInvoiceDocumentMetadata>>([
    { companyId: 'other' }, { invoiceId: 'other' }, { id: 'other' },
    { binding: { kind: 'revision', revisionId: 'other' } },
    { binding: { kind: 'legacyOriginal' } },
    { binding: { kind: 'preservedLegacy', sourceDocumentId: 'source' } },
    { sha256: 'f'.repeat(64) }, { sizeBytes: 99 }, { storagePath: 'other.pdf' },
    { fileName: 'other.pdf' },
  ])('rejects changed exact metadata and clears only the read buffer: %j', async (change) => {
    const f = fixture();
    f.dependencies.readStoredInvoiceDocument.mockResolvedValue({
      content: f.document.content,
      metadata: { ...f.document.metadata, ...change } as StoredInvoiceDocumentMetadata,
    });
    await expect(loadInvoiceEmailDeliveryDocument(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(f.document.content.every(value => value === 0)).toBe(true);
    expect(f.dependencies.ensureApprovedInvoicePdfDocument).toHaveBeenCalledTimes(1);
    expect(f.dependencies.readStoredInvoiceDocument).toHaveBeenCalledTimes(1);
  });

  it('preserves the exact-reader failure without regeneration or fallback', async () => {
    const f = fixture();
    const error = new InvoiceDocumentIntegrityError();
    f.dependencies.readStoredInvoiceDocument.mockRejectedValue(error);
    await expect(loadInvoiceEmailDeliveryDocument(f.input, f.dependencies)).rejects.toBe(error);
    expect(f.dependencies.ensureApprovedInvoicePdfDocument).toHaveBeenCalledTimes(1);
    expect(f.dependencies.readStoredInvoiceDocument).toHaveBeenCalledTimes(1);
  });
});
