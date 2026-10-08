export class InvoiceDocumentIntegrityError extends Error {
  constructor() {
    super('Stored invoice document is inconsistent.');
    this.name = 'InvoiceDocumentIntegrityError';
  }
}
