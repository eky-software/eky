export class InvoiceCreditConflictError extends Error {
  constructor() {
    super('Credit invoice cannot be created or updated in its current state.');
    this.name = 'InvoiceCreditConflictError';
  }
}
