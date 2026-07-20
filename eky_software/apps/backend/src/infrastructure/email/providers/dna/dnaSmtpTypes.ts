export interface DnaSmtpTestEmailInput {
  attemptId: string;
  body: string;
  companyId: string;
  emailDeliveryProvider: 'dnaSmtp';
  emailSenderAddress: string;
  emailSenderName: string;
  emailTestRecipientOverride: string;
  emailUsername: string;
  pdfContent: Uint8Array;
  pdfFileName: string;
  subject: string;
}

export interface DnaSmtpTestEmailResult {
  deliveredTo: string;
  provider: 'smtp';
  providerMessageId: string | null;
  testMode: true;
}

export interface DnaSmtpEmailInput {
  attemptId: string;
  body: string;
  cc: string;
  companyId: string;
  emailDeliveryProvider: 'dnaSmtp';
  emailSenderAddress: string;
  emailSenderName: string;
  emailUsername: string;
  pdfContent: Uint8Array;
  pdfFileName: string;
  subject: string;
  to: string;
}

export interface DnaSmtpEmailResult {
  deliveredCc: string;
  deliveredTo: string;
  provider: 'smtp';
  providerMessageId: string | null;
  testMode: false;
}
