import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { PreservedLegacyInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { PreservedLegacyInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import type { InvoiceLegacyResendReader } from '../ports/invoiceLegacyResendReader.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import {
  assertLegacyResendSelection,
  readVerifiedLegacyDocument,
  sameLegacyResendDocument,
} from './preservedLegacyInvoiceDocumentValidation.js';

export interface ReadPreservedLegacyInvoiceDocumentInput {
  actorContext: ActorContext;
  invoiceId: string;
  documentId: string;
}

export interface ReadPreservedLegacyInvoiceDocumentDependencies {
  invoiceLegacyResendReader: InvoiceLegacyResendReader;
  invoiceDocumentStorage: Pick<InvoiceDocumentStorage, 'readVerifiedDocument'>;
}

export interface PreservedLegacyInvoiceDeliveryDocument {
  readonly content: Uint8Array;
  readonly metadata: PreservedLegacyInvoiceDocumentMetadata;
  readonly target: PreservedLegacyInvoiceDeliveryTarget;
}

// Preview and send re-read the prepared identity; neither may publish a replacement.
export async function readPreservedLegacyInvoiceDocument(
  input: ReadPreservedLegacyInvoiceDocumentInput,
  dependencies: ReadPreservedLegacyInvoiceDocumentDependencies,
): Promise<PreservedLegacyInvoiceDeliveryDocument> {
  requirePermission(input.actorContext, 'sendInvoices');
  const scope = {
    companyId: requireExactIdentifier(input.actorContext.companyId, 'Company id'),
    invoiceId: requireExactIdentifier(input.invoiceId, 'Invoice id'),
  };
  const documentId = requireExactIdentifier(input.documentId, 'Invoice document id');
  const selected = await dependencies.invoiceLegacyResendReader.findDocuments(scope);
  if (selected === undefined) throw new InvoiceDeliveryConflictError();
  assertLegacyResendSelection(scope, selected);
  const metadata = selected.preserved;
  if (metadata === undefined || metadata.id !== documentId) throw new InvoiceDeliveryConflictError();

  const sourceContent = await readVerifiedLegacyDocument(selected.source, dependencies.invoiceDocumentStorage);
  let content: Uint8Array | undefined;
  try {
    content = await readVerifiedLegacyDocument(metadata, dependencies.invoiceDocumentStorage);
    const current = await dependencies.invoiceLegacyResendReader.findDocuments(scope);
    if (current === undefined) throw new InvoiceDeliveryConflictError();
    assertLegacyResendSelection(scope, current);
    if (!sameLegacyResendDocument(current.source, selected.source) || current.preserved === undefined
      || !sameLegacyResendDocument(current.preserved, metadata)) throw new InvoiceDocumentIntegrityError();
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

function requireExactIdentifier(value: string, fieldName: string): string {
  const identifier = requireIdentifier(value, fieldName);
  if (identifier !== value) throw new InvoiceDraftValidationError(`${fieldName} is invalid.`);
  return identifier;
}
