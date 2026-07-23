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

interface CreditInvoiceDraftLineBase {
  id: string | null;
  isIncluded: boolean;
  position: number;
  code: string;
  description: string;
  quantityHundredths: number;
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

export interface SourceCreditInvoiceDraftLine
  extends CreditInvoiceDraftLineBase {
  lineType: 'source';
  sourceInvoiceLineId: string;
  maximumQuantityHundredths: number;
}

export interface ManualCreditInvoiceDraftLine
  extends CreditInvoiceDraftLineBase {
  lineType: 'manual';
  sourceInvoiceLineId: null;
  maximumQuantityHundredths: null;
}

export type CreditInvoiceDraftLine =
  | SourceCreditInvoiceDraftLine
  | ManualCreditInvoiceDraftLine;

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
  refundIban: string;
  lines: CreditInvoiceDraftLine[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}

export interface SourceCreditInvoiceDraftLineInput {
  lineType: 'source';
  sourceInvoiceLineId: string;
  description: string;
  quantityHundredths: number;
}

export interface ManualCreditInvoiceDraftLineInput {
  lineType: 'manual';
  description: string;
  quantityHundredths: number;
  unit: string;
  unitPriceCents: number;
  vatRateBasisPoints: number;
}

export type CreditInvoiceDraftLineInput =
  | SourceCreditInvoiceDraftLineInput
  | ManualCreditInvoiceDraftLineInput;

export interface UpdateCreditInvoiceDraftInput {
  subject: string;
  note: string;
  refundIban: string;
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
