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
        category: 'smtp',
        component: 'backend' as const,
        errorCode: 'SMTP_TLS_FAILED',
        eventName: 'smtp.tlsFailed',
        id: 'backend:event-1',
        level: 'error' as const,
        occurredAt: '2026-07-27T12:00:00.000Z',
        outcome: 'failure' as const,
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
