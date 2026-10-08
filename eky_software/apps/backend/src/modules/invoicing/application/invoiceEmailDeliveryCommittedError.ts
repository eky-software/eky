export class InvoiceEmailDeliveryCommittedError extends Error {
  constructor() {
    super('Invoice email delivery succeeded, but the current invoice could not be read.');
    this.name = 'InvoiceEmailDeliveryCommittedError';
  }
}
