import type {
  InvoiceLineDiscount,
  InvoicePriceInputMode,
  InvoiceTotals,
  InvoiceUnit,
} from '../invoiceDrafts/index.js';

export interface CreditInvoiceParty {
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

export interface CreditInvoiceDraftLine {
  id: string | null;
  sourceInvoiceLineId: string;
  isIncluded: boolean;
  position: number;
  code: string;
  description: string;
  quantityHundredths: number;
  maximumQuantityHundredths: number;
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

export interface CreditInvoiceDraft {
  id: string;
  invoiceKind: 'credit';
  creditedInvoiceId: string;
  creditedInvoiceNumber: string;
  creditedInvoiceDate: string;
  customer: CreditInvoiceParty;
  billingRecipient: CreditInvoiceParty;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: 0;
  reminderPeriodDays: 0;
  latePaymentInterestBasisPoints: 0;
  priceInputMode: InvoicePriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  lines: CreditInvoiceDraftLine[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}

export interface CreditInvoiceDraftLineInput {
  sourceInvoiceLineId: string;
  description: string;
  quantityHundredths: number;
}

export interface UpdateCreditInvoiceDraftInput {
  subject: string;
  note: string;
  lines: CreditInvoiceDraftLineInput[];
}

export interface ApprovedCreditInvoiceResult {
  invoiceId: string;
  draftId: string;
  invoiceNumber: string;
  sequenceNumber: number;
  sequenceScope: string;
  numberingMode:
    | 'calendarYearSequence'
    | 'fiscalYearSequence'
    | 'plainSequence';
  status: 'approved';
}

export interface InvoiceCreditsApi {
  approveCreditInvoiceDraft(
    invoiceDraftId: string,
  ): Promise<ApprovedCreditInvoiceResult>;
  createCreditInvoiceDraft(invoiceId: string): Promise<CreditInvoiceDraft>;
  getCreditInvoiceDraft(invoiceDraftId: string): Promise<CreditInvoiceDraft>;
  updateCreditInvoiceDraft(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): Promise<CreditInvoiceDraft>;
}
