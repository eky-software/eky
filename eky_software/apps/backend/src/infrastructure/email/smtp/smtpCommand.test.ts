import { describe, expect, it } from 'vitest';

import {
  assertSafeSmtpCommand,
  createMailFromCommand,
  createRecipientCommand,
} from './smtpCommand.js';
import { SmtpTransportError } from './smtpErrors.js';

describe('SMTP commands', () => {
  it('builds normalized mailbox commands', () => {
    expect(createMailFromCommand('sender@EXAMPLE.COM')).toBe(
      'MAIL FROM:<sender@example.com>',
    );
    expect(createRecipientCommand('recipient@example.com')).toBe(
      'RCPT TO:<recipient@example.com>',
    );
  });

  it.each(['QUIT\r\nMAIL FROM:<attacker@example.com>', 'NOOP\0VALUE']) (
    'rejects command injection',
    (value) => {
      expect(() => assertSafeSmtpCommand(value)).toThrow(SmtpTransportError);
    },
  );
});
