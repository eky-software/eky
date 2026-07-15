import { randomUUID } from 'node:crypto';

import { normalizeEmailAddress } from '../address/emailAddress.js';
import { emailTransportLimits } from '../emailTransportLimits.js';
import { encodeMimeBase64 } from './mimeBase64.js';
import { formatMimeAddress } from './mimeAddress.js';
import { createMimeBoundary } from './mimeBoundary.js';
import { encodeMimeHeaderValue } from './mimeEncodedWord.js';
import type {
  InvoiceMimeMessageInput,
  InvoiceMimeMessageOptions,
} from './mimeTypes.js';

const safePdfFileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.pdf$/i;

export class InvoiceMimeMessageValidationError extends Error {
  constructor() {
    super('Invoice email content is invalid.');
    this.name = 'InvoiceMimeMessageValidationError';
  }
}

export function buildInvoiceMimeMessage(
  input: InvoiceMimeMessageInput,
  options: InvoiceMimeMessageOptions = {},
): Buffer {
  validateInput(input);

  const fromAddress = normalizeEmailAddress(input.fromAddress);
  const to = normalizeEmailAddress(input.to);
  const cc = input.cc?.trim() === '' || input.cc === undefined
    ? undefined
    : normalizeEmailAddress(input.cc);
  const bodyBase64 = encodeMimeBase64(Buffer.from(input.body, 'utf8'));
  const pdfBase64 = encodeMimeBase64(input.pdfContent);
  const boundary = createMimeBoundary([bodyBase64, pdfBase64]);
  const senderDomain = fromAddress.slice(fromAddress.lastIndexOf('@') + 1);
  const messageId = options.messageId ?? `${randomUUID()}@${senderDomain}`;

  if (!/^[A-Za-z0-9._@-]{1,300}$/.test(messageId)) {
    throw new InvoiceMimeMessageValidationError();
  }

  const headers = [
    'MIME-Version: 1.0',
    `Date: ${(options.now ?? new Date()).toUTCString()}`,
    `Message-ID: <${messageId}>`,
    `From: ${formatMimeAddress(fromAddress, input.fromName)}`,
    `To: ${to}`,
    ...(cc === undefined ? [] : [`Cc: ${cc}`]),
    `Subject: ${encodeMimeHeaderValue(input.subject)}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    bodyBase64,
    `--${boundary}`,
    'Content-Type: application/pdf',
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${input.pdfFileName}"`,
    '',
    pdfBase64,
    `--${boundary}--`,
    '',
  ];

  return Buffer.from(parts.join('\r\n'), 'ascii');
}

function validateInput(input: InvoiceMimeMessageInput): void {
  if (
    input.body.length === 0 ||
    input.body.length > emailTransportLimits.maximumBodyCharacters ||
    input.body.includes('\0') ||
    input.subject.length === 0 ||
    input.subject.length > emailTransportLimits.maximumSubjectCharacters ||
    input.fromName.length > 200 ||
    /[\u0000\r\n]/.test(input.fromName) ||
    /[\u0000\r\n]/.test(input.subject) ||
    input.pdfContent.byteLength === 0 ||
    input.pdfContent.byteLength > emailTransportLimits.maximumPdfBytes ||
    Buffer.from(input.pdfContent.subarray(0, 4)).toString('ascii') !== '%PDF' ||
    !safePdfFileNamePattern.test(input.pdfFileName) ||
    input.pdfFileName.includes('..')
  ) {
    throw new InvoiceMimeMessageValidationError();
  }
}
