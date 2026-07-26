import { describe, expect, it } from 'vitest';

import { createBackendOperationalEvent } from './createOperationalEvent.js';
import { redactBackendOperationalEvent } from './operationalEventRedactor.js';
import {
  OperationalEventValidationError,
  validateBackendOperationalEvent,
} from './operationalEventValidator.js';

const options = {
  appVersion: '0.0.0',
  eventId: 'event-1',
  timestamp: '2026-07-26T20:00:00.000Z',
};

describe('backend operational event contracts', () => {
  it('creates a typed event with catalog-owned core fields', () => {
    expect(
      createBackendOperationalEvent(
        {
          correlationId: 'correlation-1',
          errorCode: 'REQUEST_FAILED',
          eventName: 'http.requestFailed',
          sideEffectState: 'none',
          stage: 'handler',
        },
        options,
      ),
    ).toEqual({
      appVersion: '0.0.0',
      category: 'http',
      component: 'backend',
      correlationId: 'correlation-1',
      errorCode: 'REQUEST_FAILED',
      eventId: 'event-1',
      eventName: 'http.requestFailed',
      level: 'error',
      outcome: 'failure',
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
        correlationId: 'correlation-1',
        eventName: 'http.unknownRoute',
      },
      options,
    );
    const { correlationId: _correlationId, ...withoutCorrelationId } = event;

    expect(() =>
      validateBackendOperationalEvent(withoutCorrelationId),
    ).toThrow(OperationalEventValidationError);
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
});
