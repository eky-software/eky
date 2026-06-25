export class ReserveInvoiceNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReserveInvoiceNumberError';
  }
}
