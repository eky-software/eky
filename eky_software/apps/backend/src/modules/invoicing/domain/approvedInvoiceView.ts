import type {
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';
import type { InvoiceUnit } from './invoiceDraft.js';
import type { InvoiceKind } from './invoiceKind.js';
import type { InvoiceNumberingMode } from './invoiceNumbering.js';
import type { ReferenceNumberType } from './invoiceReferenceNumber.js';

export type ApprovedInvoiceViewStatus = 'approved' | 'sent' | 'cancelled';

export interface ApprovedInvoiceViewLine {
  id: string;
  sourceInvoiceLineId: string | null;
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
}

export interface ApprovedInvoiceVatBreakdown {
  vatRateBasisPoints: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface ApprovedInvoiceView {
  id: string;
  companyId: string;
  sourceDraftId: string;
  invoiceKind: InvoiceKind;
  creditedInvoiceId: string | null;
  creditedInvoiceNumber: string | null;
  creditedInvoiceDate: string | null;
  invoiceNumber: string;
  referenceNumber: string;
  referenceNumberType: ReferenceNumberType;
  seriesKey: string;
  sequenceScope: string;
  sequenceNumber: number;
  numberingMode: InvoiceNumberingMode;
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
  priceInputMode: PriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  refundIbanSnapshot: string;
  lines: ApprovedInvoiceViewLine[];
  totals: InvoiceTotals;
  vatBreakdown: ApprovedInvoiceVatBreakdown[];
  createdAt: string;
  approvedAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
}
