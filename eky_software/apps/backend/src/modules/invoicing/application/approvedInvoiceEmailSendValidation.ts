import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';

const maximumEmailLength = 320;
const maximumSubjectLength = 200;
const maximumBodyLength = 10_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NormalizedApprovedInvoiceEmailSendFields {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

export function normalizeApprovedInvoiceEmailSendFields(input: {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}): NormalizedApprovedInvoiceEmailSendFields {
  return {
    body: normalizeRequiredText(input.body, 'Email body', maximumBodyLength),
    cc: normalizeOptionalEmail(input.cc, 'Cc email'),
    subject: normalizeRequiredText(
      input.subject,
      'Email subject',
      maximumSubjectLength,
    ),
    to: normalizeRequiredEmail(input.to, 'Recipient email'),
  };
}

function normalizeRequiredEmail(value: string, fieldName: string): string {
  const normalizedValue = normalizeRequiredText(
    value,
    fieldName,
    maximumEmailLength,
  );

  if (!emailPattern.test(normalizedValue)) {
    throw new InvoiceDraftValidationError(`${fieldName} is invalid.`);
  }

  return normalizedValue;
}

function normalizeOptionalEmail(
  value: string | undefined,
  fieldName: string,
): string {
  const normalizedValue = value?.trim() ?? '';

  if (normalizedValue.length === 0) {
    return '';
  }

  if (normalizedValue.length > maximumEmailLength) {
    throw new InvoiceDraftValidationError(
      `${fieldName} must be ${maximumEmailLength} characters or less.`,
    );
  }

  if (!emailPattern.test(normalizedValue)) {
    throw new InvoiceDraftValidationError(`${fieldName} is invalid.`);
  }

  return normalizedValue;
}

function normalizeRequiredText(
  value: string,
  fieldName: string,
  maximumLength: number,
): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new InvoiceDraftValidationError(`${fieldName} is required.`);
  }

  if (normalizedValue.length > maximumLength) {
    throw new InvoiceDraftValidationError(
      `${fieldName} must be ${maximumLength} characters or less.`,
    );
  }

  return normalizedValue;
}
