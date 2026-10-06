import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { PreservedLegacyInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { PreservedLegacyInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import type { InvoiceLegacyResendDocuments, InvoiceLegacyResendReader } from '../ports/invoiceLegacyResendReader.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import {
  assertLegacyResendSelection as assertSelection,
  readVerifiedLegacyDocument as readVerified,
  sameLegacyResendDocument as sameDocument,
} from './preservedLegacyInvoiceDocumentValidation.js';

export interface PreparePreservedLegacyInvoiceDocumentDependencies {
  invoiceLegacyResendReader: InvoiceLegacyResendReader;
  invoiceDocumentRepository: Pick<InvoiceDocumentRepository, 'publishPreservedLegacyDocument'>;
  invoiceDocumentStorage: InvoiceDocumentStorage;
}

// Preparation preserves bytes, not historical revision proof or permission to call SMTP.
export async function preparePreservedLegacyInvoiceDocument(
  input: { actorContext: ActorContext; invoiceId: string; createdAt: string },
  dependencies: PreparePreservedLegacyInvoiceDocumentDependencies,
): Promise<{
  content: Uint8Array;
  metadata: PreservedLegacyInvoiceDocumentMetadata;
  target: PreservedLegacyInvoiceDeliveryTarget;
}> {
  requirePermission(input.actorContext, 'sendInvoices');
  const scope = {
    companyId: requireIdentifier(input.actorContext.companyId, 'Company id'),
    invoiceId: requireIdentifier(input.invoiceId, 'Invoice id'),
  };
  const createdAt = requireIdentifier(input.createdAt, 'Document timestamp');
  const selected = await dependencies.invoiceLegacyResendReader.findDocuments(scope);
  if (selected === undefined) throw new InvoiceDeliveryConflictError();
  assertSelection(scope, selected);
  const sourceContent = await readVerified(selected.source, dependencies.invoiceDocumentStorage);
  let content: Uint8Array | undefined;
  try {
    const metadata = selected.preserved ?? await publishCopy(scope, selected, sourceContent, createdAt, dependencies);
    assertSelection(scope, { source: selected.source, preserved: metadata });
    content = await readVerified(metadata, dependencies.invoiceDocumentStorage);
    const current = await dependencies.invoiceLegacyResendReader.findDocuments(scope);
    if (current === undefined) throw new InvoiceDeliveryConflictError();
    assertSelection(scope, current);
    if (!sameDocument(current.source, selected.source) || current.preserved === undefined
      || !sameDocument(current.preserved, metadata)) throw new InvoiceDocumentIntegrityError();
    return { content, metadata, target: {
      ...scope, kind: 'preservedLegacy', sourceDocumentId: selected.source.id,
      documentId: metadata.id, sha256: metadata.sha256, sizeBytes: metadata.sizeBytes,
    } };
  } catch (error) {
    content?.fill(0);
    throw error;
  } finally {
    sourceContent.fill(0);
  }
}

async function publishCopy(
  scope: InvoiceScope,
  selected: InvoiceLegacyResendDocuments,
  content: Uint8Array,
  createdAt: string,
  dependencies: PreparePreservedLegacyInvoiceDocumentDependencies,
): Promise<PreservedLegacyInvoiceDocumentMetadata> {
  const id = randomUUID();
  const source = selected.source;
  const file = await dependencies.invoiceDocumentStorage.writeCandidate({ scope, documentId: id, content });
  if (file.sha256 !== source.sha256 || file.sizeBytes !== source.sizeBytes
    || file.storagePath === source.storagePath) throw new InvoiceDocumentIntegrityError();
  // A thrown publication may have committed: retain its candidate instead of deleting evidence.
  const result = await dependencies.invoiceDocumentRepository.publishPreservedLegacyDocument({
    scope, source: { documentId: source.id, sha256: source.sha256, sizeBytes: source.sizeBytes },
    candidate: { id, createdAt, fileName: source.fileName,
      storagePath: file.storagePath, sha256: file.sha256, sizeBytes: file.sizeBytes },
  });
  if (result.outcome === 'conflict') {
    let cleanupFailed = false;
    try { await file.discard(); } catch { cleanupFailed = true; }
    throw new InvoiceDocumentPublicationConflictError(cleanupFailed);
  }
  assertSelection(scope, { source, preserved: result.document });
  if (result.outcome === 'published' || result.document.id === id) {
    if (result.document.id !== id || result.document.storagePath !== file.storagePath
      || result.document.fileName !== source.fileName || result.document.createdAt !== createdAt) {
      throw new InvoiceDocumentIntegrityError();
    }
  } else {
    if (result.document.storagePath === file.storagePath) throw new InvoiceDocumentIntegrityError();
    await file.discard();
  }
  return result.document;
}
