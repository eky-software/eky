export class InvoicePaymentRequestValidationError extends Error {
  constructor() {
    super('Invalid invoice payment body.');
    this.name = 'InvoicePaymentRequestValidationError';
  }
}

export function parseMarkInvoicePaidRequest(
  value: unknown,
): { paidOn: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('paidOn' in value) ||
    typeof value.paidOn !== 'string'
  ) {
    throw new InvoicePaymentRequestValidationError();
  }

  return { paidOn: value.paidOn };
}
