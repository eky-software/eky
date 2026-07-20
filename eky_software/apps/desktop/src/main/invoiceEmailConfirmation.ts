import { isValidResourceId } from './protocolPolicy.js';

export interface InvoiceEmailPreparationConfirmation {
  attachmentFileName: string;
  attachmentSizeBytes: number;
  body: string;
  cc: string;
  invoiceId: string;
  invoiceNumber: string;
  recipient: string;
  resend: boolean;
  sender: string;
  subject: string;
}

export function createInvoiceEmailConfirmationDetail(
  preparation: InvoiceEmailPreparationConfirmation,
): string {
  return [
    `Lasku: ${preparation.invoiceNumber}`,
    `Lähettäjä: ${preparation.sender}`,
    `Vastaanottaja: ${preparation.recipient}`,
    ...(preparation.cc === '' ? [] : [`Kopio: ${preparation.cc}`]),
    `Otsikko: ${preparation.subject}`,
    `Liite: ${preparation.attachmentFileName} (${formatFileSize(preparation.attachmentSizeBytes)})`,
    ...(preparation.resend ? ['Tämä on laskun uudelleenlähetys.'] : []),
    '',
    'Viestin sisältö:',
    preparation.body,
  ].join('\n');
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
  const body = readSafeMultilineText(preparation.body, 10_000);
  const cc = readOptionalSafeText(preparation.cc, 320);
  const invoiceId = readSafeText(preparation.invoiceId, 100);
  const invoiceNumber = readSafeText(preparation.invoiceNumber, 100);
  const recipient = readSafeText(preparation.recipient, 320);
  const sender = readSafeText(preparation.sender, 600);
  const subject = readSafeText(preparation.subject, 200);
  const attachmentSizeBytes = preparation.attachment.sizeBytes;

  if (
    attachmentFileName === undefined ||
    body === undefined ||
    cc === undefined ||
    invoiceId === undefined ||
    !isValidResourceId(invoiceId) ||
    invoiceNumber === undefined ||
    recipient === undefined ||
    sender === undefined ||
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
    body,
    cc,
    invoiceId,
    invoiceNumber,
    recipient,
    resend: preparation.resend,
    sender,
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

function readSafeMultilineText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maximumLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalizedValue)
  ) {
    return undefined;
  }

  return normalizedValue;
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} tavua`;
  }

  return `${(sizeBytes / 1024).toFixed(1).replace('.', ',')} kt`;
}
