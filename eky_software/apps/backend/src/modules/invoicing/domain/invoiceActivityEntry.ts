export type InvoiceActivityAction =
  | 'invoice.approved'
  | 'invoice.cancelled'
  | 'invoice.credit_approved'
  | 'invoice.credit_draft_created'
  | 'invoice.credit_reapproved'
  | 'invoice.delivered'
  | 'invoice.reapproved'
  | 'invoice.reopened_for_edit';

export interface InvoiceActivityEntry {
  action: InvoiceActivityAction;
  id: string;
  invoiceNumber: string;
  occurredAt: string;
}
