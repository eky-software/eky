import { createHash } from 'node:crypto';

import { vi } from 'vitest';

import {
  approvedInvoicePdfDocumentType,
  approvedInvoicePdfMimeType,
  type RevisionInvoiceDocumentMetadata,
} from '../domain/approvedInvoiceDocument.js';
import type { InvoiceContentRevision, InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import type { InvoiceContentRevisionReader } from '../ports/invoiceContentRevisionReader.js';
import type {
  InvoiceDocumentRepository,
  PublishRevisionDocumentInput,
} from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import type { GenerateApprovedInvoicePdfDocumentDependencies } from './generateApprovedInvoicePdfDocument.js';
import type { InvoiceLegacyRevisionPromoter } from '../ports/invoiceLegacyRevisionPromoter.js';
import { createUnexpectedLegacyRevisionPromoter } from './prepareInvoiceDeliveryRevision.fixture.js';
import { createInvoiceRevisionPdfContentFixture } from './toInvoiceRevisionPdfContent.fixture.js';

export function createControlledPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

export function createRevisionInput(revision: InvoiceRevisionKey = createInvoiceRevisionPdfContentFixture()) {
  return {
    key: {
      companyId: revision.companyId,
      invoiceId: revision.invoiceId,
      revisionId: revision.revisionId,
    },
    createdAt: '2026-10-05T10:00:00.000Z',
  };
}

export function createCurrentInput(revision: InvoiceRevisionKey = createInvoiceRevisionPdfContentFixture()) {
  const { key, createdAt } = createRevisionInput(revision);
  return { companyId: key.companyId, invoiceId: key.invoiceId, createdAt };
}

export function publishedDocument({ key, candidate }: PublishRevisionDocumentInput): RevisionInvoiceDocumentMetadata {
  return {
    ...candidate,
    companyId: key.companyId,
    invoiceId: key.invoiceId,
    documentType: approvedInvoicePdfDocumentType,
    mimeType: approvedInvoicePdfMimeType,
    binding: { kind: 'revision', revisionId: key.revisionId },
  };
}

export function createDocumentMetadata(
  key: InvoiceRevisionKey = createRevisionInput().key,
): RevisionInvoiceDocumentMetadata {
  return publishedDocument({
    key,
    candidate: {
      id: 'synthetic-existing-document',
      createdAt: '2026-10-01T10:10:00.000Z',
      fileName: 'lasku-20261001.pdf',
      storagePath: `${key.companyId}/${key.invoiceId}/synthetic-existing-document.pdf`,
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
    },
  });
}

export function createPdfGeneratorFixture(
  revision: InvoiceContentRevision = createInvoiceRevisionPdfContentFixture(),
) {
  const pdf = new TextEncoder().encode('%PDF-1.7\nsynthetic revision PDF\n%%EOF');
  const retainedCandidates = new Map<string, Uint8Array>();
  const discardCandidate = vi.fn(async (documentId: string) => {
    retainedCandidates.delete(documentId);
  });
  const reader = {
    getCurrentRevision: vi.fn<InvoiceContentRevisionReader['getCurrentRevision']>()
      .mockResolvedValue(revision),
    getRevision: vi.fn<InvoiceContentRevisionReader['getRevision']>()
      .mockResolvedValue(revision),
  } satisfies InvoiceContentRevisionReader;
  const repository = {
    findDocumentForRevision: vi.fn<InvoiceDocumentRepository['findDocumentForRevision']>()
      .mockResolvedValue(undefined),
    findCurrentDocumentForRevision: vi.fn<InvoiceDocumentRepository['findCurrentDocumentForRevision']>()
      .mockResolvedValue(undefined),
    findDocumentById: vi.fn<InvoiceDocumentRepository['findDocumentById']>()
      .mockRejectedValue(new Error('Unexpected document ID lookup.')),
    publishDocumentIfCurrent: vi.fn<InvoiceDocumentRepository['publishDocumentIfCurrent']>()
      .mockImplementation(async (input) => ({ outcome: 'published', document: publishedDocument(input) })),
    publishPreservedLegacyDocument: vi.fn<InvoiceDocumentRepository['publishPreservedLegacyDocument']>()
      .mockRejectedValue(new Error('Unexpected legacy publication.')),
  } satisfies InvoiceDocumentRepository;
  const storage = {
    readVerifiedDocument: vi.fn<InvoiceDocumentStorage['readVerifiedDocument']>().mockResolvedValue(pdf),
    writeCandidate: vi.fn<InvoiceDocumentStorage['writeCandidate']>().mockImplementation(async (input) => {
      retainedCandidates.set(input.documentId, input.content.slice());
      return {
        storagePath: `${input.scope.companyId}/${input.scope.invoiceId}/${input.documentId}.pdf`,
        sha256: createHash('sha256').update(input.content).digest('hex'),
        sizeBytes: input.content.byteLength,
        discard: () => discardCandidate(input.documentId),
      };
    }),
  } satisfies InvoiceDocumentStorage;
  const renderApprovedInvoicePdf = vi.fn<GenerateApprovedInvoicePdfDocumentDependencies['renderApprovedInvoicePdf']>()
    .mockResolvedValue(pdf);
  const dependencies = {
    invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),
    invoiceContentRevisionReader: reader,
    invoiceDocumentRepository: repository,
    invoiceDocumentStorage: storage,
    renderApprovedInvoicePdf,
  } satisfies GenerateApprovedInvoicePdfDocumentDependencies & { invoiceLegacyRevisionPromoter: InvoiceLegacyRevisionPromoter };

  return { dependencies, reader, repository, storage, renderApprovedInvoicePdf, discardCandidate, retainedCandidates, pdf };
}
