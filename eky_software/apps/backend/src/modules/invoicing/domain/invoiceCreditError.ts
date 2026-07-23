export class InvoiceCreditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceCreditError';
  }
}
