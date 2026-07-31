import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function requireInvoicePaymentDate(value: unknown): string {
  if (typeof value !== 'string' || !isoDatePattern.test(value)) {
    throw new InvoiceDraftValidationError(
      'Invoice payment date must use YYYY-MM-DD.',
    );
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new InvoiceDraftValidationError(
      'Invoice payment date must be a valid calendar date.',
    );
  }

  return value;
}
