import type { InvoiceDraftStatus } from './invoiceDraft.js';
import type { PriceInputMode } from './invoiceCalculation.js';
import type { InvoiceKind } from './invoiceKind.js';

export interface InvoiceDraftSummary {
  id: string;
  invoiceKind: InvoiceKind;
  creditedInvoiceId: string | null;
  customerId: string;
  status: InvoiceDraftStatus;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  latePaymentInterestBasisPoints: number;
  priceInputMode: PriceInputMode;
  subject: string;
  netTotalCents: number;
  vatTotalCents: number;
  grossTotalCents: number;
  updatedAt: string;
}
