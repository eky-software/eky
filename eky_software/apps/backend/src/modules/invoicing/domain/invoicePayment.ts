export const invoicePaymentStateValues = ['unpaid', 'paid'] as const;
export type InvoicePaymentState = (typeof invoicePaymentStateValues)[number];
export type InvoicePaymentReadState = InvoicePaymentState | 'notApplicable';

export const invoicePaymentSourceValues = ['manual'] as const;
export type InvoicePaymentSource = (typeof invoicePaymentSourceValues)[number];

export const invoicePaymentEventActionValues = [
  'paymentMarkedPaid',
  'paymentMarkReverted',
] as const;
export type InvoicePaymentEventAction =
  (typeof invoicePaymentEventActionValues)[number];

export interface InvoicePaymentEvent {
  id: string;
  invoiceId: string;
  action: InvoicePaymentEventAction;
  paymentSource: InvoicePaymentSource;
  paidOn: string;
  amountCents: number;
  occurredAt: string;
}

export interface InvoicePaymentSummary {
  invoiceId: string;
  invoiceNumber: string;
  paymentState: InvoicePaymentState;
  paidOn: string | null;
  paidAmountCents: number | null;
  paymentSource: InvoicePaymentSource | null;
}

export interface InvoicePaymentReadModel {
  paymentState: InvoicePaymentReadState;
  paidOn: string | null;
  paidAmountCents: number | null;
  paymentSource: InvoicePaymentSource | null;
}
