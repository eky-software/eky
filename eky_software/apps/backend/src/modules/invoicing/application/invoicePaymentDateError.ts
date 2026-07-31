export class InvoicePaymentDateError extends Error {
  readonly code = 'invoice_payment_date_invalid';

  constructor() {
    super('Invoice payment date is not allowed.');
    this.name = 'InvoicePaymentDateError';
  }
}
