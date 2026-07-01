export class ApprovedInvoiceNotFoundError extends Error {
  constructor() {
    super('Approved invoice was not found.');
    this.name = 'ApprovedInvoiceNotFoundError';
  }
}
