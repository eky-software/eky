export class InvoiceCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceCalculationError';
  }
}
