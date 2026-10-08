import { isValidResourceId } from './protocolPolicy.js';

interface InvoiceEmailDocumentTarget {
  kind: 'revision' | 'preservedLegacy';
  documentId: string;
}

export interface InvoiceEmailPreparationConfirmation {
  attachmentFileName: string;
  attachmentSizeBytes: number;
  body: string;
  cc: string;
  documentTarget: InvoiceEmailDocumentTarget;
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
    ...(preparation.documentTarget.kind === 'preservedLegacy'
      ? [
          'Liite on säilytetty vanha PDF. Sitä ei ole muodostettu uudelleen.',
          'Vanhan lähetyksen sisältöä ei voida jälkikäteen varmasti todistaa. Tarkista säilytetty liite ennen lähettämistä.',
        ]
      : []),
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
  const documentTarget = readDocumentTarget(preparation.documentTarget);

  if (
    attachmentFileName === undefined ||
    body === undefined ||
    cc === undefined ||
    documentTarget === undefined ||
    preparation.attachment.documentId !== documentTarget.documentId ||
    invoiceId === undefined ||
    invoiceId !== preparation.invoiceId ||
    !isValidResourceId(invoiceId) ||
    invoiceNumber === undefined ||
    recipient === undefined ||
    sender === undefined ||
    subject === undefined ||
    typeof preparation.resend !== 'boolean' ||
    (documentTarget.kind === 'preservedLegacy' && !preparation.resend) ||
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
    documentTarget,
    invoiceId,
    invoiceNumber,
    recipient,
    resend: preparation.resend,
    sender,
    subject,
  };
}

export function matchesInvoiceEmailPreparationRequest(
  confirmation: InvoiceEmailPreparationConfirmation,
  requestBody: unknown,
  invoiceId: string | undefined,
): boolean {
  if (!isRecord(requestBody) || confirmation.invoiceId !== invoiceId) {
    return false;
  }
  const target = readDocumentTarget(requestBody.documentTarget);
  return (
    target !== undefined &&
    target.kind === confirmation.documentTarget.kind &&
    target.documentId === confirmation.documentTarget.documentId
  );
}

function readDocumentTarget(
  value: unknown,
): InvoiceEmailDocumentTarget | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    (value.kind !== 'revision' && value.kind !== 'preservedLegacy') ||
    !isValidResourceId(value.documentId)
  ) {
    return undefined;
  }
  return { kind: value.kind, documentId: value.documentId };
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
