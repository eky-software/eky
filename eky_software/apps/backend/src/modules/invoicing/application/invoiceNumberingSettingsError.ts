export class InvoiceNumberingSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceNumberingSettingsError';
  }
}
