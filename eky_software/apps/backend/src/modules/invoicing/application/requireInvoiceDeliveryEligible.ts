import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';

export function requireInvoiceDeliveryEligible(
  invoice: ApprovedInvoiceView,
): void {
  if (invoice.status !== 'approved' && invoice.status !== 'sent') {
    throw new ApprovedInvoiceNotFoundError();
  }
}
