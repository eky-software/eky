export type InvoicePriceInputMode = 'net' | 'gross';
export type InvoiceDraftStatus = 'draft';
export type ApprovedInvoiceStatus = 'approved';
export type InvoiceNumberingMode =
  | 'calendarYearSequence'
  | 'fiscalYearSequence'
  | 'plainSequence';
export type InvoiceUnit = 'h' | 'kpl' | 'pv' | 'km' | 'erä';

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
  vatRateBasisPoints: number;
  discount: InvoiceLineDiscount;
}

export interface InvoiceDraftInput {
  customerId: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTermDays?: number;
  priceInputMode: InvoicePriceInputMode;
  subject?: string;
  orderNumber?: string;
  note?: string;
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
  vatRateBasisPoints: number;
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
  status: InvoiceDraftStatus;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  priceInputMode: InvoicePriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  lines: InvoiceDraftLine[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDraftSummary {
  id: string;
  customerId: string;
  status: InvoiceDraftStatus;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
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
  sequenceNumber: number;
  sequenceScope: string;
  numberingMode: InvoiceNumberingMode;
  status: ApprovedInvoiceStatus;
}

export interface InvoiceDraftsApi {
  approveInvoiceDraft(id: string): Promise<ApprovedInvoiceResult>;
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
