import type { PriceInputMode, InvoiceVatBreakdown } from './invoiceCalculation.js';
import type { InvoiceNumberingMode } from './invoiceNumbering.js';
import type { InvoiceTaxTreatment } from './invoiceTaxTreatment.js';

export interface InvoiceScope {
  readonly companyId: string;
  readonly invoiceId: string;
}

export interface InvoiceRevisionKey extends InvoiceScope {
  readonly revisionId: string;
}

export interface InvoiceContentRevisionLine {
  readonly lineId: string;
  readonly invoiceId: string;
  readonly sourceInvoiceLineId: string | null;
  readonly sourceRevisionId: string | null;
  readonly lineOrder: number;
  readonly code: string;
  readonly description: string;
  readonly quantityHundredths: number;
  readonly unit: string;
  readonly unitPriceCents: number;
  readonly vatRateBasisPoints: number | null;
  readonly discountType: 'none' | 'percentage' | 'fixed';
  readonly discountValue: number;
  readonly baseCents: number;
  readonly discountCents: number;
  readonly netCents: number;
  readonly vatCents: number;
  readonly grossCents: number;
  readonly createdAt: string;
}

interface InvoiceRevisionContent extends InvoiceRevisionKey {
  readonly sourceDraftId: string;
  readonly invoiceKind: 'standard' | 'credit';
  readonly creditedInvoiceId: string | null;
  readonly creditedRevisionId: string | null;
  readonly creditedInvoiceNumberSnapshot: string | null;
  readonly creditedInvoiceDateSnapshot: string | null;
  readonly invoiceNumber: string;
  readonly referenceNumber: string | null;
  readonly referenceNumberType: 'finnishDomestic' | null;
  readonly seriesKey: string;
  readonly sequenceScope: string;
  readonly sequenceNumber: number;
  readonly numberingMode: InvoiceNumberingMode;
  readonly customerId: string;
  readonly customerNumberSnapshot: string;
  readonly customerNameSnapshot: string;
  readonly customerBusinessIdSnapshot: string;
  readonly customerTypeSnapshot: string;
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
  readonly billingRecipientCustomerTypeSnapshot: string;
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
  readonly subject: string;
  readonly orderNumber: string;
  readonly note: string;
  readonly deliveryAddressText: string;
  readonly refundIbanSnapshot: string;
  readonly taxTreatment: InvoiceTaxTreatment;
  readonly taxTreatmentLabelSnapshot: string;
  readonly taxLegalBasisSnapshot: string;
  readonly performanceDate: string | null;
  readonly performancePeriodStart: string | null;
  readonly performancePeriodEnd: string | null;
  readonly totalNetCents: number;
  readonly totalVatCents: number;
  readonly totalGrossCents: number;
  readonly createdAt: string;
  readonly approvedAt: string;
  readonly lines: readonly InvoiceContentRevisionLine[];
}

export type InvoiceContentRevision = InvoiceRevisionContent & (
  | {
      readonly origin: 'legacySnapshot';
      readonly vatBreakdownState: 'unavailable';
      readonly vatBreakdown: null;
    }
  | {
      readonly origin: 'approval' | 'validatedLegacySnapshot';
      readonly vatBreakdownState: 'authoritative';
      readonly vatBreakdown: readonly Readonly<InvoiceVatBreakdown>[];
    }
);
