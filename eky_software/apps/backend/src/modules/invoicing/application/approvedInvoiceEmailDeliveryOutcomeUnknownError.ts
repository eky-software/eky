export class ApprovedInvoiceEmailDeliveryOutcomeUnknownError extends Error {
  constructor() {
    super('Invoice email delivery outcome is unknown.');
    this.name = 'ApprovedInvoiceEmailDeliveryOutcomeUnknownError';
  }
}
