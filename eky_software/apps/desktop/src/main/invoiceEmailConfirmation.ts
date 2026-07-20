import { isValidResourceId } from './protocolPolicy.js';

export interface InvoiceEmailPreparationConfirmation {
  attachmentFileName: string;
  attachmentSizeBytes: number;
  cc: string;
  invoiceId: string;
  invoiceNumber: string;
  recipient: string;
  resend: boolean;
  subject: string;
}

export function readInvoiceEmailPreparationConfirmation(
  value: unknown,
): InvoiceEmailPreparationConfirmation | undefined {
  if (!isRecord(value) || !isRecord(value.preparation)) {
    return undefined;
  }

  const preparation = value.preparation;

  if (!isRecord(preparation.attachment)) {
    return undefined;
  }

  const attachmentFileName = readSafeText(preparation.attachment.fileName, 200);
  const cc = readOptionalSafeText(preparation.cc, 320);
  const invoiceId = readSafeText(preparation.invoiceId, 100);
  const invoiceNumber = readSafeText(preparation.invoiceNumber, 100);
  const recipient = readSafeText(preparation.recipient, 320);
  const subject = readSafeText(preparation.subject, 200);
  const attachmentSizeBytes = preparation.attachment.sizeBytes;

  if (
    attachmentFileName === undefined ||
    cc === undefined ||
    invoiceId === undefined ||
    !isValidResourceId(invoiceId) ||
    invoiceNumber === undefined ||
    recipient === undefined ||
    subject === undefined ||
    typeof preparation.resend !== 'boolean' ||
    typeof attachmentSizeBytes !== 'number' ||
    !Number.isSafeInteger(attachmentSizeBytes) ||
    attachmentSizeBytes < 0
  ) {
    return undefined;
  }

  return {
    attachmentFileName,
    attachmentSizeBytes,
    cc,
    invoiceId,
    invoiceNumber,
    recipient,
    resend: preparation.resend,
    subject,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSafeText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalizedValue)
  ) {
    return undefined;
  }

  return normalizedValue;
}

function readOptionalSafeText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (value === '') {
    return '';
  }

  return readSafeText(value, maximumLength);
}
