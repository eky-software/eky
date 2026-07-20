import type { InvoiceEmailSettings } from './invoiceEmailSettingsReader.js';

export interface InvoiceSmtpEmailInput extends InvoiceEmailSettings {
  attemptId: string;
  body: string;
  cc: string;
  companyId: string;
  pdfContent: Uint8Array;
  pdfFileName: string;
  subject: string;
  to: string;
}

export interface InvoiceSmtpEmailResult {
  deliveredCc: string;
  deliveredTo: string;
  provider: 'smtp';
  providerMessageId: string | null;
  testMode: false;
}

export class InvoiceSmtpDeliveryError extends Error {
  constructor(
    public readonly outcome: 'failed' | 'outcomeUnknown',
    public readonly technicalErrorCode: string | null,
  ) {
    super('Invoice SMTP delivery failed.');
    this.name = 'InvoiceSmtpDeliveryError';
  }
}

export interface InvoiceSmtpDeliveryProvider {
  sendEmail(input: InvoiceSmtpEmailInput): Promise<InvoiceSmtpEmailResult>;
}
