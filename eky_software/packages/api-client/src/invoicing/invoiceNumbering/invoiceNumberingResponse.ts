import { EkyApiError, isRecord } from '../../http.js';
import type {
  InvoiceNumberingSettingsMode,
  InvoiceNumberingSettingsView,
} from './invoiceNumberingTypes.js';

export function readInvoiceNumberingSettingsResponse(
  responseBody: unknown,
): InvoiceNumberingSettingsView {
  if (!isRecord(responseBody)) {
    throw invalidInvoiceNumberingSettingsResponse(responseBody);
  }

  return parseInvoiceNumberingSettingsView(
    responseBody.invoiceNumberingSettings,
  );
}

function parseInvoiceNumberingSettingsView(
  value: unknown,
): InvoiceNumberingSettingsView {
  if (!isRecord(value)) {
    throw invalidInvoiceNumberingSettingsResponse(value);
  }

  return {
    seriesKey: readString(value, 'seriesKey'),
    mode: parseInvoiceNumberingSettingsMode(value.mode),
    fiscalYearStartMonth: readSafeInteger(value, 'fiscalYearStartMonth'),
    sequencePadding: readSafeInteger(value, 'sequencePadding'),
    firstSequenceNumber: readSafeInteger(value, 'firstSequenceNumber'),
    hasUsedNumbering: readBoolean(value, 'hasUsedNumbering'),
    isPersisted: readBoolean(value, 'isPersisted'),
  };
}

function parseInvoiceNumberingSettingsMode(
  value: unknown,
): InvoiceNumberingSettingsMode {
  if (
    value === 'calendarYearSequence' ||
    value === 'fiscalYearSequence' ||
    value === 'plainSequence'
  ) {
    return value;
  }

  throw invalidInvoiceNumberingSettingsResponse(value);
}

function readString(value: Record<string, unknown>, fieldName: string): string {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidInvoiceNumberingSettingsResponse(value);
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw invalidInvoiceNumberingSettingsResponse(value);
}

function readBoolean(
  value: Record<string, unknown>,
  fieldName: string,
): boolean {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'boolean') {
    return fieldValue;
  }

  throw invalidInvoiceNumberingSettingsResponse(value);
}

function invalidInvoiceNumberingSettingsResponse(
  responseBody: unknown,
): EkyApiError {
  return new EkyApiError('Invalid invoice numbering settings response.', {
    responseBody,
  });
}
