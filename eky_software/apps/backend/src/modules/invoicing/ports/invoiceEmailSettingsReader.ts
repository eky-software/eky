export interface InvoiceEmailSettings {
  emailDeliveryProvider: 'dryRun' | 'dnaSmtp';
  emailSenderAddress: string;
  emailSenderName: string;
  emailTestRecipientOverride: string;
  emailUsername: string;
}

export interface InvoiceEmailSettingsReader {
  getEmailSettings(companyId: string): Promise<InvoiceEmailSettings | null>;
}
