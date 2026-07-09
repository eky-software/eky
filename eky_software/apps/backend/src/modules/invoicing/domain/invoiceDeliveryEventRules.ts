import {
  invoiceDeliveryMethods,
  invoiceDeliveryProviders,
  invoiceDeliveryStatuses,
  type InvoiceDeliveryMethod,
  type InvoiceDeliveryProvider,
  type InvoiceDeliveryStatus,
} from './invoiceDeliveryEvent.js';
import { requireIdentifier } from './invoiceDraftRules.js';

const maximumEmailLength = 320;
const maximumSubjectLength = 200;
const maximumBodyPreviewLength = 500;
const maximumSafeErrorMessageLength = 500;
const maximumTechnicalErrorCodeLength = 120;
const maximumCreatedByLength = 120;

export class InvoiceDeliveryEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceDeliveryEventValidationError';
  }
}

export function requireInvoiceDeliveryMethod(
  value: string,
): InvoiceDeliveryMethod {
  if (invoiceDeliveryMethods.includes(value as InvoiceDeliveryMethod)) {
    return value as InvoiceDeliveryMethod;
  }

  throw new InvoiceDeliveryEventValidationError('Delivery method is invalid.');
}

export function requireInvoiceDeliveryProvider(
  value: string,
): InvoiceDeliveryProvider {
  if (invoiceDeliveryProviders.includes(value as InvoiceDeliveryProvider)) {
    return value as InvoiceDeliveryProvider;
  }

  throw new InvoiceDeliveryEventValidationError('Delivery provider is invalid.');
}

export function requireInvoiceDeliveryStatus(
  value: string,
): InvoiceDeliveryStatus {
  if (invoiceDeliveryStatuses.includes(value as InvoiceDeliveryStatus)) {
    return value as InvoiceDeliveryStatus;
  }

  throw new InvoiceDeliveryEventValidationError('Delivery status is invalid.');
}

export function normalizeDeliveryOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return null;
  }

  return requireIdentifier(normalizedValue, fieldName);
}

export function normalizeDeliveryEmail(value: string | undefined): string {
  return normalizeLimitedString(value, maximumEmailLength, 'Email');
}

export function normalizeDeliverySubject(value: string | undefined): string {
  return normalizeLimitedString(value, maximumSubjectLength, 'Subject');
}

export function normalizeDeliveryBodyPreview(value: string | undefined): string {
  const normalizedValue = value?.trim() ?? '';

  return normalizedValue.slice(0, maximumBodyPreviewLength);
}

export function normalizeDeliverySafeErrorMessage(
  value: string | null | undefined,
): string | null {
  return normalizeLimitedNullableString(
    value,
    maximumSafeErrorMessageLength,
    'Safe error message',
  );
}

export function normalizeDeliveryTechnicalErrorCode(
  value: string | null | undefined,
): string | null {
  return normalizeLimitedNullableString(
    value,
    maximumTechnicalErrorCodeLength,
    'Technical error code',
  );
}

export function normalizeDeliveryCreatedBy(value: string | undefined): string {
  return normalizeLimitedString(value, maximumCreatedByLength, 'Created by');
}

function normalizeLimitedNullableString(
  value: string | null | undefined,
  maximumLength: number,
  fieldName: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return null;
  }

  if (normalizedValue.length > maximumLength) {
    throw new InvoiceDeliveryEventValidationError(
      `${fieldName} must be ${maximumLength} characters or less.`,
    );
  }

  return normalizedValue;
}

function normalizeLimitedString(
  value: string | undefined,
  maximumLength: number,
  fieldName: string,
): string {
  const normalizedValue = value?.trim() ?? '';

  if (normalizedValue.length > maximumLength) {
    throw new InvoiceDeliveryEventValidationError(
      `${fieldName} must be ${maximumLength} characters or less.`,
    );
  }

  return normalizedValue;
}
