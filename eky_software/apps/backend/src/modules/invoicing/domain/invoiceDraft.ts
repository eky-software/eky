import type {
  CalculatedInvoiceLine,
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';

export const invoiceUnits = ['h', 'kpl', 'pv', 'km', 'erä'] as const;

export type InvoiceUnit = (typeof invoiceUnits)[number];
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
  status: InvoiceDraftStatus;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  priceInputMode: PriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  lines: InvoiceDraftLine[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}
