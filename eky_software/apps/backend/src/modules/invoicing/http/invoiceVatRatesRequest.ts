import {
  hasOnlyAllowedFields,
  isRecord,
} from '../../../http/requestBody.js';
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
  if (!isRecord(body) || !hasOnlyAllowedFields(body, allowedBodyFields)) {
    throw new InvoiceVatRatesRequestValidationError();
  }

  if (!Array.isArray(body.vatRates)) {
    throw new InvoiceVatRatesRequestValidationError();
  }

  return body.vatRates.map(parseRate);
}

function parseRate(value: unknown): InvoiceVatRateSetting {
  if (!isRecord(value) || !hasOnlyAllowedFields(value, allowedRateFields)) {
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
