import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import { InvoiceLegacyDeliveryReviewRequiredError } from '../domain/invoiceLegacyDeliveryReviewRequiredError.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';

export type InvoiceLegacyDeliveryReviewReader = Pick<InvoiceDeliveryEventReader, 'requiresLegacyDeliveryReview'>;

// This preflight gives specific feedback; mutation adapters recheck inside their transaction.
export async function requireLegacyInvoiceDeliveryReviewed(
  scope: InvoiceScope,
  reader: InvoiceLegacyDeliveryReviewReader,
): Promise<void> {
  if (await reader.requiresLegacyDeliveryReview(scope)) {
    throw new InvoiceLegacyDeliveryReviewRequiredError();
  }
}
