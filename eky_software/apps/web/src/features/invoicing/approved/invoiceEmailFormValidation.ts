import { uiText } from '../../../i18n/fi.js';

const maximumEmailLength = 320;
const maximumSubjectLength = 200;
const maximumBodyLength = 10_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const forbiddenEmailCharacterPattern = /[\u0000-\u0020\u007f<>(),:;"\\[\]]/;
const forbiddenHeaderCharacterPattern = /[\u0000-\u001f\u007f]/;

export interface InvoiceEmailFormValues {
  body: string;
  cc: string;
  subject: string;
  to: string;
}

export interface InvoiceEmailFormErrors {
  body?: string;
  cc?: string;
  subject?: string;
  to?: string;
}

export interface InvoiceEmailFormValidationResult {
  errors: InvoiceEmailFormErrors;
  isValid: boolean;
}

export function validateInvoiceEmailForm(
  values: InvoiceEmailFormValues,
): InvoiceEmailFormValidationResult {
  const errors: InvoiceEmailFormErrors = {};

  validateRequiredEmail(values.to, 'to', errors);
  validateOptionalEmail(values.cc, errors);
  validateSubject(values.subject, errors);
  validateBody(values.body, errors);

  return {
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

function validateRequiredEmail(
  value: string,
  field: 'to',
  errors: InvoiceEmailFormErrors,
): void {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    errors[field] = uiText.invoicing.invoiceEmailRecipientRequired;
    return;
  }

  if (normalizedValue.length > maximumEmailLength) {
    errors[field] = uiText.invoicing.invoiceEmailRecipientTooLong;
    return;
  }

  if (!isValidEmail(normalizedValue)) {
    errors[field] = uiText.invoicing.invoiceEmailRecipientInvalid;
  }
}

function validateOptionalEmail(
  value: string,
  errors: InvoiceEmailFormErrors,
): void {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return;
  }

  if (normalizedValue.length > maximumEmailLength) {
    errors.cc = uiText.invoicing.invoiceEmailCcTooLong;
    return;
  }

  if (!isValidEmail(normalizedValue)) {
    errors.cc = uiText.invoicing.invoiceEmailCcInvalid;
  }
}

function validateSubject(
  value: string,
  errors: InvoiceEmailFormErrors,
): void {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    errors.subject = uiText.invoicing.invoiceEmailSubjectRequired;
    return;
  }

  if (
    normalizedValue.length > maximumSubjectLength ||
    forbiddenHeaderCharacterPattern.test(normalizedValue)
  ) {
    errors.subject = uiText.invoicing.invoiceEmailSubjectInvalid;
  }
}

function validateBody(value: string, errors: InvoiceEmailFormErrors): void {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    errors.body = uiText.invoicing.invoiceEmailBodyRequired;
    return;
  }

  if (normalizedValue.length > maximumBodyLength) {
    errors.body = uiText.invoicing.invoiceEmailBodyTooLong;
  }
}

function isValidEmail(value: string): boolean {
  return (
    !forbiddenEmailCharacterPattern.test(value) && emailPattern.test(value)
  );
}
