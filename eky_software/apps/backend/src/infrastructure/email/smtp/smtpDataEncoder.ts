import { SmtpTransportError } from './smtpErrors.js';

export function encodeSmtpData(message: Uint8Array): Buffer {
  const messageBytes = Buffer.from(message);

  assertAsciiBytes(messageBytes);
  const source = messageBytes.toString('ascii');

  assertCanonicalCrlf(source);

  if (source.endsWith('\r\n.\r\n')) {
    throw protocolError();
  }

  const canonicalMessage = source.endsWith('\r\n') ? source : `${source}\r\n`;
  const dotStuffedMessage = canonicalMessage
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');

  return Buffer.from(`${dotStuffedMessage}.\r\n`, 'ascii');
}

function assertAsciiBytes(value: Uint8Array): void {
  for (const byte of value) {
    if (byte > 0x7f || byte === 0) {
      throw protocolError();
    }
  }
}

function assertCanonicalCrlf(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\r' && value[index + 1] !== '\n') {
      throw protocolError();
    }

    if (value[index] === '\n' && value[index - 1] !== '\r') {
      throw protocolError();
    }
  }

  if (value.endsWith('\r')) {
    throw protocolError();
  }
}

function protocolError(): SmtpTransportError {
  return new SmtpTransportError('SMTP_PROTOCOL_ERROR', 'data');
}
