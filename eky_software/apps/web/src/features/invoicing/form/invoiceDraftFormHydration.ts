import type { InvoiceDraft, InvoiceLineDiscount } from '@eky/api-client';

import type {
  InvoiceRowDiscountType,
  InvoiceRowForm,
} from './invoiceRowFormState.js';
import type { NewInvoiceFormState } from './newInvoiceFormState.js';

export function toNewInvoiceFormStateFromDraft(
  draft: InvoiceDraft,
  previousLines: InvoiceRowForm[] = [],
): NewInvoiceFormState {
  return {
    billingRecipientCustomerId: draft.billingRecipientCustomerId ?? '',
    customerId: draft.customerId,
    deliveryAddressText: draft.deliveryAddressText,
    dueDate: draft.dueDate,
    invoiceDate: draft.invoiceDate,
    latePaymentInterestPercent: formatScaledInput(
      draft.latePaymentInterestBasisPoints,
    ),
    lines: draft.lines.map((line, index) => ({
      description: line.description,
      discountType: getDiscountType(line.discount),
      discountValue: formatDiscountValue(line.discount),
      id: `invoice-row-${index + 1}`,
      hourlyRateAutofillState:
        previousLines[index]?.hourlyRateAutofillState ?? 'blocked',
      quantity: formatScaledInput(line.quantityHundredths),
      unit: line.unit,
      unitPrice: formatScaledInput(line.unitPriceCents),
      vatRateBasisPoints: line.vatRateBasisPoints,
    })),
    note: draft.note,
    orderNumber: draft.orderNumber,
    paymentTermDays: String(draft.paymentTermDays),
    performanceDate:
      draft.performancePeriod.type === 'singleDate'
        ? draft.performancePeriod.date
        : '',
    performancePeriodEnd:
      draft.performancePeriod.type === 'dateRange'
        ? draft.performancePeriod.endDate
        : '',
    performancePeriodStart:
      draft.performancePeriod.type === 'dateRange'
        ? draft.performancePeriod.startDate
        : '',
    performancePeriodType: draft.performancePeriod.type,
    priceInputMode: draft.priceInputMode,
    reminderPeriodDays: String(draft.reminderPeriodDays),
    subject: draft.subject,
    taxTreatment: draft.taxTreatment,
  };
}

function getDiscountType(discount: InvoiceLineDiscount): InvoiceRowDiscountType {
  return discount.type;
}

function formatDiscountValue(discount: InvoiceLineDiscount): string {
  if (discount.type === 'none') {
    return '';
  }

  if (discount.type === 'percentage') {
    return formatScaledInput(discount.basisPoints);
  }

  return formatScaledInput(discount.amountCents);
}

function formatScaledInput(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absoluteValue = Math.abs(value);
  const wholePart = Math.floor(absoluteValue / 100);
  const fractionPart = String(absoluteValue % 100).padStart(2, '0');

  return `${sign}${wholePart},${fractionPart}`;
}
