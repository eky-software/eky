import type {
  InvoiceDraftInput,
  InvoiceLineDiscount,
  InvoicePerformancePeriod,
} from '@eky/api-client';

import type { InvoiceRowForm } from './invoiceRowFormState.js';
import type { NewInvoiceFormState } from './newInvoiceFormState.js';
import { normalizeInvoiceUnit } from './invoiceUnitValidation.js';

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

export function parseOptionalPercentageBasisPoints(
  value: string,
): number | undefined | null {
  return value.trim() === '' ? undefined : parsePercentageBasisPoints(value);
}

export function toInvoiceDraftInput(
  form: NewInvoiceFormState,
): InvoiceDraftInput {
  const paymentTermDays = parseNonNegativeInteger(form.paymentTermDays);
  const reminderPeriodDays = parseOptionalNonNegativeInteger(
    form.reminderPeriodDays,
  );
  const latePaymentInterestBasisPoints =
    parseOptionalPercentageBasisPoints(form.latePaymentInterestPercent);

  if (
    paymentTermDays === null ||
    reminderPeriodDays === null ||
    latePaymentInterestBasisPoints === null ||
    form.lines.length === 0
  ) {
    throw new InvoiceDraftFormMappingError();
  }

  const input: InvoiceDraftInput = {
    customerId: form.customerId.trim(),
    invoiceDate: form.invoiceDate.trim(),
    dueDate: form.dueDate.trim(),
    paymentTermDays,
    priceInputMode: form.priceInputMode,
    taxTreatment: form.taxTreatment,
    performancePeriod: mapPerformancePeriod(form),
    lines: form.lines.map((row) => mapInvoiceDraftLine(row, form)),
  };

  addOptionalTrimmedString(
    input,
    'billingRecipientCustomerId',
    form.billingRecipientCustomerId,
  );

  if (reminderPeriodDays !== undefined) {
    input.reminderPeriodDays = reminderPeriodDays;
  }

  if (latePaymentInterestBasisPoints !== undefined) {
    input.latePaymentInterestBasisPoints =
      latePaymentInterestBasisPoints;
  }

  addOptionalTrimmedString(input, 'subject', form.subject);
  addOptionalTrimmedString(input, 'orderNumber', form.orderNumber);
  addOptionalTrimmedString(input, 'note', form.note);
  addOptionalTrimmedString(
    input,
    'deliveryAddressText',
    form.deliveryAddressText,
  );

  return input;
}

function mapInvoiceDraftLine(
  row: InvoiceRowForm,
  form: NewInvoiceFormState,
) {
  const quantityHundredths = parseQuantityHundredths(row.quantity);
  const unitPriceCents = parseEuroCents(row.unitPrice);

  if (quantityHundredths === null || unitPriceCents === null) {
    throw new InvoiceDraftFormMappingError();
  }

  if (
    form.taxTreatment === 'normalVat' &&
    (row.vatRateBasisPoints === null || row.vatRateBasisPoints <= 0)
  ) {
    throw new InvoiceDraftFormMappingError();
  }

  return {
    description: row.description.trim(),
    quantityHundredths,
    unit: normalizeInvoiceUnit(row.unit),
    unitPriceCents,
    vatRateBasisPoints:
      form.taxTreatment === 'reverseChargeConstruction'
        ? null
        : row.vatRateBasisPoints,
    discount: mapDiscount(row),
  };
}

function mapPerformancePeriod(
  form: NewInvoiceFormState,
): InvoicePerformancePeriod {
  if (form.performancePeriodType === 'singleDate') {
    return {
      type: 'singleDate',
      date: form.performanceDate.trim(),
    };
  }

  if (form.performancePeriodType === 'dateRange') {
    return {
      type: 'dateRange',
      startDate: form.performancePeriodStart.trim(),
      endDate: form.performancePeriodEnd.trim(),
    };
  }

  return { type: 'invoiceDate' };
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

function parseOptionalNonNegativeInteger(
  value: string,
): number | undefined | null {
  return value.trim() === '' ? undefined : parseNonNegativeInteger(value);
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
  FieldName extends
    | 'billingRecipientCustomerId'
    | 'subject'
    | 'orderNumber'
    | 'note'
    | 'deliveryAddressText',
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
