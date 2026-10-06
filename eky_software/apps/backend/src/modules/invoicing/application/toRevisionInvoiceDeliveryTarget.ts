import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import type { RevisionInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';

export function toRevisionInvoiceDeliveryTarget(
  scope: InvoiceRevisionKey,
  document: RevisionInvoiceDocumentMetadata,
): RevisionInvoiceDeliveryTarget {
  if (document.companyId !== scope.companyId || document.invoiceId !== scope.invoiceId
    || document.binding?.kind !== 'revision') throw new InvoiceDocumentIntegrityError();
  if (document.binding.revisionId !== scope.revisionId) throw new InvoiceDocumentPublicationConflictError();
  return {
    companyId: scope.companyId, invoiceId: scope.invoiceId, kind: 'revision', revisionId: scope.revisionId,
    documentId: document.id, sha256: document.sha256, sizeBytes: document.sizeBytes,
  };
}
