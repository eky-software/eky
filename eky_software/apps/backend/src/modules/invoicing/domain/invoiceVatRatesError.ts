export class InvoiceVatRatesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceVatRatesError';
  }
}
