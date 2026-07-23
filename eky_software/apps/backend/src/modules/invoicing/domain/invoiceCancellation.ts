import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';

export const maximumInvoiceCancellationReasonLength = 500;

const forbiddenControlCharacterPattern =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function normalizeInvoiceCancellationReason(value: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new InvoiceDraftValidationError('Cancellation reason is required.');
  }

  if (normalizedValue.length > maximumInvoiceCancellationReasonLength) {
    throw new InvoiceDraftValidationError(
      `Cancellation reason must be ${maximumInvoiceCancellationReasonLength} characters or less.`,
    );
  }

  if (forbiddenControlCharacterPattern.test(normalizedValue)) {
    throw new InvoiceDraftValidationError('Cancellation reason is invalid.');
  }

  return normalizedValue;
}
