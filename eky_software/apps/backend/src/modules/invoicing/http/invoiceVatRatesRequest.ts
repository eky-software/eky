import type { InvoiceVatRateSetting } from '../domain/invoiceVatRates.js';

const allowedBodyFields = new Set(['vatRates']);
const allowedRateFields = new Set([
  'rateBasisPoints',
  'label',
  'isActive',
  'isDefault',
  'sortOrder',
]);

export class InvoiceVatRatesRequestValidationError extends Error {
  constructor() {
    super('Invalid invoice VAT rates body.');
    this.name = 'InvoiceVatRatesRequestValidationError';
  }
}

export function parseUpdateInvoiceVatRatesRequest(
  body: unknown,
): InvoiceVatRateSetting[] {
  if (!isRecord(body) || hasUnknownFields(body, allowedBodyFields)) {
    throw new InvoiceVatRatesRequestValidationError();
  }

  if (!Array.isArray(body.vatRates)) {
    throw new InvoiceVatRatesRequestValidationError();
  }

  return body.vatRates.map(parseRate);
}

function parseRate(value: unknown): InvoiceVatRateSetting {
  if (!isRecord(value) || hasUnknownFields(value, allowedRateFields)) {
    throw new InvoiceVatRatesRequestValidationError();
  }

  if (
    typeof value.rateBasisPoints !== 'number' ||
    !Number.isSafeInteger(value.rateBasisPoints) ||
    typeof value.label !== 'string' ||
    typeof value.isActive !== 'boolean' ||
    typeof value.isDefault !== 'boolean' ||
    typeof value.sortOrder !== 'number' ||
    !Number.isSafeInteger(value.sortOrder)
  ) {
    throw new InvoiceVatRatesRequestValidationError();
  }

  return {
    rateBasisPoints: value.rateBasisPoints,
    label: value.label,
    isActive: value.isActive,
    isDefault: value.isDefault,
    sortOrder: value.sortOrder,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnknownFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): boolean {
  return Object.keys(value).some((fieldName) => !allowedFields.has(fieldName));
}
