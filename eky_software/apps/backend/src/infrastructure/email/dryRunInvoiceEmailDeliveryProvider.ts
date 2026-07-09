import type {
  ApprovedInvoiceEmailDryRunProviderResult,
  ApprovedInvoiceEmailDryRunSend,
  ApprovedInvoiceEmailPreview,
} from '../../modules/invoicing/application/approvedInvoiceEmailPreview.js';
import type { InvoiceEmailDeliveryProvider } from '../../modules/invoicing/ports/invoiceEmailDeliveryProvider.js';

export class DryRunInvoiceEmailDeliveryProvider
  implements InvoiceEmailDeliveryProvider
{
  async prepareDryRunEmail(
    email: ApprovedInvoiceEmailPreview,
  ): Promise<ApprovedInvoiceEmailPreview> {
    return email;
  }

  async sendDryRunEmail(
    _email: ApprovedInvoiceEmailDryRunSend,
  ): Promise<ApprovedInvoiceEmailDryRunProviderResult> {
    return {
      provider: 'dryRun',
      providerMessageId: null,
    };
  }
}
