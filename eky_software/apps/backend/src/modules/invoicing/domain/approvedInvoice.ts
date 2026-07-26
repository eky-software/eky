import type {
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';
import type { InvoiceUnit } from './invoiceDraft.js';
import type { InvoiceKind } from './invoiceKind.js';
import type { InvoiceNumberingMode } from './invoiceNumbering.js';
import type { InvoicePerformancePeriod } from './invoicePerformancePeriod.js';
import type { ReferenceNumberType } from './invoiceReferenceNumber.js';
import type { InvoiceTaxTreatment } from './invoiceTaxTreatment.js';

export type ApprovedInvoiceStatus = 'approved' | 'sent' | 'cancelled';
export type StoredInvoiceStatus = ApprovedInvoiceStatus | 'reopened_for_edit';
export type InvoiceAuditAction =
  | 'invoice.approved'
  | 'invoice.cancelled'
  | 'invoice.credit_draft_created'
  | 'invoice.credit_approved'
  | 'invoice.credit_reapproved'
  | 'invoice.marked_sent_manually'
  | 'invoice.reopened_for_edit'
  | 'invoice.reapproved';

export interface ApprovedInvoiceLine {
  id: string;
  invoiceId: string;
  sourceInvoiceLineId: string | null;
  lineOrder: number;
  code: string;
  description: string;
  quantityHundredths: number;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number | null;
  discount: InvoiceLineDiscount;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
  createdAt: string;
}

export interface ApprovedInvoice {
  id: string;
  companyId: string;
  sourceDraftId: string;
  invoiceKind: InvoiceKind;
  creditedInvoiceId: string | null;
  invoiceNumber: string;
  referenceNumber: string;
  referenceNumberType: ReferenceNumberType;
  seriesKey: string;
  sequenceScope: string;
  sequenceNumber: number;
  numberingMode: InvoiceNumberingMode;
  status: ApprovedInvoiceStatus;
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
  priceInputMode: PriceInputMode;
  taxTreatment: InvoiceTaxTreatment;
  taxTreatmentLabelSnapshot: string;
  taxLegalBasisSnapshot: string;
  performancePeriod: InvoicePerformancePeriod;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  totals: InvoiceTotals;
  lines: ApprovedInvoiceLine[];
  createdAt: string;
  approvedAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
}

export interface InvoiceAuditEvent {
  id: string;
  companyId: string;
  actorUserId: string;
  action: InvoiceAuditAction;
  draftId: string;
  invoiceId: string;
  invoiceNumber: string;
  createdAt: string;
}
