import type {
  SmtpErrorCode,
  SmtpFailureOutcome,
} from '../../smtp/smtpErrors.js';

export type SmtpTransportFailureOperationalEventName =
  | 'smtp.authenticationFailed'
  | 'smtp.connectionFailed'
  | 'smtp.deliveryFailed'
  | 'smtp.deliveryOutcomeUnknown'
  | 'smtp.tlsFailed';

export interface SmtpTransportFailureOperationalEvent {
  eventName: SmtpTransportFailureOperationalEventName;
  retryable: boolean;
  sideEffectState: 'none' | 'unknown';
}

export function mapSmtpTransportFailureToOperationalEvent(input: {
  errorCode: SmtpErrorCode;
  outcome: SmtpFailureOutcome;
  phase: string;
}): SmtpTransportFailureOperationalEvent {
  const eventName = mapEventName(input.errorCode, input.phase);

  return Object.freeze({
    eventName,
    retryable: eventName === 'smtp.connectionFailed',
    sideEffectState:
      input.outcome === 'outcomeUnknown' ||
      input.phase === 'finalAcceptance'
        ? 'unknown'
        : 'none',
  });
}

function mapEventName(
  errorCode: SmtpErrorCode,
  phase: string,
): SmtpTransportFailureOperationalEventName {
  switch (errorCode) {
    case 'SMTP_TLS_FAILED':
      return 'smtp.tlsFailed';
    case 'SMTP_AUTHENTICATION_FAILED':
    case 'SMTP_AUTHENTICATION_UNAVAILABLE':
      return 'smtp.authenticationFailed';
    case 'SMTP_CONNECTION_FAILED':
      return 'smtp.connectionFailed';
    case 'SMTP_CONNECTION_CLOSED':
      return phase === 'connect'
        ? 'smtp.connectionFailed'
        : 'smtp.deliveryFailed';
    case 'SMTP_TIMEOUT':
      return phase === 'connect'
        ? 'smtp.connectionFailed'
        : 'smtp.deliveryFailed';
    case 'SMTP_OUTCOME_UNKNOWN':
      return 'smtp.deliveryOutcomeUnknown';
    case 'SMTP_DATA_REJECTED':
    case 'SMTP_ENVELOPE_REJECTED':
    case 'SMTP_GREETING_REJECTED':
    case 'SMTP_PROTOCOL_ERROR':
      return 'smtp.deliveryFailed';
    default:
      return assertNever(errorCode);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported SMTP error code: ${String(value)}`);
}
