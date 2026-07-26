import { describe, expect, it } from 'vitest';

import { createDesktopOperationalEvent } from './createDesktopOperationalEvent.js';
import {
  DesktopOperationalEventValidationError,
  validateDesktopOperationalEvent,
} from './desktopOperationalEventValidator.js';

const options = {
  appVersion: '0.0.0',
  eventId: 'desktop-event-1',
  timestamp: '2026-07-26T20:00:00.000Z',
};

describe('desktop operational event contracts', () => {
  it('creates a catalog-owned desktop security event', () => {
    expect(
      createDesktopOperationalEvent(
        {
          eventName: 'applicationWindow.navigationBlocked',
          stage: 'will-navigate',
        },
        options,
      ),
    ).toEqual({
      appVersion: '0.0.0',
      category: 'security',
      component: 'desktop',
      eventId: 'desktop-event-1',
      eventName: 'applicationWindow.navigationBlocked',
      level: 'warn',
      outcome: 'blocked',
      schemaVersion: 1,
      stage: 'will-navigate',
      timestamp: '2026-07-26T20:00:00.000Z',
    });
  });

  it('rejects unknown event names, fields and raw errors', () => {
    const event = createDesktopOperationalEvent(
      { eventName: 'desktop.starting' },
      options,
    );

    expect(() =>
      validateDesktopOperationalEvent({ ...event, extra: true }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        eventName: 'desktop.unknown',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() => validateDesktopOperationalEvent(new Error('synthetic'))).toThrow(
      DesktopOperationalEventValidationError,
    );
  });

  it('rejects events that omit a required payload field', () => {
    const event = createDesktopOperationalEvent(
      {
        errorCode: 'DESKTOP_FAILED',
        eventName: 'desktop.shutdownFailed',
      },
      options,
    );
    const { errorCode: _errorCode, ...withoutErrorCode } = event;

    expect(() =>
      validateDesktopOperationalEvent(withoutErrorCode),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('requires a safe correlation id for support bundle events', () => {
    const event = createDesktopOperationalEvent(
      {
        correlationId: '00000000-0000-4000-8000-000000000001',
        eventName: 'supportBundle.creationStarted',
        stage: 'create',
      },
      options,
    );
    const { correlationId: _correlationId, ...withoutCorrelationId } = event;

    expect(event).toMatchObject({
      category: 'supportBundle',
      correlationId: '00000000-0000-4000-8000-000000000001',
      eventName: 'supportBundle.creationStarted',
    });
    expect(() =>
      validateDesktopOperationalEvent(withoutCorrelationId),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it.each([
    ['password', 'synthetic'],
    ['authorization', 'Bearer synthetic'],
    ['details', 'raw details'],
  ])('rejects forbidden field %s', (key, value) => {
    const event = createDesktopOperationalEvent(
      { eventName: 'desktop.starting' },
      options,
    );

    expect(() =>
      validateDesktopOperationalEvent({ ...event, [key]: value }),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it.each([
    'person@example.test',
    'FI07 2318 3500 0008 38',
    'C:\\Users\\Example\\Desktop',
  ])('rejects sensitive values: %s', (stage) => {
    expect(() =>
      createDesktopOperationalEvent(
        {
          errorCode: 'DESKTOP_FAILED',
          eventName: 'desktop.shutdownFailed',
          stage,
        },
        options,
      ),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('sanitizes control characters', () => {
    const event = createDesktopOperationalEvent(
      {
        errorCode: 'DESKTOP_FAILED',
        eventName: 'desktop.shutdownFailed',
        stage: 'shutdown\r\n\0finally',
      },
      options,
    );

    expect(event.stage).toBe('shutdownfinally');
  });
});
