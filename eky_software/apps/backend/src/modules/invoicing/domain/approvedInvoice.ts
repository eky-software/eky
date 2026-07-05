import type {
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';
import type { InvoiceUnit } from './invoiceDraft.js';
import type { InvoiceNumberingMode } from './invoiceNumbering.js';
import type { ReferenceNumberType } from './invoiceReferenceNumber.js';

export type ApprovedInvoiceStatus = 'approved';
export type StoredInvoiceStatus = ApprovedInvoiceStatus | 'reopened_for_edit';
export type InvoiceAuditAction =
  | 'invoice.approved'
  | 'invoice.reopened_for_edit'
  | 'invoice.reapproved';

export interface ApprovedInvoiceLine {
  id: string;
  invoiceId: string;
  lineOrder: number;
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
  createdAt: string;
}

export interface ApprovedInvoice {
  id: string;
  companyId: string;
  sourceDraftId: string;
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
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  totals: InvoiceTotals;
  lines: ApprovedInvoiceLine[];
  createdAt: string;
  approvedAt: string;
  updatedAt: string;
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
