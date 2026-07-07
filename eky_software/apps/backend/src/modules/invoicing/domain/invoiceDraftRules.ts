import type { InvoiceUnit } from './invoiceDraft.js';
import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';
import {
  maxLatePaymentInterestBasisPoints,
  maxReminderPeriodDays,
} from './invoicePaymentSettings.js';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const millisecondsPerDay = 86_400_000;
const maximumIdentifierLength = 200;
export const maximumInvoiceUnitLength = 8;
const invoiceUnitPattern = /^[\p{L}\p{N}.-]+$/u;

function parseDateOnly(value: string, fieldName: string): Date {
  if (!dateOnlyPattern.test(value)) {
    throw new InvoiceDraftValidationError(
      `${fieldName} must use YYYY-MM-DD format.`,
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new InvoiceDraftValidationError(`${fieldName} must be a valid date.`);
  }

  return date;
}

export function requireIdentifier(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new InvoiceDraftValidationError(`${fieldName} is required.`);
  }

  if (normalizedValue.length > maximumIdentifierLength) {
    throw new InvoiceDraftValidationError(`${fieldName} is invalid.`);
  }

  return normalizedValue;
}

export function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  const normalizedValue = value?.trim() ?? '';

  if (normalizedValue === '') {
    return null;
  }

  if (normalizedValue.length > maximumIdentifierLength) {
    throw new InvoiceDraftValidationError(`${fieldName} is invalid.`);
  }

  return normalizedValue;
}

export function normalizeRequiredInvoiceText(
  value: string,
  fieldName: string,
): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new InvoiceDraftValidationError(`${fieldName} is required.`);
  }

  return normalizedValue;
}

export function normalizeOptionalInvoiceText(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function normalizeOptionalInvoiceTextWithLimit(
  value: string | undefined,
  fieldName: string,
  maximumLength: number,
): string {
  const normalizedValue = normalizeOptionalInvoiceText(value);

  if (normalizedValue.length > maximumLength) {
    throw new InvoiceDraftValidationError(
      `${fieldName} must be ${maximumLength} characters or less.`,
    );
  }

  return normalizedValue;
}

export function parseInvoiceUnit(value: string): InvoiceUnit {
  const normalizedValue = value.trim();

  if (!isValidInvoiceUnit(normalizedValue)) {
    throw new InvoiceDraftValidationError('Invoice unit is not supported.');
  }

  return normalizedValue as InvoiceUnit;
}

export function isValidInvoiceUnit(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumInvoiceUnitLength &&
    invoiceUnitPattern.test(value)
  );
}

export function resolvePaymentTermDays(value: number | undefined): number {
  const paymentTermDays = value ?? 14;

  if (!Number.isSafeInteger(paymentTermDays) || paymentTermDays < 0) {
    throw new InvoiceDraftValidationError(
      'Payment term days must be a non-negative safe integer.',
    );
  }

  return paymentTermDays;
}

export function resolveLatePaymentInterestBasisPoints(
  value: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maxLatePaymentInterestBasisPoints
  ) {
    throw new InvoiceDraftValidationError(
      'Late payment interest must be a non-negative safe integer within the supported range.',
    );
  }

  return value;
}

export function resolveReminderPeriodDays(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maxReminderPeriodDays
  ) {
    throw new InvoiceDraftValidationError(
      'Reminder period days must be a non-negative safe integer within the supported range.',
    );
  }

  return value;
}

export function resolveInvoiceDates(
  invoiceDateValue: string,
  dueDateValue: string | undefined,
  paymentTermDays: number,
): { invoiceDate: string; dueDate: string } {
  const invoiceDate = parseDateOnly(invoiceDateValue, 'Invoice date');
  const dueDate =
    dueDateValue === undefined
      ? new Date(invoiceDate.getTime() + paymentTermDays * millisecondsPerDay)
      : parseDateOnly(dueDateValue, 'Due date');

  if (Number.isNaN(dueDate.getTime())) {
    throw new InvoiceDraftValidationError(
      'Due date is outside the supported range.',
    );
  }

  if (dueDate.getTime() < invoiceDate.getTime()) {
    throw new InvoiceDraftValidationError('Due date cannot be before invoice date.');
  }

  return {
    invoiceDate: invoiceDate.toISOString().slice(0, 10),
    dueDate: dueDate.toISOString().slice(0, 10),
  };
}
