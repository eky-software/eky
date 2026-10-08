import type { ApprovedInvoicePdfContent } from '../domain/approvedInvoicePdfContent.js';
import type { InvoiceLineDiscount } from '../domain/invoiceCalculation.js';
import type {
  InvoiceContentRevision,
  InvoiceContentRevisionLine,
} from '../domain/invoiceContentRevision.js';
import { fromInvoicePerformancePeriodColumns } from '../domain/invoicePerformancePeriod.js';
import { InvoiceContentRevisionIntegrityError } from './invoiceContentRevisionIntegrityError.js';

export class InvoiceRevisionPdfContentUnavailableError extends Error {
  constructor() {
    super('Invoice content revision is not available for PDF rendering.');
    this.name = 'InvoiceRevisionPdfContentUnavailableError';
  }
}

// The caller supplies validated revision content; this does not authorize publication.
export function toInvoiceRevisionPdfContent(
  revision: InvoiceContentRevision,
): ApprovedInvoicePdfContent {
  // Preserved legacy history is valid, but does not establish a rendering source.
  if (
    revision.origin === 'legacySnapshot' &&
    revision.vatBreakdownState === 'unavailable' &&
    revision.vatBreakdown === null
  ) {
    throw new InvoiceRevisionPdfContentUnavailableError();
  }

  if (
    (revision.origin !== 'approval' && revision.origin !== 'validatedLegacySnapshot') ||
    revision.vatBreakdownState !== 'authoritative' ||
    !Array.isArray(revision.vatBreakdown)
  ) {
    throw new InvoiceContentRevisionIntegrityError();
  }

  return {
    invoiceKind: revision.invoiceKind,
    creditedInvoiceNumber: revision.creditedInvoiceNumberSnapshot,
    creditedInvoiceDate: revision.creditedInvoiceDateSnapshot,
    invoiceNumber: revision.invoiceNumber,
    // A missing reference is displayed as blank, never generated for a credit.
    referenceNumber: revision.referenceNumber ?? '',
    customerNumberSnapshot: revision.customerNumberSnapshot,
    customerNameSnapshot: revision.customerNameSnapshot,
    customerBusinessIdSnapshot: revision.customerBusinessIdSnapshot,
    customerEmailSnapshot: revision.customerEmailSnapshot,
    customerPhoneSnapshot: revision.customerPhoneSnapshot,
    customerStreetAddressSnapshot: revision.customerStreetAddressSnapshot,
    customerPostalCodeSnapshot: revision.customerPostalCodeSnapshot,
    customerCitySnapshot: revision.customerCitySnapshot,
    companyNameSnapshot: revision.companyNameSnapshot,
    companyBusinessIdSnapshot: revision.companyBusinessIdSnapshot,
    companyVatNumberSnapshot: revision.companyVatNumberSnapshot,
    companyStreetAddressSnapshot: revision.companyStreetAddressSnapshot,
    companyPostalCodeSnapshot: revision.companyPostalCodeSnapshot,
    companyCitySnapshot: revision.companyCitySnapshot,
    companyEmailSnapshot: revision.companyEmailSnapshot,
    companyPhoneSnapshot: revision.companyPhoneSnapshot,
    companyWebsiteSnapshot: revision.companyWebsiteSnapshot,
    companyIbanSnapshot: revision.companyIbanSnapshot,
    companyBicSnapshot: revision.companyBicSnapshot,
    companyBankNameSnapshot: revision.companyBankNameSnapshot,
    billingRecipientCustomerId: revision.billingRecipientCustomerId,
    billingRecipientCustomerNumberSnapshot: revision.billingRecipientCustomerNumberSnapshot,
    billingRecipientNameSnapshot: revision.billingRecipientNameSnapshot,
    billingRecipientBusinessIdSnapshot: revision.billingRecipientBusinessIdSnapshot,
    billingRecipientEmailSnapshot: revision.billingRecipientEmailSnapshot,
    billingRecipientPhoneSnapshot: revision.billingRecipientPhoneSnapshot,
    billingRecipientStreetAddressSnapshot: revision.billingRecipientStreetAddressSnapshot,
    billingRecipientPostalCodeSnapshot: revision.billingRecipientPostalCodeSnapshot,
    billingRecipientCitySnapshot: revision.billingRecipientCitySnapshot,
    invoiceDate: revision.invoiceDate,
    dueDate: revision.dueDate,
    paymentTermDays: revision.paymentTermDays,
    reminderPeriodDays: revision.reminderPeriodDays,
    latePaymentInterestBasisPoints: revision.latePaymentInterestBasisPoints,
    priceInputMode: revision.priceInputMode,
    taxTreatment: revision.taxTreatment,
    taxTreatmentLabelSnapshot: revision.taxTreatmentLabelSnapshot,
    taxLegalBasisSnapshot: revision.taxLegalBasisSnapshot,
    performancePeriod: fromInvoicePerformancePeriodColumns(revision),
    orderNumber: revision.orderNumber,
    note: revision.note,
    deliveryAddressText: revision.deliveryAddressText,
    refundIbanSnapshot: revision.refundIbanSnapshot,
    lines: revision.lines.map((line) => ({
      code: line.code,
      description: line.description,
      quantityHundredths: line.quantityHundredths,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      vatRateBasisPoints: line.vatRateBasisPoints,
      discount: toDiscount(line),
      netCents: line.netCents,
      grossCents: line.grossCents,
    })),
    totals: {
      netTotalCents: revision.totalNetCents,
      vatTotalCents: revision.totalVatCents,
      grossTotalCents: revision.totalGrossCents,
    },
    vatBreakdown: revision.vatBreakdown.map((group) => ({
      vatRateBasisPoints: group.vatRateBasisPoints,
      netCents: group.netCents,
      vatCents: group.vatCents,
      grossCents: group.grossCents,
    })),
  };
}

function toDiscount(line: InvoiceContentRevisionLine): InvoiceLineDiscount {
  switch (line.discountType) {
    case 'none':
      return { type: 'none' };
    case 'percentage':
      return { type: 'percentage', basisPoints: line.discountValue };
    case 'fixed':
      return { type: 'fixed', amountCents: line.discountValue };
    default:
      throw new InvoiceContentRevisionIntegrityError();
  }
}
