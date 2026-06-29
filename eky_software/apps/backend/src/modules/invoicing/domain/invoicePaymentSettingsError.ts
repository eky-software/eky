export class InvoicePaymentSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoicePaymentSettingsError';
  }
}
