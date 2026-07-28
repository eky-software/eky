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
          phase === 'finalAcceptance' ? 'unknown' : 'none',
      });
    },
  );

  it('uses unknown side-effect state for an explicitly unknown outcome', () => {
    expect(
      mapSmtpTransportFailureToOperationalEvent({
        errorCode: 'SMTP_OUTCOME_UNKNOWN',
        outcome: 'outcomeUnknown',
        phase: 'data',
      }),
    ).toMatchObject({ sideEffectState: 'unknown' });
  });
});
