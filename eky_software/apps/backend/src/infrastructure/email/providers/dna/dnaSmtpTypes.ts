import type { DnaSmtpStoredProfile } from './dnaSmtpConfiguration.js';

export interface DnaSmtpTestEmailInput extends DnaSmtpStoredProfile {
  body: string;
  cc: string;
  companyId: string;
  emailSenderAddress: string;
  emailSenderName: string;
  emailTestRecipientOverride: string;
  emailUsername: string;
  pdfContent: Uint8Array;
  pdfFileName: string;
  requestedTo: string;
  subject: string;
}

export interface DnaSmtpTestEmailResult {
  deliveredTo: string;
  provider: 'smtp';
  providerMessageId: string | null;
  testMode: true;
}
