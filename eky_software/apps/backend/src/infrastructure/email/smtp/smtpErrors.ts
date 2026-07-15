export const smtpErrorCodes = [
  'SMTP_AUTHENTICATION_FAILED',
  'SMTP_AUTHENTICATION_UNAVAILABLE',
  'SMTP_CONNECTION_CLOSED',
  'SMTP_CONNECTION_FAILED',
  'SMTP_DATA_REJECTED',
  'SMTP_ENVELOPE_REJECTED',
  'SMTP_GREETING_REJECTED',
  'SMTP_OUTCOME_UNKNOWN',
  'SMTP_PROTOCOL_ERROR',
  'SMTP_TIMEOUT',
  'SMTP_TLS_FAILED',
] as const;

export type SmtpErrorCode = (typeof smtpErrorCodes)[number];
export type SmtpFailureOutcome = 'failed' | 'outcomeUnknown';

export class SmtpTransportError extends Error {
  constructor(
    public readonly code: SmtpErrorCode,
    public readonly phase: string,
    public readonly outcome: SmtpFailureOutcome = 'failed',
  ) {
    super('SMTP delivery failed.');
    this.name = 'SmtpTransportError';
  }
}
