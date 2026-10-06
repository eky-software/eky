import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { AuthorizationError, requirePermission } from '@eky/permissions';

import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoicePdfContent } from '../domain/approvedInvoicePdfContent.js';
import type { InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceContentRevisionReader } from '../ports/invoiceContentRevisionReader.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import type { InvoiceLegacyRevisionPromoter } from '../ports/invoiceLegacyRevisionPromoter.js';
import { prepareInvoiceDeliveryRevision } from './prepareInvoiceDeliveryRevision.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceContentRevisionIntegrityError } from './invoiceContentRevisionIntegrityError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import { toInvoiceRevisionPdfContent } from './toInvoiceRevisionPdfContent.js';

export interface GenerateApprovedInvoicePdfDocumentInput {
  actorContext?: ActorContext;
  companyId: string;
  createdAt: string;
  invoiceId: string;
}

export interface GenerateApprovedInvoicePdfDocumentDependencies {
  invoiceContentRevisionReader: InvoiceContentRevisionReader;
  invoiceDocumentRepository: InvoiceDocumentRepository;
  invoiceDocumentStorage: InvoiceDocumentStorage;
  renderApprovedInvoicePdf(invoice: ApprovedInvoicePdfContent): Promise<Uint8Array>;
}

export interface GenerateInvoiceRevisionPdfDocumentInput {
  key: InvoiceRevisionKey;
  createdAt: string;
}

export async function generateApprovedInvoicePdfDocument(
  input: GenerateApprovedInvoicePdfDocumentInput,
  dependencies: GenerateApprovedInvoicePdfDocumentDependencies & {
    invoiceLegacyRevisionPromoter: InvoiceLegacyRevisionPromoter;
  },
): Promise<RevisionInvoiceDocumentMetadata> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const createdAt = requireIdentifier(input.createdAt, 'Document timestamp');
  const current = await dependencies.invoiceContentRevisionReader.getCurrentRevision({ companyId, invoiceId });
  if (current === undefined) throw new ApprovedInvoiceNotFoundError();
  if (current.companyId !== companyId || current.invoiceId !== invoiceId) {
    throw new InvoiceContentRevisionIntegrityError();
  }
  if (current.origin === 'legacySnapshot') {
    // Promotion publishes a new delivery revision, unlike ordinary PDF generation.
    if (input.actorContext === undefined || input.actorContext.companyId !== companyId) {
      throw new AuthorizationError();
    }
    requirePermission(input.actorContext, 'sendInvoices');
  }
  const key = await prepareInvoiceDeliveryRevision(current, { companyId, invoiceId }, dependencies.invoiceLegacyRevisionPromoter);
  return generateInvoiceRevisionPdfDocument({ key, createdAt }, dependencies);
}

export async function generateInvoiceRevisionPdfDocument(
  input: GenerateInvoiceRevisionPdfDocumentInput,
  dependencies: GenerateApprovedInvoicePdfDocumentDependencies,
): Promise<RevisionInvoiceDocumentMetadata> {
  const key: InvoiceRevisionKey = {
    companyId: requireIdentifier(input.key.companyId, 'Company id'),
    invoiceId: requireIdentifier(input.key.invoiceId, 'Approved invoice id'),
    revisionId: requireIdentifier(input.key.revisionId, 'Invoice revision id'),
  };
  const createdAt = requireIdentifier(input.createdAt, 'Document timestamp');
  const revision = await dependencies.invoiceContentRevisionReader.getRevision(key);
  if (revision === undefined) throw new ApprovedInvoiceNotFoundError();
  if (revision.companyId !== key.companyId || revision.invoiceId !== key.invoiceId || revision.revisionId !== key.revisionId) {
    throw new InvoiceContentRevisionIntegrityError();
  }
  const content = toInvoiceRevisionPdfContent(revision);
  const existing = await dependencies.invoiceDocumentRepository.findDocumentForRevision(key);
  if (existing !== undefined) return verifyCurrentDocument(key, existing, dependencies);

  const pdf = await dependencies.renderApprovedInvoicePdf(content);
  const id = randomUUID();
  const file = await dependencies.invoiceDocumentStorage.writeCandidate({ scope: key, documentId: id, content: pdf });
  // A thrown publication has an unknown commit outcome: retain its file.
  const result = await dependencies.invoiceDocumentRepository.publishDocumentIfCurrent({
    key,
    candidate: {
      id, createdAt,
      fileName: `${content.invoiceKind === 'credit' ? 'hyvityslasku' : 'lasku'}-${content.invoiceNumber}.pdf`,
      storagePath: file.storagePath, sha256: file.sha256, sizeBytes: file.sizeBytes,
    },
  });
  if (result.outcome === 'conflict') {
    let candidateCleanupFailed = false;
    try { await file.discard(); } catch { candidateCleanupFailed = true; }
    throw new InvoiceDocumentPublicationConflictError(candidateCleanupFailed);
  }
  assertDocumentKey(key, result.document);
  if (result.outcome === 'published' || result.document.id === id) {
    if (result.document.id !== id || result.document.storagePath !== file.storagePath
      || result.document.sha256 !== file.sha256 || result.document.sizeBytes !== file.sizeBytes) {
      throw new InvoiceDocumentIntegrityError();
    }
    return result.document;
  }
  if (result.document.storagePath === file.storagePath) throw new InvoiceDocumentIntegrityError();
  await file.discard();
  return verifyCurrentDocument(key, result.document, dependencies);
}

async function verifyCurrentDocument(
  key: InvoiceRevisionKey,
  document: RevisionInvoiceDocumentMetadata,
  dependencies: GenerateApprovedInvoicePdfDocumentDependencies,
): Promise<RevisionInvoiceDocumentMetadata> {
  assertDocumentKey(key, document);
  await dependencies.invoiceDocumentStorage.readVerifiedDocument(document);
  // This is read-only: an absent/corrupt cache entry must never be republished.
  const current = await dependencies.invoiceDocumentRepository.findCurrentDocumentForRevision(key);
  if (current === undefined) throw new InvoiceDocumentPublicationConflictError();
  assertDocumentKey(key, current);
  if (current.id !== document.id || current.storagePath !== document.storagePath
    || current.sha256 !== document.sha256 || current.sizeBytes !== document.sizeBytes) {
    throw new InvoiceDocumentIntegrityError();
  }
  return current;
}

function assertDocumentKey(key: InvoiceRevisionKey, document: RevisionInvoiceDocumentMetadata): void {
  if (document.companyId !== key.companyId || document.invoiceId !== key.invoiceId
    || document.binding.kind !== 'revision' || document.binding.revisionId !== key.revisionId) {
    throw new InvoiceDocumentIntegrityError();
  }
}
