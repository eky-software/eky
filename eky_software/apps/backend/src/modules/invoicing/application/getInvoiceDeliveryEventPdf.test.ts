import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';
import { createDocumentMetadata } from './generateApprovedInvoicePdfDocument.fixture.js';
import { getInvoiceDeliveryEventPdf } from './getInvoiceDeliveryEventPdf.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';

function fixture() {
  const document = createDocumentMetadata();
  const actorContext = createActorContext({
    actorId: 'synthetic-actor', companyId: document.companyId, authenticationMode: 'local', permissions: ['sendInvoices'],
  });
  const input = { actorContext, invoiceId: document.invoiceId, eventId: 'exact-event' };
  const content = new TextEncoder().encode('%PDF-synthetic');
  const findEventDocument = vi.fn<InvoiceDeliveryEventReader['findEventDocument']>()
    .mockResolvedValue({ kind: 'document', document });
  const readVerifiedDocument = vi.fn(async () => content);
  return { document, input, content, findEventDocument, readVerifiedDocument, dependencies: {
    invoiceDeliveryEventReader: { findEventDocument }, invoiceDocumentStorage: { readVerifiedDocument },
  } };
}

describe('getInvoiceDeliveryEventPdf', () => {
  it('returns only the exact event document through permission and company scope', async () => {
    const f = fixture();
    await expect(getInvoiceDeliveryEventPdf(f.input, f.dependencies)).resolves.toEqual({
      kind: 'document', file: { content: f.content, metadata: f.document },
    });
    expect(f.findEventDocument).toHaveBeenCalledExactlyOnceWith({
      companyId: f.document.companyId, invoiceId: f.document.invoiceId,
    }, f.input.eventId);
    expect(f.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(f.document);
  });

  it('denies access before metadata or bytes are read', async () => {
    const f = fixture();
    const actorContext = createActorContext({
      actorId: 'synthetic-actor', companyId: f.document.companyId, authenticationMode: 'local', permissions: [],
    });
    await expect(getInvoiceDeliveryEventPdf({ ...f.input, actorContext }, f.dependencies)).rejects.toBeInstanceOf(AuthorizationError);
    expect(f.findEventDocument).not.toHaveBeenCalled();
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it.each(['invoiceId', 'eventId'] as const)('validates %s before lookup', async (field) => {
    const f = fixture();
    for (const value of [' ', 'x'.repeat(201)]) {
      await expect(getInvoiceDeliveryEventPdf({ ...f.input, [field]: value }, f.dependencies)).rejects.toThrow();
    }
    expect(f.findEventDocument).not.toHaveBeenCalled();
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it('keeps a historical null distinct from a nonexistent event', async () => {
    const f = fixture();
    f.findEventDocument.mockResolvedValueOnce({ kind: 'legacyMissingDocument' }).mockResolvedValueOnce(undefined);
    await expect(getInvoiceDeliveryEventPdf(f.input, f.dependencies)).resolves.toEqual({ kind: 'legacyMissingDocument' });
    await expect(getInvoiceDeliveryEventPdf(f.input, f.dependencies)).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it.each(['companyId', 'invoiceId'] as const)('rejects a mismatched %s before bytes are read', async (field) => {
    const f = fixture();
    f.findEventDocument.mockResolvedValue({ kind: 'document', document: { ...f.document, [field]: 'other-scope' } });
    await expect(getInvoiceDeliveryEventPdf(f.input, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it('preserves reference corruption as an integrity error', async () => {
    const f = fixture();
    f.findEventDocument.mockRejectedValue(new InvoiceDocumentIntegrityError());
    await expect(getInvoiceDeliveryEventPdf(f.input, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(f.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it('does not expose private storage errors or regenerate missing bytes', async () => {
    const f = fixture();
    f.readVerifiedDocument.mockRejectedValue(new Error('synthetic-secret /private/path'));
    const error: unknown = await getInvoiceDeliveryEventPdf(f.input, f.dependencies).catch((error: unknown) => error);
    expect(error).toEqual(new InvoiceDocumentIntegrityError());
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('synthetic-secret');
  });
});
