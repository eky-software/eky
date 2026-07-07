import type {
  CalculatedInvoiceLine,
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';

export const invoiceUnits = ['h', 'kpl', 'pv', 'km', 'erä', 'pak'] as const;

export type KnownInvoiceUnit = (typeof invoiceUnits)[number];
export type InvoiceUnit = KnownInvoiceUnit | (string & {});
export type InvoiceDraftStatus = 'draft';

export interface InvoiceDraftLine extends CalculatedInvoiceLine {
  id: string;
  position: number;
  code: string;
  description: string;
  unit: InvoiceUnit;
  discount: InvoiceLineDiscount;
}

export interface InvoiceDraft {
  id: string;
  companyId: string;
  customerId: string;
  billingRecipientCustomerId: string | null;
  status: InvoiceDraftStatus;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  reminderPeriodDays: number;
  latePaymentInterestBasisPoints: number;
  priceInputMode: PriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  lines: InvoiceDraftLine[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}
