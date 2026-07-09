import type { ApprovedInvoiceEmailPreview } from '../../modules/invoicing/application/approvedInvoiceEmailPreview.js';
import type { InvoiceEmailDeliveryProvider } from '../../modules/invoicing/ports/invoiceEmailDeliveryProvider.js';

export class DryRunInvoiceEmailDeliveryProvider
  implements InvoiceEmailDeliveryProvider
{
  async prepareDryRunEmail(
    email: ApprovedInvoiceEmailPreview,
  ): Promise<ApprovedInvoiceEmailPreview> {
    return email;
  }
}
