import type {
  CalculatedInvoiceLine,
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';
import type { InvoiceKind } from './invoiceKind.js';

export const invoiceUnits = ['h', 'kpl', 'pv', 'km', 'erä', 'pak'] as const;

export type KnownInvoiceUnit = (typeof invoiceUnits)[number];
export type InvoiceUnit = KnownInvoiceUnit | (string & {});
export type InvoiceDraftStatus = 'draft';

export interface InvoiceDraftLine extends CalculatedInvoiceLine {
  id: string;
  sourceInvoiceLineId: string | null;
  position: number;
  code: string;
  description: string;
  unit: InvoiceUnit;
  discount: InvoiceLineDiscount;
}

export interface InvoiceDraft {
  id: string;
  companyId: string;
  invoiceKind: InvoiceKind;
  creditedInvoiceId: string | null;
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
  refundIban: string;
  lines: InvoiceDraftLine[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}
