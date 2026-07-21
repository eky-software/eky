export class InvoiceDeliveryConflictError extends Error {
  constructor() {
    super('Invoice has an unresolved delivery attempt.');
    this.name = 'InvoiceDeliveryConflictError';
  }
}
