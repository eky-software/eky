import type { CancelApprovedInvoiceInput } from '../application/cancelApprovedInvoice.js';

const allowedFields = new Set([
  'cancellationReason',
  'confirmationInvoiceNumber',
]);

export class InvoiceCancellationRequestValidationError extends Error {
  constructor() {
    super('Invoice cancellation request is invalid.');
    this.name = 'InvoiceCancellationRequestValidationError';
  }
}

export function parseInvoiceCancellationRequest(
  value: unknown,
  context: Pick<
    CancelApprovedInvoiceInput,
    'actorContext' | 'cancelledAt' | 'invoiceId'
  >,
): CancelApprovedInvoiceInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((fieldName) => !allowedFields.has(fieldName)) ||
    typeof value.cancellationReason !== 'string' ||
    typeof value.confirmationInvoiceNumber !== 'string'
  ) {
    throw new InvoiceCancellationRequestValidationError();
  }

  return {
    ...context,
    cancellationReason: value.cancellationReason,
    confirmationInvoiceNumber: value.confirmationInvoiceNumber,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
