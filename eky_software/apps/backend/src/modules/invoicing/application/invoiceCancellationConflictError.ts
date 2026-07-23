export class InvoiceCancellationConflictError extends Error {
  constructor() {
    super('Approved invoice cannot be cancelled.');
    this.name = 'InvoiceCancellationConflictError';
  }
}
