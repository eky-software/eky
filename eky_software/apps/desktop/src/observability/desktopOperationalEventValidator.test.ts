import { describe, expect, it } from 'vitest';

import { createDesktopOperationalEvent } from './createDesktopOperationalEvent.js';
import {
  DesktopOperationalEventValidationError,
  validateDesktopOperationalEvent,
} from './desktopOperationalEventValidator.js';

const options = {
  appVersion: '0.0.0',
  buildRevision: '123456789abc',
  eventId: 'desktop-event-1',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
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
      buildRevision: '123456789abc',
      category: 'security',
      component: 'desktop',
      eventId: 'desktop-event-1',
      eventName: 'applicationWindow.navigationBlocked',
      level: 'warn',
      outcome: 'blocked',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
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

  it('allows only the classified permission request fields', () => {
    const event = createDesktopOperationalEvent(
      {
        eventName: 'electron.permissionRequestBlocked',
        frameClass: 'mainFrame',
        originClass: 'eky',
        permissionType: 'notifications',
        stage: 'request',
      },
      options,
    );

    expect(event).toMatchObject({
      eventName: 'electron.permissionRequestBlocked',
      frameClass: 'mainFrame',
      originClass: 'eky',
      permissionType: 'notifications',
    });
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        permissionType: 'https://example.test/private',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('allows only a safe code in a bootstrap failure event', () => {
    const event = createDesktopOperationalEvent(
      {
        errorCode: 'DESKTOP_START_FAILED',
        eventName: 'desktop.bootstrapFailed',
        retryable: false,
        sideEffectState: 'unknown',
        stage: 'startup',
      },
      options,
    );

    expect(event).toMatchObject({
      errorCode: 'DESKTOP_START_FAILED',
      eventName: 'desktop.bootstrapFailed',
      outcome: 'failure',
    });
    expect(() =>
      createDesktopOperationalEvent(
        {
          errorCode: 'C:\\Users\\Example\\application.asar',
          eventName: 'desktop.bootstrapFailed',
        },
        options,
      ),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('accepts only data-minimized invoice PDF archive events', () => {
    const event = createDesktopOperationalEvent(
      {
        attemptCount: 2,
        durationMs: 35,
        errorCode: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
        eventName: 'invoicePdfArchive.copyFailed',
        retryable: true,
        sideEffectState: 'none',
      },
      options,
    );

    expect(event).toMatchObject({
      attemptCount: 2,
      category: 'invoicePdfArchive',
      eventName: 'invoicePdfArchive.copyFailed',
      level: 'warn',
    });
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        invoiceNumber: '20260001',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        attemptCount: -1,
      }),
    ).toThrow(DesktopOperationalEventValidationError);
  });
});
