import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceContentRevision } from '../domain/invoiceContentRevision.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import { loadCustomerInvoiceEmailDocument as load, type LoadCustomerInvoiceEmailDocumentDependencies } from './loadCustomerInvoiceEmailDocument.js';
import { createEmailDocument } from './loadInvoiceEmailDeliveryDocument.fixture.js';
import type { PreservedLegacyInvoiceDeliveryDocument } from './readPreservedLegacyInvoiceDocument.js';
import { createInvoiceRevisionPdfContentFixture } from './toInvoiceRevisionPdfContent.fixture.js';

function fixture(legacy = false) {
  const document = createEmailDocument();
  const current = {
    ...createInvoiceRevisionPdfContentFixture(), companyId: 'company-1', invoiceId: 'invoice-1', revisionId: 'revision-1',
  };
  const revision: InvoiceContentRevision = legacy
    ? { ...current, origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null }
    : current;
  const preserved: PreservedLegacyInvoiceDeliveryDocument = {
    content: document.content.slice(),
    metadata: { ...document.metadata, id: 'preserved-document', binding: { kind: 'preservedLegacy', sourceDocumentId: 'legacy-document' } },
    target: { companyId: 'company-1', invoiceId: 'invoice-1', kind: 'preservedLegacy', sourceDocumentId: 'legacy-document',
      documentId: 'preserved-document', sha256: document.metadata.sha256, sizeBytes: document.metadata.sizeBytes },
  };
  const input = {
    actorContext: createActorContext({ actorId: 'actor-1', companyId: 'company-1', authenticationMode: 'local', permissions: ['sendInvoices'] }),
    invoiceId: 'invoice-1', createdAt: '2026-10-06T12:00:00.000Z',
    documentTarget: legacy ? { kind: 'preservedLegacy' as const, documentId: preserved.metadata.id }
      : { kind: 'revision' as const, documentId: document.metadata.id },
  };
  const dependencies = {
    approvedInvoiceReader: { getApprovedInvoiceById: vi.fn(async () => ({ id: 'invoice-1', status: legacy ? 'sent' : 'approved' } as ApprovedInvoiceView)) },
    invoiceContentRevisionReader: { getCurrentRevision: vi.fn<LoadCustomerInvoiceEmailDocumentDependencies['invoiceContentRevisionReader']['getCurrentRevision']>().mockResolvedValue(revision) },
    loadInvoiceEmailDeliveryDocument: vi.fn(async () => document),
    readPreservedLegacyInvoiceDocument: vi.fn(async () => preserved),
  } satisfies LoadCustomerInvoiceEmailDocumentDependencies;
  return { input, dependencies, document, preserved, revision };
}

describe('customer SMTP exact document selection', () => {
  it('keeps normal delivery tied to the preview identity and current revision', async () => {
    const f = fixture();
    await expect(load(f.input, f.dependencies)).resolves.toEqual(f.document);
    expect(f.dependencies.loadInvoiceEmailDeliveryDocument).toHaveBeenCalledExactlyOnceWith({
      actorContext: f.input.actorContext,
      companyId: 'company-1', invoiceId: 'invoice-1', createdAt: f.input.createdAt,
    });
    expect(f.dependencies.invoiceContentRevisionReader.getCurrentRevision).toHaveBeenCalledTimes(2);
    expect(f.dependencies.readPreservedLegacyInvoiceDocument).not.toHaveBeenCalled();
  });

  it('reads only the named preserved copy when the backend selects legacy provenance', async () => {
    const f = fixture(true);
    await expect(load(f.input, f.dependencies)).resolves.toBe(f.preserved);
    expect(f.dependencies.readPreservedLegacyInvoiceDocument).toHaveBeenCalledExactlyOnceWith({
      actorContext: f.input.actorContext, invoiceId: f.input.invoiceId, documentId: f.input.documentTarget.documentId,
    });
    expect(f.dependencies.loadInvoiceEmailDeliveryDocument).not.toHaveBeenCalled();
  });

  it.each([false, true])('cannot select provenance from caller input (legacy=%s)', async legacy => {
    const f = fixture(legacy);
    await expect(load({ ...f.input, documentTarget: {
      kind: legacy ? 'revision' : 'preservedLegacy', documentId: f.input.documentTarget.documentId,
    } }, f.dependencies)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(f.dependencies.loadInvoiceEmailDeliveryDocument).not.toHaveBeenCalled();
    expect(f.dependencies.readPreservedLegacyInvoiceDocument).not.toHaveBeenCalled();
  });

  it.each(['preview', 'loadedRevision', 'reopened', 'reapproved'] as const)(
    'rejects a changed %s and clears the verified revision bytes', async changed => {
      const f = fixture();
      if (changed === 'preview') f.input.documentTarget.documentId = 'another-preview';
      if (changed === 'loadedRevision') f.dependencies.loadInvoiceEmailDeliveryDocument.mockResolvedValue({
        ...f.document, metadata: { ...f.document.metadata, binding: { kind: 'revision', revisionId: 'another-revision' } },
      });
      if (changed === 'reopened' || changed === 'reapproved') {
        f.dependencies.invoiceContentRevisionReader.getCurrentRevision.mockResolvedValueOnce(f.revision)
          .mockResolvedValueOnce(changed === 'reopened' ? undefined : { ...f.revision, revisionId: 'another-revision' });
      }
      await expect(load(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentPublicationConflictError);
      expect(f.document.content.every(byte => byte === 0)).toBe(true);
      expect(f.dependencies.readPreservedLegacyInvoiceDocument).not.toHaveBeenCalled();
    },
  );

  it('does not replace a missing or corrupt preserved copy with a revision document', async () => {
    const f = fixture(true);
    const failure = new InvoiceDocumentIntegrityError();
    f.dependencies.readPreservedLegacyInvoiceDocument.mockRejectedValue(failure);
    await expect(load(f.input, f.dependencies)).rejects.toBe(failure);
    expect(f.dependencies.loadInvoiceEmailDeliveryDocument).not.toHaveBeenCalled();
  });

  it('clears preserved bytes if the exact reader returns a different identity', async () => {
    const f = fixture(true);
    f.dependencies.readPreservedLegacyInvoiceDocument.mockResolvedValue({
      ...f.preserved, metadata: { ...f.preserved.metadata, id: 'different-document' },
    });
    await expect(load(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(f.preserved.content.every(byte => byte === 0)).toBe(true);
  });

  it('denies permission before reading backend provenance', async () => {
    const f = fixture();
    await expect(load({ ...f.input, actorContext: { ...f.input.actorContext, permissions: [] } }, f.dependencies))
      .rejects.toBeInstanceOf(AuthorizationError);
    expect(f.dependencies.invoiceContentRevisionReader.getCurrentRevision).not.toHaveBeenCalled();
    expect(f.dependencies.approvedInvoiceReader.getApprovedInvoiceById).not.toHaveBeenCalled();
  });

  it('does not load files when the company-scoped revision is absent', async () => {
    const f = fixture();
    f.dependencies.invoiceContentRevisionReader.getCurrentRevision.mockResolvedValue(undefined);
    await expect(load(f.input, f.dependencies)).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);
    expect(f.dependencies.loadInvoiceEmailDeliveryDocument).not.toHaveBeenCalled();
    expect(f.dependencies.readPreservedLegacyInvoiceDocument).not.toHaveBeenCalled();
  });
});
