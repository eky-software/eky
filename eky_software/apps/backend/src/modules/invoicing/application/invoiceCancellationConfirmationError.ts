export class InvoiceCancellationConfirmationError extends Error {
  constructor() {
    super('Invoice number confirmation did not match.');
    this.name = 'InvoiceCancellationConfirmationError';
  }
}
