import { describe, expect, it } from 'vitest';

import { createBackendOperationalEvent } from './createOperationalEvent.js';
import { redactBackendOperationalEvent } from './operationalEventRedactor.js';
import {
  OperationalEventValidationError,
  validateBackendOperationalEvent,
} from './operationalEventValidator.js';

const options = {
  appVersion: '0.0.0',
  buildRevision: '123456789abc',
  eventId: 'event-1',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
  timestamp: '2026-07-26T20:00:00.000Z',
};
const correlationId = '7f62df6c-9122-4ac7-8d0f-b8ed214ee97b';

describe('backend operational event contracts', () => {
  it('creates a typed event with catalog-owned core fields', () => {
    expect(
      createBackendOperationalEvent(
        {
          correlationId,
          errorCode: 'REQUEST_FAILED',
          eventName: 'http.requestFailed',
          sideEffectState: 'none',
          stage: 'handler',
        },
        options,
      ),
    ).toEqual({
      appVersion: '0.0.0',
      buildRevision: '123456789abc',
      category: 'http',
      component: 'backend',
      correlationId,
      errorCode: 'REQUEST_FAILED',
      eventId: 'event-1',
      eventName: 'http.requestFailed',
      level: 'error',
      outcome: 'failure',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      schemaVersion: 1,
      sideEffectState: 'none',
      stage: 'handler',
      timestamp: '2026-07-26T20:00:00.000Z',
    });
  });

  it('rejects unknown event names and fields', () => {
    const event = createBackendOperationalEvent(
      { eventName: 'backend.starting' },
      options,
    );

    expect(() =>
      validateBackendOperationalEvent({
        ...event,
        unexpected: 'value',
      }),
    ).toThrow(OperationalEventValidationError);
    expect(() =>
      validateBackendOperationalEvent({
        ...event,
        eventName: 'backend.somethingElse',
      }),
    ).toThrow(OperationalEventValidationError);
  });

  it('rejects events that omit a required payload field', () => {
    const event = createBackendOperationalEvent(
      {
        correlationId,
        eventName: 'http.unknownRoute',
      },
      options,
    );
    const { correlationId: _correlationId, ...withoutCorrelationId } = event;

    expect(() =>
      validateBackendOperationalEvent(withoutCorrelationId),
    ).toThrow(OperationalEventValidationError);
  });

  it('validates correlation ids as UUIDs before generic sensitive-text checks', () => {
    expect(
      createBackendOperationalEvent(
        {
          correlationId: '010101a0-0000-4000-8000-000000000001',
          eventName: 'http.requestFailed',
          errorCode: 'HTTP_REQUEST_FAILED',
          sideEffectState: 'unknown',
          stage: 'response',
        },
        {
          appVersion: '0.0.0',
          buildRevision: '123456789abc',
          runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
        },
      ),
    ).toMatchObject({
      correlationId: '010101a0-0000-4000-8000-000000000001',
    });
  });

  it.each([
    ['password', 'synthetic-secret'],
    ['details', 'anything'],
    ['requestBody', '{"name":"Example"}'],
    ['stack', 'at C:\\Users\\Example\\app.js'],
  ])('rejects forbidden field %s', (key, value) => {
    const event = createBackendOperationalEvent(
      { eventName: 'backend.starting' },
      options,
    );

    expect(
      redactBackendOperationalEvent({ ...event, [key]: value }),
    ).toEqual({ outcome: 'rejected' });
  });

  it.each([
    'person@example.test',
    'FI07 2318 3500 0008 38',
    'Bearer synthetic-token',
    'C:\\Users\\Example\\Documents',
  ])('rejects a sensitive text value: %s', (stage) => {
    expect(() =>
      createBackendOperationalEvent(
        {
          errorCode: 'SAFE_ERROR',
          eventName: 'database.openFailed',
          stage,
        },
        options,
      ),
    ).toThrow(OperationalEventValidationError);
  });

  it('sanitizes CR, LF, NUL and other control characters', () => {
    const event = createBackendOperationalEvent(
      {
        errorCode: 'SAFE_ERROR',
        eventName: 'database.openFailed',
        stage: 'open\r\n\0database',
      },
      options,
    );

    expect(event.stage).toBe('opendatabase');
  });

  it('rejects raw Error objects and oversized strings', () => {
    expect(() => validateBackendOperationalEvent(new Error('synthetic'))).toThrow(
      OperationalEventValidationError,
    );
    expect(() =>
      createBackendOperationalEvent(
        {
          errorCode: 'SAFE_ERROR',
          eventName: 'database.openFailed',
          stage: 'a'.repeat(301),
        },
        options,
      ),
    ).toThrow(OperationalEventValidationError);
  });

  it('accepts only the bounded SMTP transport diagnostic contract', () => {
    expect(
      createBackendOperationalEvent(
        {
          ...smtpTransportFields,
          eventName: 'smtp.connectionSecured',
          stage: 'connect',
        },
        options,
      ),
    ).toMatchObject({
      category: 'smtp',
      eventName: 'smtp.connectionSecured',
      level: 'info',
      outcome: 'success',
      ...smtpTransportFields,
      stage: 'connect',
    });
  });

  it.each([
    { cipherName: 'TLS_RSA_WITH_AES_128_CBC_SHA' },
    { peerCertificateFingerprint256: 'invalid' },
    { remoteAddress: 'not-an-ip-address' },
    { remoteAddress: '192.0.2.10', remoteFamily: 'IPv6' },
    { smtpProfile: 'other' },
    { targetPort: 587 },
    { tlsVersion: 'TLSv1.1' },
  ])('rejects invalid SMTP transport metadata: %o', (override) => {
    expect(() =>
      createBackendOperationalEvent(
        {
          ...smtpTransportFields,
          ...override,
          eventName: 'smtp.deliveryCompleted',
          stage: 'delivery',
        } as Parameters<typeof createBackendOperationalEvent>[0],
        options,
      ),
    ).toThrow(OperationalEventValidationError);
  });
});

const smtpTransportFields = {
  cipherName: 'TLS_AES_256_GCM_SHA384',
  durationMs: 25,
  operationId: 'attempt-1',
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
