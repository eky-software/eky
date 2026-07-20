import { createHash } from 'node:crypto';

export interface InvoiceEmailSendRequestFingerprintInput {
  body: string;
  cc: string;
  document: {
    fileName: string;
    id: string;
    sha256: string;
    sizeBytes: number;
  };
  recipient: string;
  sender: {
    address: string;
    name: string;
  };
  subject: string;
  to: string;
}

export function createInvoiceEmailSendRequestFingerprint(
  input: InvoiceEmailSendRequestFingerprintInput,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'invoice-email-send-v2',
        input.recipient,
        input.to,
        input.cc,
        input.subject,
        input.body,
        input.sender.address,
        input.sender.name,
        input.document.id,
        input.document.sha256,
        input.document.fileName,
        input.document.sizeBytes,
      ]),
      'utf8',
    )
    .digest('hex');
}
