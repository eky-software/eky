export interface InvoiceEmailSettings {
  emailDeliveryProvider: 'dryRun' | 'smtp';
  emailSenderAddress: string;
  emailSenderName: string;
  emailSmtpHost: string;
  emailSmtpPort: number | null;
  emailSmtpSecurity: 'tls' | 'starttls';
  emailTestRecipientOverride: string;
  emailUsername: string;
}

export interface InvoiceEmailSettingsReader {
  getEmailSettings(companyId: string): Promise<InvoiceEmailSettings | null>;
}
