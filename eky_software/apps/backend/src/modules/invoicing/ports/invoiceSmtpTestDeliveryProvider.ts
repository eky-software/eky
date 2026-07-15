import type { InvoiceEmailSettings } from './invoiceEmailSettingsReader.js';

export interface InvoiceSmtpTestEmailInput extends InvoiceEmailSettings {
  body: string;
  cc: string;
  companyId: string;
  pdfContent: Uint8Array;
  pdfFileName: string;
  requestedTo: string;
  subject: string;
}

export interface InvoiceSmtpTestEmailResult {
  deliveredTo: string;
  provider: 'smtp';
  providerMessageId: string | null;
  testMode: true;
}

export class InvoiceSmtpTestDeliveryError extends Error {
  constructor(
    public readonly outcome: 'failed' | 'outcomeUnknown',
    public readonly technicalErrorCode: string | null,
  ) {
    super('Invoice SMTP test delivery failed.');
    this.name = 'InvoiceSmtpTestDeliveryError';
  }
}

export interface InvoiceSmtpTestDeliveryProvider {
  sendTestEmail(
    input: InvoiceSmtpTestEmailInput,
  ): Promise<InvoiceSmtpTestEmailResult>;
}
