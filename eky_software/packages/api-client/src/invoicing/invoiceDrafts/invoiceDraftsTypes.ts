export type InvoicePriceInputMode = 'net' | 'gross';
export type InvoiceTaxTreatment =
  | 'normalVat'
  | 'reverseChargeConstruction';
export type InvoicePerformancePeriod =
  | { type: 'invoiceDate' }
  | { type: 'singleDate'; date: string }
  | { type: 'dateRange'; startDate: string; endDate: string };
export type InvoiceKind = 'standard' | 'credit';
export type InvoiceDraftStatus = 'draft';
export type ApprovedInvoiceStatus = 'approved';
export type InvoiceNumberingMode =
  | 'calendarYearSequence'
  | 'fiscalYearSequence'
  | 'plainSequence';
export type InvoiceReferenceNumberType = 'finnishDomestic';
export type KnownInvoiceUnit = 'h' | 'kpl' | 'pv' | 'km' | 'erä' | 'pak';
export type InvoiceUnit = KnownInvoiceUnit | (string & {});

export type InvoiceLineDiscount =
  | { type: 'none' }
  | { type: 'percentage'; basisPoints: number }
  | { type: 'fixed'; amountCents: number };

export interface InvoiceDraftLineInput {
  code?: string;
  description: string;
  quantityHundredths: number;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints?: number | null;
  discount: InvoiceLineDiscount;
}

export interface InvoiceDraftInput {
  customerId: string;
  billingRecipientCustomerId?: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTermDays?: number;
  reminderPeriodDays?: number;
  latePaymentInterestBasisPoints?: number;
  priceInputMode: InvoicePriceInputMode;
  taxTreatment?: InvoiceTaxTreatment;
  performancePeriod?: InvoicePerformancePeriod;
  subject?: string;
  orderNumber?: string;
  note?: string;
  deliveryAddressText?: string;
  lines: InvoiceDraftLineInput[];
}

export interface InvoiceDraftLine {
  id: string;
  position: number;
  code: string;
  description: string;
  quantityHundredths: number;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number | null;
  priceInputMode: InvoicePriceInputMode;
  discount: InvoiceLineDiscount;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface InvoiceVatBreakdown {
  vatRateBasisPoints: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface InvoiceTotals {
  netTotalCents: number;
  vatTotalCents: number;
  grossTotalCents: number;
  vatBreakdown: InvoiceVatBreakdown[];
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
  priceInputMode: InvoicePriceInputMode;
  taxTreatment: InvoiceTaxTreatment;
  performancePeriod: InvoicePerformancePeriod;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  lines: InvoiceDraftLine[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}

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
  priceInputMode: InvoicePriceInputMode;
  subject: string;
  netTotalCents: number;
  vatTotalCents: number;
  grossTotalCents: number;
  updatedAt: string;
}

export interface InvoiceDraftListQuery {
  customerId?: string;
}

export interface ApprovedInvoiceResult {
  invoiceId: string;
  draftId: string;
  invoiceNumber: string;
  referenceNumber: string;
  referenceNumberType: InvoiceReferenceNumberType;
  sequenceNumber: number;
  sequenceScope: string;
  numberingMode: InvoiceNumberingMode;
  status: ApprovedInvoiceStatus;
}

export interface ApproveInvoiceDraftInput {
  reverseChargeEligibilityConfirmed?: boolean;
}

export interface InvoiceDraftsApi {
  approveInvoiceDraft(
    id: string,
    input?: ApproveInvoiceDraftInput,
  ): Promise<ApprovedInvoiceResult>;
  createInvoiceDraft(input: InvoiceDraftInput): Promise<InvoiceDraft>;
  deleteInvoiceDraft(id: string): Promise<void>;
  getInvoiceDraft(id: string): Promise<InvoiceDraft>;
  listInvoiceDrafts(
    query?: InvoiceDraftListQuery,
  ): Promise<InvoiceDraftSummary[]>;
  updateInvoiceDraft(
    id: string,
    input: InvoiceDraftInput,
  ): Promise<InvoiceDraft>;
}
