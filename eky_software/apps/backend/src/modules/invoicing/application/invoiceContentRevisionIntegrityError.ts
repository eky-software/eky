export class InvoiceContentRevisionIntegrityError extends Error {
  constructor() {
    super('Stored invoice content revision is inconsistent.');
    this.name = 'InvoiceContentRevisionIntegrityError';
  }
}
