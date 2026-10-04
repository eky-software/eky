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

  it('parses the same bounded replies independently of chunk boundaries', () => {
    const wire = '250-abcdefghijkl\r\n250 AUTH PLAIN\r\n220 ready\r\n';
    const expected = [
      {
        code: 250,
        lines: [
          { code: 250, separator: '-', text: 'abcdefghijkl' },
          { code: 250, separator: ' ', text: 'AUTH PLAIN' },
        ],
      },
      { code: 220, lines: [{ code: 220, separator: ' ', text: 'ready' }] },
    ];

    for (const chunks of chunkPartitions(wire)) {
      const parser = new SmtpReplyParser({
        maximumReplyLineBytes: 16,
        maximumReplyBytes: 34,
      });
      expect(chunks.flatMap((chunk) => parser.push(chunk))).toEqual(expected);
      expect(() => parser.finish()).not.toThrow();
    }
  });

  it.each([
    { wire: '250 abcdefghijklm\r\n', maximumReplyBytes: 100 },
    { wire: '250-abcdefghijkl\r\n250 AUTH PLAIN\r\n', maximumReplyBytes: 33 },
    { wire: '250-first\r\n251 last\r\n', maximumReplyBytes: 100 },
    { wire: '250 bare-lf\n', maximumReplyBytes: 100 },
    { wire: '250 bare-cr\rx', maximumReplyBytes: 100 },
    { wire: '250 invalid\0x\r\n', maximumReplyBytes: 100 },
    { wire: '999 invalid\r\n', maximumReplyBytes: 100 },
    { wire: '250 incomplete\r', maximumReplyBytes: 100 },
    { wire: '250-more\r\n', maximumReplyBytes: 100 },
  ])('keeps protocol and byte limits under every partition: $wire', ({ wire, maximumReplyBytes }) => {
    for (const chunks of chunkPartitions(wire)) {
      const parser = new SmtpReplyParser({
        maximumReplyLineBytes: 16,
        maximumReplyBytes,
      });
      expect(() => {
        chunks.forEach((chunk) => parser.push(chunk));
        parser.finish();
      }).toThrow(SmtpTransportError);
    }
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

  it('rejects oversized unfinished input immediately without stream completion', () => {
    const lineParser = new SmtpReplyParser({ maximumReplyLineBytes: 10 });
    expect(lineParser.push(Buffer.from('250 123456'))).toEqual([]);
    expect(() => lineParser.push(Buffer.from('7'))).toThrow(SmtpTransportError);

    const replyParser = new SmtpReplyParser({
      maximumReplyBytes: 20,
      maximumReplyLineBytes: 100,
    });
    expect(replyParser.push(Buffer.from('250-first\r\n250 last'))).toEqual([]);
    expect(replyParser.push(Buffer.from('x'))).toEqual([]);
    expect(() => replyParser.push(Buffer.from('x'))).toThrow(SmtpTransportError);
  });
});

function chunkPartitions(value: string): Buffer[][] {
  const wire = Buffer.from(value, 'latin1');
  return [
    [wire],
    Array.from(wire, (byte) => Buffer.from([byte])),
    ...Array.from({ length: wire.length + 1 }, (_, offset) => [
      wire.subarray(0, offset),
      wire.subarray(offset),
    ]),
  ];
}
