import type { InvoiceDraft } from '../invoiceDrafts/index.js';

export type ApprovedInvoiceViewStatus = 'approved' | 'sent';
export type ApprovedInvoiceNumberingMode =
  | 'calendarYearSequence'
  | 'fiscalYearSequence'
  | 'plainSequence';
export type ApprovedInvoiceReferenceNumberType = 'finnishDomestic';
export type ApprovedInvoicePriceInputMode = 'net' | 'gross';
export type KnownApprovedInvoiceUnit = 'h' | 'kpl' | 'pv' | 'km' | 'erä' | 'pak';
export type ApprovedInvoiceUnit = KnownApprovedInvoiceUnit | (string & {});

export type ApprovedInvoiceLineDiscount =
  | { type: 'none' }
  | { type: 'percentage'; basisPoints: number }
  | { type: 'fixed'; amountCents: number };

export interface ApprovedInvoiceLine {
  id: string;
  lineOrder: number;
  code: string;
  description: string;
  quantityHundredths: number;
  unit: ApprovedInvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  discount: ApprovedInvoiceLineDiscount;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface ApprovedInvoiceVatBreakdown {
  vatRateBasisPoints: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface ApprovedInvoiceTotals {
  netTotalCents: number;
  vatTotalCents: number;
  grossTotalCents: number;
  vatBreakdown: ApprovedInvoiceVatBreakdown[];
}

export interface ApprovedInvoiceView {
  id: string;
  companyId: string;
  sourceDraftId: string;
  invoiceNumber: string;
  referenceNumber: string;
  referenceNumberType: ApprovedInvoiceReferenceNumberType;
  seriesKey: string;
  sequenceScope: string;
  sequenceNumber: number;
  numberingMode: ApprovedInvoiceNumberingMode;
  status: ApprovedInvoiceViewStatus;
  customerId: string;
  customerNumberSnapshot: string;
  customerNameSnapshot: string;
  customerBusinessIdSnapshot: string;
  customerTypeSnapshot: string;
  customerEmailSnapshot: string;
  customerPhoneSnapshot: string;
  customerStreetAddressSnapshot: string;
  customerPostalCodeSnapshot: string;
  customerCitySnapshot: string;
  companyNameSnapshot: string;
  companyBusinessIdSnapshot: string;
  companyVatNumberSnapshot: string;
  companyStreetAddressSnapshot: string;
  companyPostalCodeSnapshot: string;
  companyCitySnapshot: string;
  companyEmailSnapshot: string;
  companyPhoneSnapshot: string;
  companyWebsiteSnapshot: string;
  companyIbanSnapshot: string;
  companyBicSnapshot: string;
  companyBankNameSnapshot: string;
  billingRecipientCustomerId: string | null;
  billingRecipientCustomerNumberSnapshot: string;
  billingRecipientNameSnapshot: string;
  billingRecipientBusinessIdSnapshot: string;
  billingRecipientCustomerTypeSnapshot: string;
  billingRecipientEmailSnapshot: string;
  billingRecipientPhoneSnapshot: string;
  billingRecipientStreetAddressSnapshot: string;
  billingRecipientPostalCodeSnapshot: string;
  billingRecipientCitySnapshot: string;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  reminderPeriodDays: number;
  latePaymentInterestBasisPoints: number;
  priceInputMode: ApprovedInvoicePriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  lines: ApprovedInvoiceLine[];
  totals: ApprovedInvoiceTotals;
  vatBreakdown: ApprovedInvoiceVatBreakdown[];
  createdAt: string;
  approvedAt: string;
  updatedAt: string;
}

export interface ApprovedInvoiceSummary {
  id: string;
  invoiceNumber: string;
  referenceNumber: string;
  status: ApprovedInvoiceViewStatus;
  customerId: string;
  customerNumberSnapshot: string;
  customerNameSnapshot: string;
  billingRecipientNameSnapshot: string;
  invoiceDate: string;
  dueDate: string;
  grossTotalCents: number;
  approvedAt: string;
  updatedAt: string;
}

export interface ReopenedApprovedInvoice {
  invoiceId: string;
  invoiceDraftId: string;
}

export type ApprovedInvoiceDocumentType = 'approved_invoice_pdf';

export interface ApprovedInvoiceDocumentMetadata {
  id: string;
  companyId: string;
  invoiceId: string;
  documentType: ApprovedInvoiceDocumentType;
  fileName: string;
  storagePath: string;
  mimeType: 'application/pdf';
  sha256: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ApprovedInvoicesApi {
  copyApprovedInvoiceToDraft(id: string): Promise<InvoiceDraft>;
  createApprovedInvoicePdf(id: string): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoicePdfMetadata(
    id: string,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoice(id: string): Promise<ApprovedInvoiceView>;
  getApprovedInvoicePdfUrl(id: string): string;
  listApprovedInvoices(): Promise<ApprovedInvoiceSummary[]>;
  markApprovedInvoiceSent(id: string): Promise<ApprovedInvoiceView>;
  reopenApprovedInvoiceForEditing(id: string): Promise<ReopenedApprovedInvoice>;
}
