export class InvoiceDocumentPublicationConflictError extends Error {
  constructor(readonly candidateCleanupFailed = false) {
    super('Invoice changed before the PDF operation completed.');
    this.name = 'InvoiceDocumentPublicationConflictError';
  }
}
