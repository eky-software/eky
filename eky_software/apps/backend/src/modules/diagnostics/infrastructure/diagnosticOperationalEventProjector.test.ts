import { describe, expect, it } from 'vitest';

import { createBackendOperationalEvent } from '../../../observability/createOperationalEvent.js';
import type { BackendOperationalEventName } from '../../../observability/operationalEvent.js';
import { projectDiagnosticOperationalEvent } from './diagnosticOperationalEventProjector.js';

const smtpEventNames = [
  'smtp.authenticationFailed',
  'smtp.connectionFailed',
  'smtp.connectionSecured',
  'smtp.deliveryCompleted',
  'smtp.deliveryFailed',
  'smtp.deliveryOutcomeUnknown',
  'smtp.tlsFailed',
] as const satisfies readonly BackendOperationalEventName[];

describe('projectDiagnosticOperationalEvent', () => {
  it.each(smtpEventNames)(
    'projects safe SMTP metadata without transport routing fields for %s',
    (eventName) => {
      const projection = projectDiagnosticOperationalEvent(
        createSmtpEvent(eventName),
      );

      expect(projection).toEqual(
        expect.objectContaining({
          cipherName: 'TLS_AES_256_GCM_SHA384',
          durationMs: 25,
          eventName,
          peerCertificateFingerprint256: expect.stringMatching(
            /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/,
          ),
          smtpProfile: 'dnaSmtp',
          stage: expect.any(String),
          tlsVersion: 'TLSv1.3',
        }),
      );
      expect(projection).not.toHaveProperty('operationId');
      expect(JSON.stringify(projection)).not.toContain('192.0.2.10');
      expect(projection).not.toHaveProperty('targetPort');
    },
  );

  it('keeps a non-SMTP operation id in the diagnostics read model', () => {
    const projection = projectDiagnosticOperationalEvent(
      createBackendOperationalEvent(
        {
          errorCode: 'PDF_FAILED',
          eventName: 'invoicePdf.generationFailed',
          operationId: 'invoice-pdf-operation',
        },
        eventOptions('non-smtp'),
      ),
    );

    expect(projection).toEqual(
      expect.objectContaining({
        operationId: 'invoice-pdf-operation',
      }),
    );
  });
});

function createSmtpEvent(eventName: (typeof smtpEventNames)[number]) {
  const transportMetadata = {
    cipherName: 'TLS_AES_256_GCM_SHA384',
    durationMs: 25,
    operationId: 'smtp-attempt-must-not-be-returned',
    peerCertificateFingerprint256: Array.from(
      { length: 32 },
      (_, index) => index.toString(16).padStart(2, '0').toUpperCase(),
    ).join(':'),
    remoteAddress: '192.0.2.10',
    remoteFamily: 'IPv4' as const,
    smtpProfile: 'dnaSmtp' as const,
    targetPort: 465 as const,
    tlsVersion: 'TLSv1.3' as const,
  };

  switch (eventName) {
    case 'smtp.connectionSecured':
      return createBackendOperationalEvent(
        {
          ...transportMetadata,
          eventName,
          stage: 'connect',
        },
        eventOptions(eventName),
      );
    case 'smtp.deliveryCompleted':
      return createBackendOperationalEvent(
        {
          ...transportMetadata,
          eventName,
          stage: 'finalAcceptance',
        },
        eventOptions(eventName),
      );
    case 'smtp.deliveryOutcomeUnknown':
      return createBackendOperationalEvent(
        {
          ...transportMetadata,
          errorCode: 'SMTP_DELIVERY_OUTCOME_UNKNOWN',
          eventName,
          retryable: false,
          sideEffectState: 'unknown',
          stage: 'finalAcceptance',
        },
        eventOptions(eventName),
      );
    case 'smtp.authenticationFailed':
    case 'smtp.connectionFailed':
    case 'smtp.deliveryFailed':
    case 'smtp.tlsFailed':
      return createBackendOperationalEvent(
        {
          ...transportMetadata,
          errorCode: failureCode(eventName),
          eventName,
          retryable: eventName === 'smtp.connectionFailed',
          sideEffectState: 'none',
          stage:
            eventName === 'smtp.authenticationFailed'
              ? 'authenticate'
              : 'connect',
        },
        eventOptions(eventName),
      );
  }
}

function failureCode(
  eventName:
    | 'smtp.authenticationFailed'
    | 'smtp.connectionFailed'
    | 'smtp.deliveryFailed'
    | 'smtp.tlsFailed',
): string {
  switch (eventName) {
    case 'smtp.authenticationFailed':
      return 'SMTP_AUTHENTICATION_FAILED';
    case 'smtp.connectionFailed':
      return 'SMTP_CONNECTION_FAILED';
    case 'smtp.deliveryFailed':
      return 'SMTP_DATA_REJECTED';
    case 'smtp.tlsFailed':
      return 'SMTP_TLS_FAILED';
  }
}

function eventOptions(eventId: string) {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    eventId,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    timestamp: '2026-07-28T12:00:00.000Z',
  };
}
