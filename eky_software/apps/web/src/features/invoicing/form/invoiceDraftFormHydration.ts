import type { InvoiceDraft, InvoiceLineDiscount } from '@eky/api-client';

import type { InvoiceRowDiscountType } from './invoiceRowFormState.js';
import type { NewInvoiceFormState } from './newInvoiceFormState.js';

export function toNewInvoiceFormStateFromDraft(
  draft: InvoiceDraft,
): NewInvoiceFormState {
  return {
    customerId: draft.customerId,
    dueDate: draft.dueDate,
    invoiceDate: draft.invoiceDate,
    lines: draft.lines.map((line, index) => ({
      description: line.description,
      discountType: getDiscountType(line.discount),
      discountValue: formatDiscountValue(line.discount),
      id: `invoice-row-${index + 1}`,
      quantity: formatScaledInput(line.quantityHundredths),
      unit: line.unit,
      unitPrice: formatScaledInput(line.unitPriceCents),
      vatRateBasisPoints: line.vatRateBasisPoints,
    })),
    note: draft.note,
    orderNumber: draft.orderNumber,
    paymentTermDays: String(draft.paymentTermDays),
    priceInputMode: draft.priceInputMode,
    subject: draft.subject,
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
