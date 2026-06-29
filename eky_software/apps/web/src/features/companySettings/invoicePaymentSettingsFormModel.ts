import type {
  InvoicePaymentSettingsView,
  UpdateInvoicePaymentSettingsRequest,
} from '@eky/api-client';

export interface InvoicePaymentSettingsForm {
  defaultLatePaymentInterestPercent: string;
  defaultReminderPeriodDays: string;
}

export interface InvoicePaymentSettingsValidationErrors {
  defaultLatePaymentInterestPercent?: string;
  defaultReminderPeriodDays?: string;
}

export const initialInvoicePaymentSettingsForm: InvoicePaymentSettingsForm = {
  defaultLatePaymentInterestPercent: '0,00',
  defaultReminderPeriodDays: '8',
};

export function toInvoicePaymentSettingsForm(
  settings: InvoicePaymentSettingsView,
): InvoicePaymentSettingsForm {
  return {
    defaultLatePaymentInterestPercent: basisPointsToPercentInput(
      settings.defaultLatePaymentInterestBasisPoints,
    ),
    defaultReminderPeriodDays: String(settings.defaultReminderPeriodDays),
  };
}

export function validateInvoicePaymentSettingsForm(
  form: InvoicePaymentSettingsForm,
  messages: {
    latePaymentInterestInvalid: string;
    reminderPeriodDaysInvalid: string;
  },
): InvoicePaymentSettingsValidationErrors {
  const errors: InvoicePaymentSettingsValidationErrors = {};

  try {
    percentInputToBasisPoints(form.defaultLatePaymentInterestPercent);
  } catch {
    errors.defaultLatePaymentInterestPercent =
      messages.latePaymentInterestInvalid;
  }

  const reminderPeriodDays = parseIntegerInput(form.defaultReminderPeriodDays);
  if (
    reminderPeriodDays === null ||
    reminderPeriodDays < 0 ||
    reminderPeriodDays > 365
  ) {
    errors.defaultReminderPeriodDays = messages.reminderPeriodDaysInvalid;
  }

  return errors;
}

export function hasInvoicePaymentSettingsValidationErrors(
  errors: InvoicePaymentSettingsValidationErrors,
): boolean {
  return Object.values(errors).some((error) => error !== undefined);
}

export function toUpdateInvoicePaymentSettingsRequest(
  form: InvoicePaymentSettingsForm,
): UpdateInvoicePaymentSettingsRequest {
  const defaultLatePaymentInterestBasisPoints = percentInputToBasisPoints(
    form.defaultLatePaymentInterestPercent,
  );
  const defaultReminderPeriodDays = parseIntegerInput(
    form.defaultReminderPeriodDays,
  );

  if (defaultReminderPeriodDays === null) {
    throw new Error('Invalid invoice payment settings form.');
  }

  return {
    defaultLatePaymentInterestBasisPoints,
    defaultReminderPeriodDays,
  };
}

export function percentInputToBasisPoints(value: string): number {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error('Invalid invoice payment settings form.');
  }

  const normalizedValue = trimmedValue.replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalizedValue);

  if (match === null) {
    throw new Error('Invalid invoice payment settings form.');
  }

  const wholePercent = Number.parseInt(match[1] ?? '0', 10);
  const decimalPart = Number.parseInt(
    (match[2] ?? '').padEnd(2, '0') || '0',
    10,
  );
  const basisPoints = wholePercent * 100 + decimalPart;

  if (!Number.isSafeInteger(basisPoints) || basisPoints > 100000) {
    throw new Error('Invalid invoice payment settings form.');
  }

  return basisPoints;
}

export function basisPointsToPercentInput(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new Error('Invalid invoice payment settings form.');
  }

  return (basisPoints / 100).toFixed(2).replace('.', ',');
}

function parseIntegerInput(value: string): number | null {
  const trimmedValue = value.trim();

  if (!/^\d+$/.test(trimmedValue)) {
    return null;
  }

  const parsedValue = Number(trimmedValue);

  return Number.isSafeInteger(parsedValue) ? parsedValue : null;
}
