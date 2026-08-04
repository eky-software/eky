import {
  hasOnlyAllowedFields,
  isRecord,
} from '../../../http/requestBody.js';

export interface UpdateInvoicePaymentSettingsRequest {
  defaultLatePaymentInterestBasisPoints: number;
  defaultReminderPeriodDays: number;
}

const allowedInvoicePaymentSettingsFields = new Set([
  'defaultLatePaymentInterestBasisPoints',
  'defaultReminderPeriodDays',
]);

export class InvoicePaymentSettingsRequestValidationError extends Error {
  constructor() {
    super('Invalid invoice payment settings body.');
    this.name = 'InvoicePaymentSettingsRequestValidationError';
  }
}

function assertAllowedFields(value: Record<string, unknown>): void {
  if (!hasOnlyAllowedFields(value, allowedInvoicePaymentSettingsFields)) {
    throw new InvoicePaymentSettingsRequestValidationError();
  }
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw new InvoicePaymentSettingsRequestValidationError();
}

export function parseUpdateInvoicePaymentSettingsRequest(
  body: unknown,
): UpdateInvoicePaymentSettingsRequest {
  if (!isRecord(body)) {
    throw new InvoicePaymentSettingsRequestValidationError();
  }

  assertAllowedFields(body);

  return {
    defaultLatePaymentInterestBasisPoints: readSafeInteger(
      body,
      'defaultLatePaymentInterestBasisPoints',
    ),
    defaultReminderPeriodDays: readSafeInteger(
      body,
      'defaultReminderPeriodDays',
    ),
  };
}
