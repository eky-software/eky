import type {
  ApprovedInvoiceEmailDryRunProviderResult,
  ApprovedInvoiceEmailDryRunSend,
  ApprovedInvoiceEmailPreview,
} from '../application/approvedInvoiceEmailPreview.js';

export interface InvoiceEmailDeliveryProvider {
  prepareDryRunEmail(
    email: ApprovedInvoiceEmailPreview,
  ): Promise<ApprovedInvoiceEmailPreview>;

  sendDryRunEmail(
    email: ApprovedInvoiceEmailDryRunSend,
  ): Promise<ApprovedInvoiceEmailDryRunProviderResult>;
}
