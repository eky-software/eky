import type {
  InvoiceLineDiscount,
  InvoiceVatBreakdown,
  PriceInputMode,
} from './invoiceCalculation.js';
import type { InvoiceKind } from './invoiceKind.js';
import type { InvoicePerformancePeriod } from './invoicePerformancePeriod.js';
import type { InvoiceTaxTreatment } from './invoiceTaxTreatment.js';

export interface ApprovedInvoicePdfContentLine {
  readonly code: string;
  readonly description: string;
  readonly quantityHundredths: number;
  readonly unit: string;
  readonly unitPriceCents: number;
  readonly vatRateBasisPoints: number | null;
  readonly discount: Readonly<InvoiceLineDiscount>;
  readonly netCents: number;
  readonly grossCents: number;
}

// Rendering content only: no live lifecycle/payment state or publication authority.
export interface ApprovedInvoicePdfContent {
  readonly invoiceKind: InvoiceKind;
  readonly creditedInvoiceNumber: string | null;
  readonly creditedInvoiceDate: string | null;
  readonly invoiceNumber: string;
  readonly referenceNumber: string;
  readonly customerNumberSnapshot: string;
  readonly customerNameSnapshot: string;
  readonly customerBusinessIdSnapshot: string;
  readonly customerEmailSnapshot: string;
  readonly customerPhoneSnapshot: string;
  readonly customerStreetAddressSnapshot: string;
  readonly customerPostalCodeSnapshot: string;
  readonly customerCitySnapshot: string;
  readonly companyNameSnapshot: string;
  readonly companyBusinessIdSnapshot: string;
  readonly companyVatNumberSnapshot: string;
  readonly companyStreetAddressSnapshot: string;
  readonly companyPostalCodeSnapshot: string;
  readonly companyCitySnapshot: string;
  readonly companyEmailSnapshot: string;
  readonly companyPhoneSnapshot: string;
  readonly companyWebsiteSnapshot: string;
  readonly companyIbanSnapshot: string;
  readonly companyBicSnapshot: string;
  readonly companyBankNameSnapshot: string;
  readonly billingRecipientCustomerId: string | null;
  readonly billingRecipientCustomerNumberSnapshot: string;
  readonly billingRecipientNameSnapshot: string;
  readonly billingRecipientBusinessIdSnapshot: string;
  readonly billingRecipientEmailSnapshot: string;
  readonly billingRecipientPhoneSnapshot: string;
  readonly billingRecipientStreetAddressSnapshot: string;
  readonly billingRecipientPostalCodeSnapshot: string;
  readonly billingRecipientCitySnapshot: string;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly paymentTermDays: number;
  readonly reminderPeriodDays: number;
  readonly latePaymentInterestBasisPoints: number;
  readonly priceInputMode: PriceInputMode;
  readonly taxTreatment: InvoiceTaxTreatment;
  readonly taxTreatmentLabelSnapshot: string;
  readonly taxLegalBasisSnapshot: string;
  readonly performancePeriod: Readonly<InvoicePerformancePeriod>;
  readonly orderNumber: string;
  readonly note: string;
  readonly deliveryAddressText: string;
  readonly refundIbanSnapshot: string;
  readonly lines: readonly ApprovedInvoicePdfContentLine[];
  readonly totals: {
    readonly netTotalCents: number;
    readonly vatTotalCents: number;
    readonly grossTotalCents: number;
  };
  readonly vatBreakdown: readonly Readonly<InvoiceVatBreakdown>[];
}
