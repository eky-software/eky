import { describe, expect, it } from 'vitest';

import { readSupportBundleBackendData } from './supportBundleBackendData.js';

describe('readSupportBundleBackendData', () => {
  it('accepts the exact safe backend contract', () => {
    expect(readSupportBundleBackendData(createValidData())).toEqual(
      createValidData(),
    );
  });

  it('rejects raw metadata and personal fields', () => {
    expect(() =>
      readSupportBundleBackendData({
        ...createValidData(),
        diagnosticEvents: [
          {
            ...createValidData().diagnosticEvents[0],
            email: 'person@example.test',
          },
        ],
      }),
    ).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
    expect(() =>
      readSupportBundleBackendData({
        ...createValidData(),
        incidentSummaries: [
          {
            ...createValidData().incidentSummaries[0],
            email: 'person@example.test',
          },
        ],
      }),
    ).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });

  it('accepts safe TLS metadata and rejects the SMTP peer address', () => {
    const peerCertificateFingerprint256 = Array.from(
      { length: 32 },
      (_, index) =>
        index.toString(16).padStart(2, '0').toUpperCase(),
    ).join(':');
    const validData = createValidData();
    const tlsEvent = {
      category: 'smtp',
      cipherName: 'TLS_AES_256_GCM_SHA384',
      component: 'backend' as const,
      durationMs: 25,
      errorCode: null,
      eventName: 'smtp.connectionSecured',
      id: 'backend:smtp-event-1',
      level: 'info' as const,
      occurredAt: '2026-07-27T13:00:00.000Z',
      outcome: 'success' as const,
      peerCertificateFingerprint256,
      smtpProfile: 'dnaSmtp' as const,
      stage: 'connect',
      tlsVersion: 'TLSv1.3' as const,
    };

    expect(
      readSupportBundleBackendData({
        ...validData,
        diagnosticEvents: [tlsEvent],
      }).diagnosticEvents,
    ).toEqual([tlsEvent]);
    expect(() =>
      readSupportBundleBackendData({
        ...validData,
        diagnosticEvents: [
          { ...tlsEvent, remoteAddress: '192.0.2.10' },
        ],
      }),
    ).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });

  it('accepts only the allowlisted recovery point projection', () => {
    const validData = createValidData();
    const recoveryEvent = {
      category: 'recoveryPoint',
      component: 'desktop' as const,
      correlationId: '33333333-3333-4333-8333-333333333333',
      errorCode: 'RECOVERY_POINT_SOURCE_UNHEALTHY',
      eventName: 'recoveryPoint.failed',
      id: 'desktop:recovery-event-1',
      level: 'warn' as const,
      occurredAt: '2026-07-27T13:00:00.000Z',
      outcome: 'failure' as const,
      recoveryPointKind: 'daily' as const,
      retryable: true,
      sideEffectState: 'unknown' as const,
      stage: 'creation',
    };

    expect(
      readSupportBundleBackendData({
        ...validData,
        diagnosticEvents: [recoveryEvent],
      }).diagnosticEvents,
    ).toEqual([recoveryEvent]);
    expect(() =>
      readSupportBundleBackendData({
        ...validData,
        diagnosticEvents: [
          { ...recoveryEvent, manifest: { entries: ['private'] } },
        ],
      }),
    ).toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });
});

function createValidData() {
  return {
    backendVersion: '1.2.3',
    database: {
      appliedMigrationCount: 35,
      health: 'ok' as const,
      latestMigrationName: '035_example.sql',
    },
    diagnosticEvents: [
      {
        appVersion: '0.1.0-alpha.1',
        buildRevision: 'abcdef123456',
        category: 'smtp',
        component: 'backend' as const,
        correlationId: '11111111-1111-4111-8111-111111111111',
        durationMs: 120,
        errorCode: 'SMTP_TLS_FAILED',
        eventName: 'smtp.tlsFailed',
        fingerprint: 'smtp.tlsFailed:SMTP_TLS_FAILED',
        id: 'backend:event-1',
        level: 'error' as const,
        occurredAt: '2026-07-27T12:00:00.000Z',
        operationId: 'send-attempt-1',
        outcome: 'failure' as const,
        retryable: true,
        runtimeInstanceId: '22222222-2222-4222-8222-222222222222',
        sideEffectState: 'none' as const,
        stage: 'tlsHandshake',
      },
    ],
    diagnosticPeriodDays: 30 as const,
    incidentSummaries: [
      {
        appVersion: '0.1.0-alpha.1',
        buildRevision: 'abcdef123456',
        count: 2,
        errorCode: 'SMTP_TLS_FAILED',
        eventName: 'smtp.tlsFailed',
        fingerprint: 'smtp.tlsFailed:SMTP_TLS_FAILED',
        firstOccurredAt: '2026-07-26T12:00:00.000Z',
        lastOccurredAt: '2026-07-27T12:00:00.000Z',
        outcome: 'failure' as const,
      },
    ],
    incidentSummariesTruncated: false,
    runtimeSummary: createRuntimeSummary(),
    truncated: false,
  };
}

function createRuntimeSummary() {
  return {
    appVersion: '0.1.0-alpha.1',
    appliedMigrationCount: 35,
    architecture: 'x64',
    buildCreatedAt: '2026-07-27T10:00:00.000Z',
    buildDirty: false,
    buildRevision: 'abcdef123456',
    databaseHealth: 'ok' as const,
    electronVersion: '42.7.0',
    latestErrorAt: null,
    latestMigrationName: '035_example.sql',
    latestSecurityEventAt: null,
    latestWarningAt: null,
    nodeVersion: 'v24.11.0',
    operationalLogNewestMonth: '2026-07',
    operationalLogOldestMonth: '2026-07',
    operationalLogsAvailable: true,
    operationalLogTotalBytes: 4_096,
    platform: 'win32',
    runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };
}
