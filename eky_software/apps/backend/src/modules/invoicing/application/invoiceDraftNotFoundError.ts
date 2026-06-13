export class InvoiceDraftNotFoundError extends Error {
  constructor() {
    super('Invoice draft not found.');
    this.name = 'InvoiceDraftNotFoundError';
  }
}
