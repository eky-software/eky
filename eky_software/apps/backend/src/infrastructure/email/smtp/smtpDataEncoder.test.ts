import { describe, expect, it } from 'vitest';

import { encodeSmtpData } from './smtpDataEncoder.js';
import { SmtpTransportError } from './smtpErrors.js';
import { buildInvoiceMimeMessage } from '../mime/invoiceMimeMessageBuilder.js';

describe('encodeSmtpData', () => {
  it('dot-stuffs lines and adds exactly one SMTP terminator', () => {
    const result = encodeSmtpData(
      Buffer.from('First\r\n.Second\r\n..Third\r\n', 'ascii'),
    );

    expect(result.toString('ascii')).toBe(
      'First\r\n..Second\r\n...Third\r\n.\r\n',
    );
  });

  it('adds a canonical line ending before the terminator', () => {
    expect(encodeSmtpData(Buffer.from('Message', 'ascii')).toString('ascii')).toBe(
      'Message\r\n.\r\n',
    );
  });

  it.each([
    Buffer.from('bare\nline', 'ascii'),
    Buffer.from('bare\rline', 'ascii'),
    Buffer.from([0x61, 0x00, 0x62]),
    Buffer.from([0x61, 0x80, 0x62]),
    Buffer.from('ääkkönen', 'utf8'),
    Buffer.from('prepared\r\n.\r\n', 'ascii'),
  ])('rejects non-canonical or non-ASCII DATA', (value) => {
    expect(() => encodeSmtpData(value)).toThrow(SmtpTransportError);
  });

  it('accepts the MIME builder ASCII output and protects dot-prefixed body data', () => {
    const message = buildInvoiceMimeMessage(
      {
        body: '.Ensimmäinen rivi',
        fromAddress: 'sender@example.test',
        fromName: 'Example Sender',
        pdfContent: Buffer.from('%PDF-synthetic', 'ascii'),
        pdfFileName: 'invoice.pdf',
        subject: 'Test invoice',
        to: 'recipient@example.test',
      },
      {
        messageId: 'attempt-1@example.test',
        now: new Date('2026-07-16T12:00:00.000Z'),
      },
    );

    expect(() => encodeSmtpData(message)).not.toThrow();
  });
});
