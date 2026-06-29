import { EkyApiError, isRecord } from '../http.js';
import type {
  InvoicePaymentSettingsView,
} from './invoicePaymentSettingsTypes.js';

export function readInvoicePaymentSettingsResponse(
  responseBody: unknown,
): InvoicePaymentSettingsView {
  if (!isRecord(responseBody)) {
    throw invalidInvoicePaymentSettingsResponse(responseBody);
  }

  return parseInvoicePaymentSettingsView(responseBody.invoicePaymentSettings);
}

function parseInvoicePaymentSettingsView(
  value: unknown,
): InvoicePaymentSettingsView {
  if (!isRecord(value)) {
    throw invalidInvoicePaymentSettingsResponse(value);
  }

  return {
    defaultLatePaymentInterestBasisPoints: readSafeInteger(
      value,
      'defaultLatePaymentInterestBasisPoints',
    ),
    defaultReminderPeriodDays: readSafeInteger(
      value,
      'defaultReminderPeriodDays',
    ),
    isPersisted: readBoolean(value, 'isPersisted'),
  };
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw invalidInvoicePaymentSettingsResponse(value);
}

function readBoolean(
  value: Record<string, unknown>,
  fieldName: string,
): boolean {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'boolean') {
    return fieldValue;
  }

  throw invalidInvoicePaymentSettingsResponse(value);
}

function invalidInvoicePaymentSettingsResponse(
  responseBody: unknown,
): EkyApiError {
  return new EkyApiError('Invalid invoice payment settings response.', {
    responseBody,
  });
}
