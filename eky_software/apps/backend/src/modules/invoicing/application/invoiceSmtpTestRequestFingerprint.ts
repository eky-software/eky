import { createHash } from 'node:crypto';

export interface InvoiceSmtpTestRequestFingerprintInput {
  body: string;
  cc: string;
  subject: string;
  testRecipient: string;
  to: string;
}

export function createInvoiceSmtpTestRequestFingerprint(
  input: InvoiceSmtpTestRequestFingerprintInput,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.to,
        input.cc,
        input.subject,
        input.body,
        input.testRecipient,
      ]),
      'utf8',
    )
    .digest('hex');
}
