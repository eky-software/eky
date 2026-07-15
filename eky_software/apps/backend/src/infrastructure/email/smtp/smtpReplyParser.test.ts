import { describe, expect, it } from 'vitest';

import { SmtpTransportError } from './smtpErrors.js';
import { SmtpReplyParser } from './smtpReplyParser.js';

describe('SmtpReplyParser', () => {
  it('parses a reply split across chunks', () => {
    const parser = new SmtpReplyParser();

    expect(parser.push(Buffer.from('250-example\r'))).toEqual([]);
    expect(parser.push(Buffer.from('\n250 AUTH PLAIN LOGIN\r\n'))).toEqual([
      {
        code: 250,
        lines: [
          { code: 250, separator: '-', text: 'example' },
          { code: 250, separator: ' ', text: 'AUTH PLAIN LOGIN' },
        ],
      },
    ]);
    expect(() => parser.finish()).not.toThrow();
  });

  it('returns multiple complete replies from one chunk', () => {
    const parser = new SmtpReplyParser();

    expect(parser.push(Buffer.from('220 ready\r\n250 accepted\r\n'))).toHaveLength(
      2,
    );
  });

  it.each([
    '250-first\r\n251 last\r\n',
    '250 bare-lf\n',
    '250 bare-cr\rvalue',
    '999 invalid\r\n',
    '250 invalid\0value\r\n',
  ])('rejects malformed protocol input', (value) => {
    const parser = new SmtpReplyParser();

    expect(() => parser.push(Buffer.from(value))).toThrow(SmtpTransportError);
  });

  it('rejects an oversized line and an oversized multiline reply', () => {
    const lineParser = new SmtpReplyParser({ maximumReplyLineBytes: 10 });
    const replyParser = new SmtpReplyParser({
      maximumReplyBytes: 20,
      maximumReplyLineBytes: 100,
    });

    expect(() =>
      lineParser.push(Buffer.from(`250 ${'x'.repeat(20)}\r\n`)),
    ).toThrow(SmtpTransportError);
    expect(() =>
      replyParser.push(Buffer.from('250-12345678\r\n250 12345678\r\n')),
    ).toThrow(SmtpTransportError);
  });

  it('rejects an incomplete reply when the stream ends', () => {
    const parser = new SmtpReplyParser();
    parser.push(Buffer.from('250-still waiting\r\n'));

    expect(() => parser.finish()).toThrow(SmtpTransportError);
  });
});
