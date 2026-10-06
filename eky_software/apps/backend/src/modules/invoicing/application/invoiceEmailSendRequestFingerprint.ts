import { createHash } from 'node:crypto';
import type { InvoiceDocumentBinding } from '../domain/invoiceDocumentBinding.js';

export interface InvoiceEmailSendRequestFingerprintInput {
  body: string;
  cc: string;
  document: {
    binding: InvoiceDocumentBinding;
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
        'invoice-email-send-v3',
        input.recipient,
        input.to,
        input.cc,
        input.subject,
        input.body,
        input.sender.address,
        input.sender.name,
        input.document.binding.kind,
        input.document.binding.kind === 'revision'
          ? input.document.binding.revisionId : input.document.binding.sourceDocumentId,
        input.document.id,
        input.document.sha256,
        input.document.fileName,
        input.document.sizeBytes,
      ]),
      'utf8',
    )
    .digest('hex');
}
