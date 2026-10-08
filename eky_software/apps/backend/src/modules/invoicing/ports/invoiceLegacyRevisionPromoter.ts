import type { InvoiceContentRevision, InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';

export interface InvoiceLegacyRevisionPromoter {
  // The authorized caller supplies the exact observed key, never a latest fallback.
  promoteLegacyRevisionIfCurrent(expected: InvoiceRevisionKey): Promise<InvoiceContentRevision>;
}
