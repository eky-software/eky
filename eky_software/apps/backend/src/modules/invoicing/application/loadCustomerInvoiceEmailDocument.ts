import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceContentRevisionReader } from '../ports/invoiceContentRevisionReader.js';
import type { ApprovedInvoiceEmailDocumentTarget } from './approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import type { InvoiceEmailDeliveryDocument } from './loadInvoiceEmailDeliveryDocument.js';
import type { PreservedLegacyInvoiceDeliveryDocument, ReadPreservedLegacyInvoiceDocumentInput } from './readPreservedLegacyInvoiceDocument.js';
import { requireApprovedInvoiceEmailDocumentTarget } from './requireApprovedInvoiceEmailDocumentTarget.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';
import { toRevisionInvoiceDeliveryTarget } from './toRevisionInvoiceDeliveryTarget.js';

export type CustomerInvoiceEmailDocument = InvoiceEmailDeliveryDocument | PreservedLegacyInvoiceDeliveryDocument;

export interface LoadCustomerInvoiceEmailDocumentInput {
  actorContext: ActorContext;
  invoiceId: string;
  createdAt: string;
  documentTarget: ApprovedInvoiceEmailDocumentTarget;
}

export interface LoadCustomerInvoiceEmailDocumentDependencies {
  approvedInvoiceReader: Pick<ApprovedInvoiceReader, 'getApprovedInvoiceById'>;
  invoiceContentRevisionReader: Pick<InvoiceContentRevisionReader, 'getCurrentRevision'>;
  loadInvoiceEmailDeliveryDocument(input: GenerateApprovedInvoicePdfDocumentInput): Promise<InvoiceEmailDeliveryDocument>;
  readPreservedLegacyInvoiceDocument(input: ReadPreservedLegacyInvoiceDocumentInput): Promise<PreservedLegacyInvoiceDeliveryDocument>;
}

// The caller supplies a comparison target, never authority to select provenance.
export async function loadCustomerInvoiceEmailDocument(
  input: LoadCustomerInvoiceEmailDocumentInput,
  dependencies: LoadCustomerInvoiceEmailDocumentDependencies,
): Promise<CustomerInvoiceEmailDocument> {
  requirePermission(input.actorContext, 'sendInvoices');
  const scope = {
    companyId: requireIdentifier(input.actorContext.companyId, 'Company id'),
    invoiceId: requireIdentifier(input.invoiceId, 'Approved invoice id'),
  };
  const expected = requireApprovedInvoiceEmailDocumentTarget(input.documentTarget);
  const revision = await dependencies.invoiceContentRevisionReader.getCurrentRevision(scope);
  const invoice = await dependencies.approvedInvoiceReader.getApprovedInvoiceById(scope.companyId, scope.invoiceId);
  if (invoice === undefined || revision === undefined) throw new ApprovedInvoiceNotFoundError();
  requireInvoiceDeliveryEligible(invoice);

  if (revision.origin === 'legacySnapshot' && invoice.status === 'sent') {
    if (expected.kind !== 'preservedLegacy') throw new InvoiceDeliveryConflictError();
    const loaded = await dependencies.readPreservedLegacyInvoiceDocument({
      actorContext: input.actorContext, invoiceId: scope.invoiceId, documentId: expected.documentId,
    });
    if (loaded.metadata.companyId !== scope.companyId || loaded.metadata.invoiceId !== scope.invoiceId
      || loaded.metadata.id !== expected.documentId || loaded.metadata.binding.kind !== 'preservedLegacy') {
      loaded.content.fill(0);
      throw new InvoiceDocumentIntegrityError();
    }
    return loaded;
  }

  if (expected.kind !== 'revision') throw new InvoiceDeliveryConflictError();
  const loaded = await dependencies.loadInvoiceEmailDeliveryDocument({
    ...scope, actorContext: input.actorContext, createdAt: input.createdAt,
  });
  try {
    const target = toRevisionInvoiceDeliveryTarget({ ...scope, revisionId: revision.revisionId }, loaded.metadata);
    const current = await dependencies.invoiceContentRevisionReader.getCurrentRevision(scope);
    if (loaded.metadata.id !== expected.documentId || current?.revisionId !== revision.revisionId) {
      throw new InvoiceDocumentPublicationConflictError();
    }
    return { ...loaded, target };
  } catch (error) {
    loaded.content.fill(0);
    throw error;
  }
}
