export class ApproveInvoiceDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApproveInvoiceDraftError';
  }
}
