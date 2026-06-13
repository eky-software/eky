import type { InvoiceDraftStatus } from './invoiceDraft.js';
import type { PriceInputMode } from './invoiceCalculation.js';

export interface InvoiceDraftSummary {
  id: string;
  customerId: string;
  status: InvoiceDraftStatus;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  priceInputMode: PriceInputMode;
  subject: string;
  netTotalCents: number;
  vatTotalCents: number;
  grossTotalCents: number;
  updatedAt: string;
}
