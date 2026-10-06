import { describe, expect, it, vi } from 'vitest';

import type { StoredInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';
import { createDocumentMetadata } from './generateApprovedInvoicePdfDocument.fixture.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { readStoredInvoiceDocument } from './readStoredInvoiceDocument.js';

function fixture() {
  const document = createDocumentMetadata();
  const key = { companyId: document.companyId, invoiceId: document.invoiceId, documentId: document.id };
  const content = new TextEncoder().encode('%PDF-synthetic');
  const findDocumentById = vi.fn<InvoiceDocumentRepository['findDocumentById']>().mockResolvedValue(document);
  const readVerifiedDocument = vi.fn(async () => content);
  return {
    document, key, content, findDocumentById, readVerifiedDocument,
    dependencies: {
      invoiceDocumentRepository: { findDocumentById },
      invoiceDocumentStorage: { readVerifiedDocument },
    },
  };
}

describe('readStoredInvoiceDocument', () => {
  it.each<StoredInvoiceDocumentMetadata>([
    { ...createDocumentMetadata(), binding: { kind: 'revision', revisionId: 'exact-revision' } },
    { ...createDocumentMetadata(), binding: { kind: 'legacyOriginal' } },
    { ...createDocumentMetadata(), binding: { kind: 'preservedLegacy', sourceDocumentId: 'exact-source' } },
  ])('reads exact $binding.kind evidence without generation or sending', async (document) => {
    const f = fixture();
    f.findDocumentById.mockResolvedValue(document);
    const result = await readStoredInvoiceDocument(f.key, f.dependencies);
    expect(f.findDocumentById).toHaveBeenCalledExactlyOnceWith(f.key);
    expect(f.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(document);
    expect(result.content).toBe(f.content);
    expect(result.metadata).toEqual(document);
  });

  it('returns not-found only when scoped metadata is absent', async () => {
    const f = fixture();
    f.findDocumentById.mockResolvedValue(undefined);
    await expect(readStoredInvoiceDocument(f.key, f.dependencies)).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it.each(['companyId', 'invoiceId', 'id'] as const)('rejects a mismatched %s before reading bytes', async (field) => {
    const f = fixture();
    f.findDocumentById.mockResolvedValue({ ...f.document, [field]: 'another-identity' });
    await expect(readStoredInvoiceDocument(f.key, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it.each(['companyId', 'invoiceId', 'documentId'] as const)('validates %s before querying', async (field) => {
    const f = fixture();
    await expect(readStoredInvoiceDocument({ ...f.key, [field]: ' ' }, f.dependencies)).rejects.toThrow();
    expect(f.findDocumentById).not.toHaveBeenCalled();
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it('preserves metadata failure instead of disguising it as a missing file', async () => {
    const f = fixture();
    f.findDocumentById.mockRejectedValue(new InvoiceDocumentIntegrityError());
    await expect(readStoredInvoiceDocument(f.key, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it('returns a safe integrity error for unreadable or inconsistent stored bytes', async () => {
    const f = fixture();
    const error = new Error('synthetic-secret /private/synthetic/path');
    f.readVerifiedDocument.mockRejectedValue(error);
    const failure = await readStoredInvoiceDocument(f.key, f.dependencies).catch((value: unknown) => value);
    expect(failure).toEqual(new InvoiceDocumentIntegrityError());
    expect(failure).not.toHaveProperty('cause');
    expect(String(failure)).not.toContain(error.message);
    expect(f.findDocumentById).toHaveBeenCalledTimes(1);
  });
});
