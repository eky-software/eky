export class ApprovedInvoiceEmailDeliveryError extends Error {
  constructor(message = 'Invoice email delivery failed.') {
    super(message);
    this.name = 'ApprovedInvoiceEmailDeliveryError';
  }
}
