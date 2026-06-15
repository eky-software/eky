import type {
  InvoiceDraftInput,
  InvoiceLineDiscount,
} from '@eky/api-client';

import type { InvoiceRowForm } from './invoiceRowFormState.js';
import type { NewInvoiceFormState } from './newInvoiceFormState.js';

export class InvoiceDraftFormMappingError extends Error {
  constructor() {
    super('Invoice draft form contains invalid values.');
    this.name = 'InvoiceDraftFormMappingError';
  }
}

export function parseQuantityHundredths(value: string): number | null {
  return parseScaledDecimal(value, 2);
}

export function parseEuroCents(value: string): number | null {
  return parseScaledDecimal(value, 2);
}

export function parsePercentageBasisPoints(value: string): number | null {
  return parseScaledDecimal(value, 2);
}

export function toInvoiceDraftInput(
  form: NewInvoiceFormState,
): InvoiceDraftInput {
  const paymentTermDays = parseNonNegativeInteger(form.paymentTermDays);

  if (paymentTermDays === null || form.lines.length === 0) {
    throw new InvoiceDraftFormMappingError();
  }

  const input: InvoiceDraftInput = {
    customerId: form.customerId.trim(),
    invoiceDate: form.invoiceDate.trim(),
    dueDate: form.dueDate.trim(),
    paymentTermDays,
    priceInputMode: form.priceInputMode,
    lines: form.lines.map(mapInvoiceDraftLine),
  };

  addOptionalTrimmedString(input, 'subject', form.subject);
  addOptionalTrimmedString(input, 'orderNumber', form.orderNumber);
  addOptionalTrimmedString(input, 'note', form.note);

  return input;
}

function mapInvoiceDraftLine(row: InvoiceRowForm) {
  const quantityHundredths = parseQuantityHundredths(row.quantity);
  const unitPriceCents = parseEuroCents(row.unitPrice);

  if (quantityHundredths === null || unitPriceCents === null) {
    throw new InvoiceDraftFormMappingError();
  }

  return {
    description: row.description.trim(),
    quantityHundredths,
    unit: row.unit,
    unitPriceCents,
    vatRateBasisPoints: row.vatRateBasisPoints,
    discount: mapDiscount(row),
  };
}

function mapDiscount(row: InvoiceRowForm): InvoiceLineDiscount {
  if (row.discountType === 'none') {
    return { type: 'none' };
  }

  if (row.discountType === 'percentage') {
    const basisPoints = parsePercentageBasisPoints(row.discountValue);

    if (basisPoints === null) {
      throw new InvoiceDraftFormMappingError();
    }

    return {
      type: 'percentage',
      basisPoints,
    };
  }

  const amountCents = parseEuroCents(row.discountValue);

  if (amountCents === null) {
    throw new InvoiceDraftFormMappingError();
  }

  return {
    type: 'fixed',
    amountCents,
  };
}

function parseNonNegativeInteger(value: string): number | null {
  const normalizedValue = value.trim();

  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isSafeInteger(parsedValue) ? parsedValue : null;
}

function parseScaledDecimal(
  value: string,
  decimalPlaces: number,
): number | null {
  const normalizedValue = value.trim().replace(',', '.');
  const match = normalizedValue.match(/^(\d+)(?:\.(\d{1,2}))?$/);

  if (match === null || decimalPlaces !== 2) {
    return null;
  }

  const wholePartText = match[1];

  if (wholePartText === undefined) {
    return null;
  }

  const wholePart = BigInt(wholePartText);
  const fractionPart = BigInt((match[2] ?? '').padEnd(decimalPlaces, '0'));
  const scaledValue =
    wholePart * BigInt(10 ** decimalPlaces) + fractionPart;

  if (scaledValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  return Number(scaledValue);
}

function addOptionalTrimmedString<
  FieldName extends 'subject' | 'orderNumber' | 'note',
>(
  input: InvoiceDraftInput,
  fieldName: FieldName,
  value: string,
): void {
  const trimmedValue = value.trim();

  if (trimmedValue !== '') {
    input[fieldName] = trimmedValue;
  }
}
