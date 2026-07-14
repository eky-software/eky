export const secretBrokerErrorCodes = Object.freeze([
  'SECRET_STORAGE_UNAVAILABLE',
  'SECRET_NOT_CONFIGURED',
  'SECRET_PAYLOAD_INVALID',
  'SECRET_DECRYPTION_FAILED',
  'SECRET_WRITE_FAILED',
  'SECRET_REMOVE_FAILED',
  'SECRET_BROKER_REQUEST_INVALID',
] as const);

export type SecretBrokerErrorCode =
  (typeof secretBrokerErrorCodes)[number];

const secretBrokerErrorCodeSet = new Set<string>(secretBrokerErrorCodes);

export function isSecretBrokerErrorCode(
  value: unknown,
): value is SecretBrokerErrorCode {
  return typeof value === 'string' && secretBrokerErrorCodeSet.has(value);
}

export class SecretBrokerError extends Error {
  constructor(readonly code: SecretBrokerErrorCode) {
    super('Email secret operation failed.');
    this.name = 'SecretBrokerError';
  }
}
