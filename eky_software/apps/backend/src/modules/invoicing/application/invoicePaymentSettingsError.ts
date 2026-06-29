export class InvoicePaymentSettingsApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoicePaymentSettingsApplicationError';
  }
}
