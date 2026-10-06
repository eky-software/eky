export class InvoiceLegacyDeliveryReviewRequiredError extends Error {
  readonly code = 'INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED';

  constructor() {
    super('Legacy invoice delivery history requires review before editing or sending.');
    this.name = 'InvoiceLegacyDeliveryReviewRequiredError';
  }
}
