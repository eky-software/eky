export class InvoicePaymentConflictError extends Error {
  readonly code = 'invoice_payment_conflict';

  constructor() {
    super('Invoice payment state does not allow the operation.');
    this.name = 'InvoicePaymentConflictError';
  }
}
