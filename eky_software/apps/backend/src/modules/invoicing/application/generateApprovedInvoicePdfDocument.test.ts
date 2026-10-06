import { createHash } from 'node:crypto';
import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';

import { describe, expect, it } from 'vitest';

import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  createControlledPromise,
  createCurrentInput,
  createDocumentMetadata,
  createPdfGeneratorFixture,
  createRevisionInput,
} from './generateApprovedInvoicePdfDocument.fixture.js';
import { generateApprovedInvoicePdfDocument } from './generateApprovedInvoicePdfDocument.js';
import { InvoiceContentRevisionIntegrityError } from './invoiceContentRevisionIntegrityError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import {
  createCreditRevisionPdfContentFixture,
  createInvoiceRevisionPdfContentFixture,
} from './toInvoiceRevisionPdfContent.fixture.js';

describe('generateApprovedInvoicePdfDocument', () => {
  it.each(['absent', 'denied', 'foreign'] as const)('does not promote legacy content with %s authorization', async mode => {
    const revision = {
      ...createInvoiceRevisionPdfContentFixture(),
      origin: 'legacySnapshot' as const, vatBreakdownState: 'unavailable' as const, vatBreakdown: null,
    };
    const fixture = createPdfGeneratorFixture(revision);
    const input = createCurrentInput(revision);
    const actorContext = createActorContext({
      actorId: 'actor-1', authenticationMode: 'local',
      companyId: mode === 'foreign' ? 'foreign-company' : revision.companyId,
      permissions: mode === 'denied' ? [] : ['sendInvoices'],
    });
    await expect(generateApprovedInvoicePdfDocument(
      mode === 'absent' ? input : { ...input, actorContext }, fixture.dependencies,
    )).rejects.toBeInstanceOf(AuthorizationError);
    expect(fixture.dependencies.invoiceLegacyRevisionPromoter.promoteLegacyRevisionIfCurrent).not.toHaveBeenCalled();
    expect(fixture.reader.getRevision).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'standard', createRevision: createInvoiceRevisionPdfContentFixture, fileName: 'lasku-20261001.pdf' },
    { kind: 'credit', createRevision: createCreditRevisionPdfContentFixture, fileName: 'hyvityslasku-20261001.pdf' },
  ])('publishes the exact immutable $kind source without recalculating VAT', async ({ kind, createRevision, fileName }) => {
    const revision = createRevision();
    const before = structuredClone(revision);
    revision.lines.forEach(Object.freeze);
    revision.vatBreakdown.forEach(Object.freeze);
    Object.freeze(revision.lines);
    Object.freeze(revision.vatBreakdown);
    Object.freeze(revision);
    const fixture = createPdfGeneratorFixture(revision);
    // The wrapper selects a key; the exact reader supplies rendering content.
    fixture.reader.getCurrentRevision.mockResolvedValue({
      ...revision,
      companyNameSnapshot: 'Different current projection',
      note: 'Must not be rendered',
      totalVatCents: 999,
    });
    const input = createCurrentInput(revision);
    const { key } = createRevisionInput(revision);

    const metadata = await generateApprovedInvoicePdfDocument(input, fixture.dependencies);

    expect(fixture.reader.getCurrentRevision).toHaveBeenCalledExactlyOnceWith({
      companyId: key.companyId, invoiceId: key.invoiceId,
    });
    expect(fixture.reader.getRevision).toHaveBeenCalledExactlyOnceWith(key);
    expect(fixture.repository.findDocumentForRevision).toHaveBeenCalledExactlyOnceWith(key);
    expect(fixture.renderApprovedInvoicePdf).toHaveBeenCalledOnce();
    const content = fixture.renderApprovedInvoicePdf.mock.calls[0]![0];
    expect(content).toMatchObject({
      invoiceKind: kind,
      invoiceNumber: '20261001',
      companyNameSnapshot: 'Example Seller Oy',
      customerNameSnapshot: 'Example Customer Oy',
      billingRecipientNameSnapshot: 'Example Recipient Oy',
      note: '  Snapshot note\nSecond line  ',
      performancePeriod: { type: 'singleDate', date: '2026-09-29' },
    });
    expect(content.vatBreakdown).toStrictEqual(before.vatBreakdown);
    expect(content.totals).toStrictEqual(kind === 'credit'
      ? { netTotalCents: 67, vatTotalCents: 18, grossTotalCents: 85 }
      : { netTotalCents: 104, vatTotalCents: 15, grossTotalCents: 119 });
    expect(content.lines.map(({ netCents, grossCents }) => ({ netCents, grossCents })))
      .toStrictEqual(kind === 'credit'
        ? [{ netCents: 67, grossCents: 85 }]
        : [{ netCents: 2, grossCents: 3 }, { netCents: 2, grossCents: 3 }, { netCents: 100, grossCents: 114 }]);
    expect(content.referenceNumber).toBe(kind === 'credit' ? '' : '202610010');
    expect(content.creditedInvoiceNumber).toBe(kind === 'credit' ? '20260991' : null);
    expect(content.creditedInvoiceDate).toBe(kind === 'credit' ? '2026-09-01' : null);
    for (const field of ['companyId', 'invoiceId', 'revisionId', 'status', 'paymentState', 'cancelledAt']) {
      expect(content).not.toHaveProperty(field);
    }
    expect(revision).toStrictEqual(before);
    expect(fixture.storage.writeCandidate).toHaveBeenCalledExactlyOnceWith({
      scope: key, documentId: metadata.id, content: fixture.pdf,
    });
    expect(fixture.storage.writeCandidate.mock.calls[0]![0].content).toBe(fixture.pdf);
    expect(metadata).toStrictEqual({
      id: expect.any(String), companyId: key.companyId, invoiceId: key.invoiceId,
      binding: { kind: 'revision', revisionId: key.revisionId },
      documentType: 'approved_invoice_pdf', mimeType: 'application/pdf',
      fileName, createdAt: input.createdAt,
      storagePath: `${key.companyId}/${key.invoiceId}/${metadata.id}.pdf`,
      sha256: createHash('sha256').update(fixture.pdf).digest('hex'),
      sizeBytes: fixture.pdf.byteLength,
    });
    expect(fixture.repository.publishDocumentIfCurrent).toHaveBeenCalledExactlyOnceWith({
      key,
      candidate: {
        id: metadata.id, createdAt: input.createdAt, fileName,
        storagePath: metadata.storagePath, sha256: metadata.sha256, sizeBytes: metadata.sizeBytes,
      },
    });
    expect(fixture.retainedCandidates.get(metadata.id)).toStrictEqual(fixture.pdf);
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.publishPreservedLegacyDocument).not.toHaveBeenCalled();
  });

  it('does not read an exact revision when the scoped current invoice is missing', async () => {
    const fixture = createPdfGeneratorFixture();
    fixture.reader.getCurrentRevision.mockResolvedValue(undefined);

    await expect(generateApprovedInvoicePdfDocument(createCurrentInput(), fixture.dependencies))
      .rejects.toEqual(new ApprovedInvoiceNotFoundError());

    expect(fixture.reader.getRevision).not.toHaveBeenCalled();
    expect(fixture.repository.findDocumentForRevision).not.toHaveBeenCalled();
    expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
  });

  it.each(['companyId', 'invoiceId'] as const)('rejects a current source with foreign %s', async (field) => {
    const fixture = createPdfGeneratorFixture();
    fixture.reader.getCurrentRevision.mockResolvedValue({
      ...createInvoiceRevisionPdfContentFixture(), [field]: 'foreign-scope',
    });

    await expect(generateApprovedInvoicePdfDocument(createCurrentInput(), fixture.dependencies))
      .rejects.toEqual(new InvoiceContentRevisionIntegrityError());

    expect(fixture.reader.getRevision).not.toHaveBeenCalled();
    expect(fixture.repository.findDocumentForRevision).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'standard', createRevision: createInvoiceRevisionPdfContentFixture },
    { kind: 'credit', createRevision: createCreditRevisionPdfContentFixture },
  ])('verifies cached $kind bytes before the read-only current eligibility check', async ({ createRevision }) => {
    const revision = createRevision();
    const fixture = createPdfGeneratorFixture(revision);
    const { key } = createRevisionInput(revision);
    const existing = createDocumentMetadata(key);
    const verificationStarted = createControlledPromise<void>();
    const verificationFinished = createControlledPromise<Uint8Array>();
    fixture.repository.findDocumentForRevision.mockResolvedValue(existing);
    fixture.repository.findCurrentDocumentForRevision.mockResolvedValue(existing);
    fixture.storage.readVerifiedDocument.mockImplementation(() => {
      verificationStarted.resolve();
      return verificationFinished.promise;
    });

    const pending = generateApprovedInvoicePdfDocument(createCurrentInput(revision), fixture.dependencies);
    try {
      await verificationStarted.promise;
      expect(fixture.repository.findCurrentDocumentForRevision).not.toHaveBeenCalled();
      expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    } finally {
      verificationFinished.resolve(fixture.pdf);
      await pending;
    }

    expect(await pending).toBe(existing);
    expect(fixture.storage.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(existing);
    expect(fixture.repository.findCurrentDocumentForRevision).toHaveBeenCalledExactlyOnceWith(key);
    expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    expect(fixture.repository.publishPreservedLegacyDocument).not.toHaveBeenCalled();
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
  });

  it.each([
    { fault: 'missing file', error: new Error('Synthetic missing PDF.') },
    { fault: 'corrupt bytes', error: new InvoiceDocumentIntegrityError() },
  ])('retains a cached document with $fault without regeneration', async ({ error }) => {
    const fixture = createPdfGeneratorFixture();
    const existing = createDocumentMetadata();
    const before = structuredClone(existing);
    fixture.repository.findDocumentForRevision.mockResolvedValue(existing);
    fixture.storage.readVerifiedDocument.mockRejectedValue(error);

    await expect(generateApprovedInvoicePdfDocument(createCurrentInput(), fixture.dependencies))
      .rejects.toBe(error);

    expect(existing).toStrictEqual(before);
    expect(fixture.storage.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(existing);
    expect(fixture.repository.findCurrentDocumentForRevision).not.toHaveBeenCalled();
    expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
  });

  it('retains verified cached history when it is no longer current', async () => {
    const fixture = createPdfGeneratorFixture();
    const existing = createDocumentMetadata();
    fixture.repository.findDocumentForRevision.mockResolvedValue(existing);

    await expect(generateApprovedInvoicePdfDocument(createCurrentInput(), fixture.dependencies))
      .rejects.toMatchObject({
        name: 'InvoiceDocumentPublicationConflictError', candidateCleanupFailed: false,
        message: new InvoiceDocumentPublicationConflictError().message,
      });

    expect(fixture.storage.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(existing);
    expect(fixture.repository.findCurrentDocumentForRevision).toHaveBeenCalledExactlyOnceWith(createRevisionInput().key);
    expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
  });

  it.each([
    { companyId: 'foreign-company' },
    { invoiceId: 'foreign-invoice' },
    { binding: { kind: 'revision', revisionId: 'foreign-revision' } },
    { binding: { kind: 'legacyOriginal' } },
  ])('rejects a foreign cache binding before reading its file: %j', async (overrides) => {
    const fixture = createPdfGeneratorFixture();
    fixture.repository.findDocumentForRevision.mockResolvedValue({
      ...createDocumentMetadata(), ...overrides,
    } as RevisionInvoiceDocumentMetadata);

    await expect(generateApprovedInvoicePdfDocument(createCurrentInput(), fixture.dependencies))
      .rejects.toEqual(new InvoiceDocumentIntegrityError());

    expect(fixture.storage.readVerifiedDocument).not.toHaveBeenCalled();
    expect(fixture.repository.findCurrentDocumentForRevision).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'other-document' },
    { storagePath: 'other-document.pdf' },
    { sha256: 'b'.repeat(64) },
    { sizeBytes: 101 },
    { companyId: 'foreign-company' },
    { invoiceId: 'foreign-invoice' },
    { binding: { kind: 'revision' as const, revisionId: 'other-revision' } },
  ])('does not return current metadata differing from the verified document: %j', async (overrides) => {
    const fixture = createPdfGeneratorFixture();
    const existing = createDocumentMetadata();
    fixture.repository.findDocumentForRevision.mockResolvedValue(existing);
    fixture.repository.findCurrentDocumentForRevision.mockResolvedValue({ ...existing, ...overrides });

    await expect(generateApprovedInvoicePdfDocument(createCurrentInput(), fixture.dependencies))
      .rejects.toEqual(new InvoiceDocumentIntegrityError());

    expect(fixture.storage.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(existing);
    expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
  });
});
