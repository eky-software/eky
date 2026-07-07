import { EkyApiError } from '../../http.js';
import type {
  InvoiceDraftInput,
  InvoiceDraftLineInput,
  InvoiceLineDiscount,
} from './invoiceDraftsTypes.js';

export function serializeInvoiceDraftInput(
  input: InvoiceDraftInput,
): InvoiceDraftInput {
  const body: InvoiceDraftInput = {
    customerId: input.customerId,
    invoiceDate: input.invoiceDate,
    priceInputMode: input.priceInputMode,
    lines: input.lines.map(serializeInvoiceDraftLineInput),
  };

  if (input.billingRecipientCustomerId !== undefined) {
    body.billingRecipientCustomerId = input.billingRecipientCustomerId;
  }

  if (input.dueDate !== undefined) {
    body.dueDate = input.dueDate;
  }

  if (input.paymentTermDays !== undefined) {
    body.paymentTermDays = input.paymentTermDays;
  }

  if (input.reminderPeriodDays !== undefined) {
    body.reminderPeriodDays = input.reminderPeriodDays;
  }

  if (input.latePaymentInterestBasisPoints !== undefined) {
    body.latePaymentInterestBasisPoints =
      input.latePaymentInterestBasisPoints;
  }

  if (input.subject !== undefined) {
    body.subject = input.subject;
  }

  if (input.orderNumber !== undefined) {
    body.orderNumber = input.orderNumber;
  }

  if (input.note !== undefined) {
    body.note = input.note;
  }

  if (input.deliveryAddressText !== undefined) {
    body.deliveryAddressText = input.deliveryAddressText;
  }

  return body;
}

function serializeInvoiceDraftLineInput(
  input: InvoiceDraftLineInput,
): InvoiceDraftLineInput {
  const line: InvoiceDraftLineInput = {
    description: input.description,
    quantityHundredths: input.quantityHundredths,
    unit: input.unit,
    unitPriceCents: input.unitPriceCents,
    vatRateBasisPoints: input.vatRateBasisPoints,
    discount: serializeDiscount(input.discount),
  };

  if (input.code !== undefined) {
    line.code = input.code;
  }

  return line;
}

function serializeDiscount(
  discount: InvoiceLineDiscount,
): InvoiceLineDiscount {
  if (discount.type === 'none') {
    return { type: 'none' };
  }

  if (discount.type === 'percentage') {
    return {
      type: 'percentage',
      basisPoints: discount.basisPoints,
    };
  }

  if (discount.type === 'fixed') {
    return {
      type: 'fixed',
      amountCents: discount.amountCents,
    };
  }

  throw new EkyApiError('Invalid invoice draft input.');
}
