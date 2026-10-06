export class InvoiceDraftDeliveryHistoryIntegrityError extends Error {
  constructor() {
    super('Stored invoice delivery history is inconsistent.');
    this.name = 'InvoiceDraftDeliveryHistoryIntegrityError';
  }
}
