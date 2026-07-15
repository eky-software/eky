import { describe, expect, it } from 'vitest';

import {
  buildInvoiceMimeMessage,
  InvoiceMimeMessageValidationError,
} from './invoiceMimeMessageBuilder.js';

const pdfContent = Buffer.from('%PDF-1.7\nsynthetic invoice', 'ascii');

describe('buildInvoiceMimeMessage', () => {
  it('builds a CRLF-only text and PDF message with encoded Finnish text', () => {
    const message = buildInvoiceMimeMessage(
      {
        body: 'Hei!\nLasku sisältää ääkkösiä.',
        cc: 'copy@example.com',
        fromAddress: 'billing@example.com',
        fromName: 'EKY-Rakenne Oy',
        pdfContent,
        pdfFileName: 'lasku-2026001.pdf',
        subject: 'Lasku ääkkösillä',
        to: 'recipient@example.com',
      },
      {
        messageId: 'fixed-message@example.com',
        now: new Date('2026-07-16T20:00:00.000Z'),
      },
    );
    const value = message.toString('ascii');

    expect(value).toContain('Message-ID: <fixed-message@example.com>');
    expect(value).toContain('Content-Type: text/plain; charset=utf-8');
    expect(value).toContain('Content-Type: application/pdf');
    expect(value).toContain('filename="lasku-2026001.pdf"');
    expect(value).toContain('Cc: copy@example.com');
    expect(value).not.toContain('Bcc:');
    expect(value).not.toContain('text/html');
    expect(value.replace(/\r\n/g, '')).not.toContain('\n');

    const attachmentBase64 = pdfContent.toString('base64');
    expect(value).toContain(attachmentBase64);
  });

  it('wraps base64 lines at no more than 76 characters', () => {
    const message = buildInvoiceMimeMessage({
      body: 'Body',
      fromAddress: 'billing@example.com',
      fromName: 'Sender',
      pdfContent: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(300, 1)]),
      pdfFileName: 'invoice.pdf',
      subject: 'Invoice',
      to: 'recipient@example.com',
    }).toString('ascii');
    const encodedLines = message
      .split('\r\n')
      .filter((line) => /^[A-Za-z0-9+/=]+$/.test(line) && line.length > 10);

    expect(encodedLines.every((line) => line.length <= 76)).toBe(true);
  });

  it.each([
    { subject: 'Invoice\r\nBcc: victim@example.com' },
    { fromName: 'Sender\nBcc: victim@example.com' },
    { body: 'Body\0value' },
    { pdfFileName: '../invoice.pdf' },
    { pdfFileName: 'lasku ää.pdf' },
  ])('rejects unsafe message input', (override) => {
    expect(() =>
      buildInvoiceMimeMessage({
        body: 'Body',
        fromAddress: 'billing@example.com',
        fromName: 'Sender',
        pdfContent,
        pdfFileName: 'invoice.pdf',
        subject: 'Invoice',
        to: 'recipient@example.com',
        ...override,
      }),
    ).toThrow(InvoiceMimeMessageValidationError);
  });

  it('rejects content that is not a PDF', () => {
    expect(() =>
      buildInvoiceMimeMessage({
        body: 'Body',
        fromAddress: 'billing@example.com',
        fromName: 'Sender',
        pdfContent: Buffer.from('not a pdf'),
        pdfFileName: 'invoice.pdf',
        subject: 'Invoice',
        to: 'recipient@example.com',
      }),
    ).toThrow(InvoiceMimeMessageValidationError);
  });
});
