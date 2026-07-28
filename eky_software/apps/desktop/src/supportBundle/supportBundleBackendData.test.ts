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
