export class InvoiceNumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceNumberingError';
  }
}
