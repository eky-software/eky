export class ApprovedInvoiceDocumentNotFoundError extends Error {
  constructor() {
    super('Approved invoice document was not found.');
    this.name = 'ApprovedInvoiceDocumentNotFoundError';
  }
}
