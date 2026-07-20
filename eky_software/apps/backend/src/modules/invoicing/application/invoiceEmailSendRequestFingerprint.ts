import { createHash } from 'node:crypto';

export interface InvoiceEmailSendRequestFingerprintInput {
  body: string;
  cc: string;
  recipient: string;
  subject: string;
  to: string;
}

export function createInvoiceEmailSendRequestFingerprint(
  input: InvoiceEmailSendRequestFingerprintInput,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.recipient,
        input.to,
        input.cc,
        input.subject,
        input.body,
      ]),
      'utf8',
    )
    .digest('hex');
}
