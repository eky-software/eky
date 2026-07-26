import type {
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';
import type { InvoiceKind } from './invoiceKind.js';
import type { InvoicePerformancePeriod } from './invoicePerformancePeriod.js';
import type { InvoiceTaxTreatment } from './invoiceTaxTreatment.js';

export const invoiceUnits = ['h', 'kpl', 'pv', 'km', 'erä', 'pak'] as const;

export type KnownInvoiceUnit = (typeof invoiceUnits)[number];
export type InvoiceUnit = KnownInvoiceUnit | (string & {});
export type InvoiceDraftStatus = 'draft';

export interface InvoiceDraftLine {
  id: string;
  sourceInvoiceLineId: string | null;
  position: number;
  code: string;
  description: string;
  quantityHundredths: number;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number | null;
  priceInputMode: PriceInputMode;
  discount: InvoiceLineDiscount;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
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
  taxTreatment: InvoiceTaxTreatment;
  performancePeriod: InvoicePerformancePeriod;
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
