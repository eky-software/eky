import type { InvoiceLineDiscount, InvoiceTotals, PriceInputMode } from '../domain/invoiceCalculation.js';
import type { InvoiceUnit } from '../domain/invoiceDraft.js';

export interface CreditInvoicePartyView {
  customerId: string | null;
  customerNumber: string;
  name: string;
  businessId: string;
  email: string;
  phone: string;
  streetAddress: string;
  postalCode: string;
  city: string;
}

export interface CreditInvoiceDraftLineView {
  id: string | null;
  lineType: 'source' | 'manual';
  sourceInvoiceLineId: string | null;
  isIncluded: boolean;
  position: number;
  code: string;
  description: string;
  quantityHundredths: number;
  maximumQuantityHundredths: number | null;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  discount: InvoiceLineDiscount;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface CreditInvoiceDraftView {
  id: string;
  invoiceKind: 'credit';
  creditedInvoiceId: string;
  creditedInvoiceNumber: string;
  creditedInvoiceDate: string;
  customer: CreditInvoicePartyView;
  billingRecipient: CreditInvoicePartyView;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: 0;
  reminderPeriodDays: 0;
  latePaymentInterestBasisPoints: 0;
  priceInputMode: PriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  refundIban: string;
  lines: CreditInvoiceDraftLineView[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}
