import type { InvoiceContentRevision, InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import type { InvoiceLegacyRevisionPromoter } from '../ports/invoiceLegacyRevisionPromoter.js';
import { InvoiceContentRevisionIntegrityError } from './invoiceContentRevisionIntegrityError.js';

export async function prepareInvoiceDeliveryRevision(
  revision: InvoiceContentRevision,
  scope: { companyId: string; invoiceId: string },
  promoter: InvoiceLegacyRevisionPromoter,
): Promise<InvoiceRevisionKey> {
  if (revision.companyId !== scope.companyId || revision.invoiceId !== scope.invoiceId) {
    throw new InvoiceContentRevisionIntegrityError();
  }
  const key = { ...scope, revisionId: revision.revisionId };
  if (revision.origin !== 'legacySnapshot') return key;

  const promoted = await promoter.promoteLegacyRevisionIfCurrent(key);
  if (promoted.companyId !== scope.companyId || promoted.invoiceId !== scope.invoiceId
    || promoted.revisionId === revision.revisionId || promoted.revisionId.length === 0
    || promoted.origin !== 'validatedLegacySnapshot'
    || promoted.vatBreakdownState !== 'authoritative') {
    throw new InvoiceContentRevisionIntegrityError();
  }
  return { ...scope, revisionId: promoted.revisionId };
}
