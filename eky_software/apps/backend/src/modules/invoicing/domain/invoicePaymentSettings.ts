import { InvoicePaymentSettingsError } from './invoicePaymentSettingsError.js';

export interface InvoicePaymentSettings {
  defaultLatePaymentInterestBasisPoints: number;
  defaultReminderPeriodDays: number;
}

export interface StoredInvoicePaymentSettings extends InvoicePaymentSettings {
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export const maxLatePaymentInterestBasisPoints = 100000;
export const maxReminderPeriodDays = 365;

function requireIntegerInRange(
  value: number,
  fieldName: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value)) {
    throw new InvoicePaymentSettingsError(`${fieldName} must be a safe integer.`);
  }

  if (value < minimum || value > maximum) {
    throw new InvoicePaymentSettingsError(
      `${fieldName} must be between ${minimum} and ${maximum}.`,
    );
  }
}

export function validateInvoicePaymentSettings(
  settings: InvoicePaymentSettings,
): void {
  requireIntegerInRange(
    settings.defaultLatePaymentInterestBasisPoints,
    'Default late payment interest',
    0,
    maxLatePaymentInterestBasisPoints,
  );
  requireIntegerInRange(
    settings.defaultReminderPeriodDays,
    'Default reminder period days',
    0,
    maxReminderPeriodDays,
  );
}
