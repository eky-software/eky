import { SmtpTransportError } from './smtpErrors.js';

export function createPlainAuthenticationToken(
  username: string,
  password: string,
): Buffer {
  assertCredential(username);
  assertCredential(password);

  const usernameBuffer = Buffer.from(username, 'utf8');
  const passwordBuffer = Buffer.from(password, 'utf8');
  const payload = Buffer.concat([
    Buffer.from([0]),
    usernameBuffer,
    Buffer.from([0]),
    passwordBuffer,
  ]);

  try {
    return Buffer.from(payload.toString('base64'), 'ascii');
  } finally {
    usernameBuffer.fill(0);
    passwordBuffer.fill(0);
    payload.fill(0);
  }
}

export function createLoginAuthenticationToken(value: string): Buffer {
  assertCredential(value);
  const valueBuffer = Buffer.from(value, 'utf8');

  try {
    return Buffer.from(valueBuffer.toString('base64'), 'ascii');
  } finally {
    valueBuffer.fill(0);
  }
}

function assertCredential(value: string): void {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 4_096 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new SmtpTransportError(
      'SMTP_AUTHENTICATION_FAILED',
      'authentication',
    );
  }
}
