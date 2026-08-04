import {
  hasOnlyAllowedFields,
  isRecord,
} from '../../../http/requestBody.js';
import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';

export interface UpdateInvoiceNumberingSettingsRequest {
  firstSequenceNumber: number;
  fiscalYearStartMonth: number;
  mode: InvoiceNumberingMode;
  sequencePadding: number;
}

const allowedInvoiceNumberingSettingsFields = new Set([
  'mode',
  'fiscalYearStartMonth',
  'sequencePadding',
  'firstSequenceNumber',
]);

export class InvoiceNumberingSettingsRequestValidationError extends Error {
  constructor() {
    super('Invalid invoice numbering settings body.');
    this.name = 'InvoiceNumberingSettingsRequestValidationError';
  }
}

function assertAllowedFields(value: Record<string, unknown>): void {
  if (!hasOnlyAllowedFields(value, allowedInvoiceNumberingSettingsFields)) {
    throw new InvoiceNumberingSettingsRequestValidationError();
  }
}

function readInvoiceNumberingMode(
  value: Record<string, unknown>,
): InvoiceNumberingMode {
  const mode = value.mode;

  if (
    mode === 'calendarYearSequence' ||
    mode === 'fiscalYearSequence' ||
    mode === 'plainSequence'
  ) {
    return mode;
  }

  throw new InvoiceNumberingSettingsRequestValidationError();
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw new InvoiceNumberingSettingsRequestValidationError();
}

export function parseUpdateInvoiceNumberingSettingsRequest(
  body: unknown,
): UpdateInvoiceNumberingSettingsRequest {
  if (!isRecord(body)) {
    throw new InvoiceNumberingSettingsRequestValidationError();
  }

  assertAllowedFields(body);

  return {
    mode: readInvoiceNumberingMode(body),
    fiscalYearStartMonth: readSafeInteger(body, 'fiscalYearStartMonth'),
    sequencePadding: readSafeInteger(body, 'sequencePadding'),
    firstSequenceNumber: readSafeInteger(body, 'firstSequenceNumber'),
  };
}
