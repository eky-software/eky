import type {
  InvoiceDraft,
  InvoicePerformancePeriod,
  InvoiceTaxTreatment,
} from '../invoiceDrafts/index.js';

export type ApprovedInvoiceViewStatus = 'approved' | 'sent' | 'cancelled';
export type ApprovedInvoiceKind = 'standard' | 'credit';
export type ApprovedInvoiceNumberingMode =
  | 'calendarYearSequence'
  | 'fiscalYearSequence'
  | 'plainSequence';
export type ApprovedInvoiceReferenceNumberType = 'finnishDomestic' | 'none';
export type ApprovedInvoicePriceInputMode = 'net' | 'gross';
export type InvoicePaymentState = 'unpaid' | 'paid' | 'notApplicable';
export type InvoicePaymentSource = 'manual';
export interface InvoicePaymentReadModel {
  paymentState: InvoicePaymentState;
  paidOn: string | null;
  paidAmountCents: number | null;
  paymentSource: InvoicePaymentSource | null;
}
export type KnownApprovedInvoiceUnit = 'h' | 'kpl' | 'pv' | 'km' | 'erä' | 'pak';
export type ApprovedInvoiceUnit = KnownApprovedInvoiceUnit | (string & {});

export type ApprovedInvoiceLineDiscount =
  | { type: 'none' }
  | { type: 'percentage'; basisPoints: number }
  | { type: 'fixed'; amountCents: number };

export interface ApprovedInvoiceLine {
  id: string;
  sourceInvoiceLineId: string | null;
  lineOrder: number;
  code: string;
  description: string;
  quantityHundredths: number;
  unit: ApprovedInvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number | null;
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

export interface ApprovedInvoiceView extends InvoicePaymentReadModel {
  id: string;
  invoiceKind: ApprovedInvoiceKind;
  creditedInvoiceId: string | null;
  creditedInvoiceNumber: string | null;
  creditedInvoiceDate: string | null;
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
  taxTreatment: InvoiceTaxTreatment;
  taxTreatmentLabelSnapshot: string;
  taxLegalBasisSnapshot: string;
  performancePeriod: InvoicePerformancePeriod;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  refundIbanSnapshot: string;
  lines: ApprovedInvoiceLine[];
  totals: ApprovedInvoiceTotals;
  vatBreakdown: ApprovedInvoiceVatBreakdown[];
  createdAt: string;
  approvedAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
}

export interface ApprovedInvoiceSummary extends InvoicePaymentReadModel {
  id: string;
  invoiceKind: ApprovedInvoiceKind;
  creditedInvoiceId: string | null;
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
  cancelledAt: string | null;
}

export type ApprovedInvoiceListSort =
  | 'invoiceDateDesc'
  | 'invoiceDateAsc'
  | 'dueDateAsc'
  | 'customerNameAsc';
export type ApprovedInvoiceListPageSize = 20 | 50 | 100;

export interface ApprovedInvoiceListQuery {
  status: ApprovedInvoiceViewStatus;
  customerId?: string;
  page: number;
  pageSize: ApprovedInvoiceListPageSize;
  sort: ApprovedInvoiceListSort;
  dateFrom?: string;
  dateTo?: string;
}

export interface ApprovedInvoiceListPage {
  invoices: ApprovedInvoiceSummary[];
  page: number;
  pageSize: ApprovedInvoiceListPageSize;
  totalCount: number;
  totalPages: number;
}

export type SentInvoiceCreditStatus = 'none' | 'partial' | 'full';
export type SentInvoiceCreditStateFilter =
  | 'all'
  | 'uncredited'
  | 'credited';
export type SentInvoicePaymentStateFilter = 'all' | 'unpaid' | 'paid';

export interface SentInvoiceGroup {
  rootInvoice: ApprovedInvoiceSummary;
  creditInvoices: ApprovedInvoiceSummary[];
  creditStatus: SentInvoiceCreditStatus;
  remainingCreditableGrossCents: number;
}

export interface InvoiceCreditContext {
  sourceInvoiceId: string;
  creditInvoices: ApprovedInvoiceSummary[];
  creditStatus: SentInvoiceCreditStatus;
  remainingCreditableGrossCents: number;
  activeCreditDraftId: string | null;
}

export type SentInvoiceGroupListQuery = Omit<
  ApprovedInvoiceListQuery,
  'status'
> & {
  creditState?: SentInvoiceCreditStateFilter;
  paymentState?: SentInvoicePaymentStateFilter;
};

export interface SentInvoiceGroupListPage {
  groups: SentInvoiceGroup[];
  page: number;
  pageSize: ApprovedInvoiceListPageSize;
  totalCount: number;
  totalPages: number;
}

export interface ReopenedApprovedInvoice {
  invoiceId: string;
  invoiceDraftId: string;
}

export interface MarkInvoicePaidInput {
  paidOn: string;
}

export interface InvoicePaymentSummary {
  invoiceId: string;
  invoiceNumber: string;
  paymentState: 'unpaid' | 'paid';
  paidOn: string | null;
  paidAmountCents: number | null;
  paymentSource: InvoicePaymentSource | null;
}

export interface CancelApprovedInvoiceInput {
  cancellationReason: string;
  confirmationInvoiceNumber: string;
}

export interface CancelledApprovedInvoice {
  cancellationReason: string;
  cancelledAt: string;
  cancelledBy: string;
  invoiceId: string;
  invoiceKind: ApprovedInvoiceKind;
  invoiceNumber: string;
  status: 'cancelled';
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

export type ApprovedInvoiceEmailProvider = 'dryRun';

export interface ApprovedInvoiceEmailAttachmentPreview {
  documentId: string;
  fileName: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
}

export interface ApprovedInvoiceEmailPreview {
  provider: ApprovedInvoiceEmailProvider;
  invoiceId: string;
  invoiceNumber: string;
  to: string;
  subject: string;
  body: string;
  attachment: ApprovedInvoiceEmailAttachmentPreview;
}

export interface ApprovedInvoiceEmailDryRunSendInput {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}

export interface ApprovedInvoiceEmailDryRunSend {
  provider: ApprovedInvoiceEmailProvider;
  invoiceId: string;
  invoiceNumber: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachment: ApprovedInvoiceEmailAttachmentPreview;
}

export interface ApprovedInvoiceEmailDryRunProviderResult {
  provider: ApprovedInvoiceEmailProvider;
  providerMessageId: string | null;
}

export interface ApprovedInvoiceEmailDryRunSendResult {
  deliveryEventId: string;
  email: ApprovedInvoiceEmailDryRunSend;
  providerResult: ApprovedInvoiceEmailDryRunProviderResult;
}

export type ApprovedInvoiceEmailSmtpTestPrepareInput =
  ApprovedInvoiceEmailDryRunSendInput;

export type ApprovedInvoiceEmailSmtpTestSendInput =
  ApprovedInvoiceEmailDryRunSendInput & {
    attemptId: string;
    authorizationToken: string;
  };

export interface ApprovedInvoiceEmailSmtpTestPreparation {
  attachment: {
    fileName: string;
    sizeBytes: number;
  };
  attemptId: string;
  authorizationToken: string;
  expiresAt: string;
  invoiceId: string;
  subject: string;
  testRecipient: string;
}

export interface ApprovedInvoiceEmailSmtpTestSendResult {
  deliveredTo: string;
  deliveryEventId: string;
  provider: 'smtp';
  providerMessageId: string | null;
  testMode: true;
}

export type ApprovedInvoiceEmailSmtpPrepareInput =
  ApprovedInvoiceEmailDryRunSendInput;

export type ApprovedInvoiceEmailSmtpSendInput =
  ApprovedInvoiceEmailDryRunSendInput & {
    attemptId: string;
    authorizationToken: string;
  };

export interface ApprovedInvoiceEmailSmtpPreparation {
  attachment: {
    fileName: string;
    sizeBytes: number;
  };
  attemptId: string;
  authorizationToken: string;
  body: string;
  cc: string;
  expiresAt: string;
  invoiceId: string;
  invoiceNumber: string;
  recipient: string;
  resend: boolean;
  sender: string;
  subject: string;
}

export interface ApprovedInvoiceEmailSmtpSendResult {
  deliveredCc: string;
  deliveredTo: string;
  deliveryEventId: string;
  invoice: ApprovedInvoiceView;
  provider: 'smtp';
  providerMessageId: string | null;
  resend: boolean;
  testMode: false;
}

export type InvoiceManualDeliveryMethod = 'manual' | 'print';

export type InvoiceDeliveryMethod =
  | 'email'
  | InvoiceManualDeliveryMethod
  | 'other';
export type InvoiceDeliveryProvider =
  | 'dryRun'
  | 'smtp'
  | 'gmail'
  | 'microsoft'
  | 'manual'
  | 'other';
export type InvoiceDeliveryStatus =
  | 'prepared'
  | 'attempted'
  | 'succeeded'
  | 'failed'
  | 'outcomeUnknown';

export interface InvoiceDeliveryEventSummary {
  id: string;
  createdAt: string;
  deliveryMethod: InvoiceDeliveryMethod;
  provider: InvoiceDeliveryProvider;
  recipientEmail: string;
  ccEmail: string;
  safeErrorMessage: string | null;
  status: InvoiceDeliveryStatus;
}

export interface ApprovedInvoicesApi {
  cancelApprovedInvoice(
    id: string,
    input: CancelApprovedInvoiceInput,
  ): Promise<CancelledApprovedInvoice>;
  copyApprovedInvoiceToDraft(id: string): Promise<InvoiceDraft>;
  createApprovedInvoicePdf(id: string): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoicePdfMetadata(
    id: string,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoice(id: string): Promise<ApprovedInvoiceView>;
  getInvoiceCreditContext(id: string): Promise<InvoiceCreditContext>;
  getApprovedInvoicePdfUrl(id: string): string;
  listApprovedInvoices(
    query: ApprovedInvoiceListQuery,
  ): Promise<ApprovedInvoiceListPage>;
  listSentInvoiceGroups(
    query: SentInvoiceGroupListQuery,
  ): Promise<SentInvoiceGroupListPage>;
  listInvoiceDeliveryEvents(
    id: string,
  ): Promise<InvoiceDeliveryEventSummary[]>;
  markInvoicePaid(
    id: string,
    input: MarkInvoicePaidInput,
  ): Promise<InvoicePaymentSummary>;
  markApprovedInvoiceSent(
    id: string,
    deliveryMethod: InvoiceManualDeliveryMethod,
  ): Promise<ApprovedInvoiceView>;
  prepareApprovedInvoiceEmailDryRun(
    id: string,
  ): Promise<ApprovedInvoiceEmailPreview>;
  prepareApprovedInvoiceEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): Promise<ApprovedInvoiceEmailSmtpTestPreparation>;
  prepareApprovedInvoiceEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
  ): Promise<ApprovedInvoiceEmailSmtpPreparation>;
  sendApprovedInvoiceEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): Promise<ApprovedInvoiceEmailDryRunSendResult>;
  sendApprovedInvoiceEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestSendInput,
  ): Promise<ApprovedInvoiceEmailSmtpTestSendResult>;
  sendApprovedInvoiceEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpSendInput,
  ): Promise<ApprovedInvoiceEmailSmtpSendResult>;
  reopenApprovedInvoiceForEditing(id: string): Promise<ReopenedApprovedInvoice>;
  revertInvoicePaidMark(id: string): Promise<InvoicePaymentSummary>;
}
