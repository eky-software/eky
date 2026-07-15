import { normalizeEmailAddress } from '../address/emailAddress.js';
import { emailTransportLimits } from '../emailTransportLimits.js';
import { SmtpTransportError } from './smtpErrors.js';

export function createEhloCommand(): string {
  return 'EHLO [127.0.0.1]';
}

export function createMailFromCommand(address: string): string {
  return createMailboxCommand('MAIL FROM', address);
}

export function createRecipientCommand(address: string): string {
  return createMailboxCommand('RCPT TO', address);
}

export function assertSafeSmtpCommand(command: string): void {
  if (
    command.length === 0 ||
    Buffer.byteLength(`${command}\r\n`, 'utf8') >
      emailTransportLimits.maximumCommandBytes ||
    /[\u0000-\u001f\u007f]/.test(command)
  ) {
    throw new SmtpTransportError('SMTP_PROTOCOL_ERROR', 'command');
  }
}

function createMailboxCommand(command: 'MAIL FROM' | 'RCPT TO', address: string): string {
  const value = `${command}:<${normalizeEmailAddress(address)}>`;
  assertSafeSmtpCommand(value);
  return value;
}
