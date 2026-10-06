export class InvoiceDocumentReadConflictError extends Error {
  constructor() {
    super('Invoice PDF changed before the read completed.');
    this.name = 'InvoiceDocumentReadConflictError';
  }
}
