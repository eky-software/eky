import {
  hasOnlyAllowedFields,
  isRecord,
} from '../../../http/requestBody.js';
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
    !hasOnlyAllowedFields(value, allowedFields) ||
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
