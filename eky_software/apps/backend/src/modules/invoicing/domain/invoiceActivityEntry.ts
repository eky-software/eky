export type InvoiceActivityAction =
  | 'invoiceNumberingSettings.updated'
  | 'invoicePaymentSettings.updated'
  | 'invoiceVatRates.updated'
  | 'invoice.approved'
  | 'invoice.cancelled'
  | 'invoice.credit_approved'
  | 'invoice.credit_draft_created'
  | 'invoice.credit_reapproved'
  | 'invoice.delivered'
  | 'invoice.delivery_failed'
  | 'invoice.delivery_outcome_unknown'
  | 'invoice.delivery_pending'
  | 'invoice.reapproved'
  | 'invoice.reopened_for_edit';

export type InvoiceActivityOutcome = 'failure' | 'success' | 'unknown';

export interface InvoiceActivityEntry {
  action: InvoiceActivityAction;
  id: string;
  invoiceNumber: string | null;
  occurredAt: string;
  outcome: InvoiceActivityOutcome;
}
