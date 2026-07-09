import type { ApprovedInvoiceEmailPreview } from '../application/approvedInvoiceEmailPreview.js';

export interface InvoiceEmailDeliveryProvider {
  prepareDryRunEmail(
    email: ApprovedInvoiceEmailPreview,
  ): Promise<ApprovedInvoiceEmailPreview>;
}
