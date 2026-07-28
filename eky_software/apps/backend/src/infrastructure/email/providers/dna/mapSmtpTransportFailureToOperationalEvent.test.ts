import { describe, expect, it } from 'vitest';

import type { SmtpErrorCode } from '../../smtp/smtpErrors.js';
import { mapSmtpTransportFailureToOperationalEvent } from './mapSmtpTransportFailureToOperationalEvent.js';

describe('mapSmtpTransportFailureToOperationalEvent', () => {
  it.each([
    ['SMTP_TLS_FAILED', 'connect', 'smtp.tlsFailed'],
    [
      'SMTP_AUTHENTICATION_FAILED',
      'authentication',
      'smtp.authenticationFailed',
    ],
    [
      'SMTP_AUTHENTICATION_UNAVAILABLE',
      'authentication',
      'smtp.authenticationFailed',
    ],
    ['SMTP_CONNECTION_FAILED', 'connect', 'smtp.connectionFailed'],
    ['SMTP_CONNECTION_CLOSED', 'connect', 'smtp.connectionFailed'],
    ['SMTP_CONNECTION_CLOSED', 'delivery', 'smtp.deliveryFailed'],
    ['SMTP_TIMEOUT', 'connect', 'smtp.connectionFailed'],
    ['SMTP_TIMEOUT', 'authentication', 'smtp.deliveryFailed'],
    ['SMTP_OUTCOME_UNKNOWN', 'finalAcceptance', 'smtp.deliveryOutcomeUnknown'],
    ['SMTP_GREETING_REJECTED', 'greeting', 'smtp.deliveryFailed'],
    ['SMTP_ENVELOPE_REJECTED', 'recipient', 'smtp.deliveryFailed'],
    ['SMTP_DATA_REJECTED', 'dataPermission', 'smtp.deliveryFailed'],
    ['SMTP_PROTOCOL_ERROR', 'reply', 'smtp.deliveryFailed'],
  ] satisfies readonly [
    SmtpErrorCode,
    string,
    string,
  ][])(
    'maps %s during %s to %s',
    (errorCode, phase, expectedEventName) => {
      expect(
        mapSmtpTransportFailureToOperationalEvent({
          errorCode,
          outcome:
            errorCode === 'SMTP_OUTCOME_UNKNOWN'
              ? 'outcomeUnknown'
              : 'failed',
          phase,
        }),
      ).toMatchObject({
        eventName: expectedEventName,
        retryable: expectedEventName === 'smtp.connectionFailed',
        sideEffectState:
          errorCode === 'SMTP_OUTCOME_UNKNOWN' ? 'unknown' : 'none',
      });
    },
  );

  it.each([
    {
      errorCode: 'SMTP_DATA_REJECTED',
      eventName: 'smtp.deliveryFailed',
      outcome: 'failed',
      phase: 'finalAcceptance',
      sideEffectState: 'none',
    },
    {
      errorCode: 'SMTP_OUTCOME_UNKNOWN',
      eventName: 'smtp.deliveryOutcomeUnknown',
      outcome: 'outcomeUnknown',
      phase: 'finalAcceptance',
      sideEffectState: 'unknown',
    },
    {
      errorCode: 'SMTP_OUTCOME_UNKNOWN',
      eventName: 'smtp.deliveryOutcomeUnknown',
      outcome: 'outcomeUnknown',
      phase: 'data',
      sideEffectState: 'unknown',
    },
    {
      errorCode: 'SMTP_AUTHENTICATION_FAILED',
      eventName: 'smtp.authenticationFailed',
      outcome: 'failed',
      phase: 'authentication',
      sideEffectState: 'none',
    },
    {
      errorCode: 'SMTP_CONNECTION_FAILED',
      eventName: 'smtp.connectionFailed',
      outcome: 'failed',
      phase: 'connect',
      sideEffectState: 'none',
    },
  ] satisfies readonly {
    errorCode: SmtpErrorCode;
    eventName: string;
    outcome: 'failed' | 'outcomeUnknown';
    phase: string;
    sideEffectState: 'none' | 'unknown';
  }[])(
    'derives $sideEffectState side-effect state from $outcome outcome for $errorCode',
    ({ errorCode, eventName, outcome, phase, sideEffectState }) => {
      expect(
        mapSmtpTransportFailureToOperationalEvent({
          errorCode,
          outcome,
          phase,
        }),
      ).toMatchObject({
        eventName,
        sideEffectState,
      });
    },
  );
});
