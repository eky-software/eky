import { describe, expect, it, vi } from 'vitest';

import { prepareSupportBundleDiagnosticData } from './prepareSupportBundleDiagnosticData.js';

describe('prepareSupportBundleDiagnosticData', () => {
  it('requires permission and includes only recent warning, error and security projections', async () => {
    const supportBundleDiagnosticEventReader = {
      readSupportBundleDiagnosticEvents: vi.fn().mockResolvedValue({
        diagnosticEvents: [
          event('recent-error', 'error', 'smtp', '2026-07-27T10:00:00.000Z'),
          event(
            'recent-security',
            'warn',
            'security',
            '2026-07-27T08:00:00.000Z',
          ),
        ],
        sourceTruncated: true,
      }),
    };
    const supportBundleIncidentSummaryReader = {
      readSupportBundleIncidentSummaries: vi.fn().mockResolvedValue({
        incidentSummaries: [
          {
            appVersion: '1.2.3',
            buildRevision: 'abcdef123456',
            count: 2,
            errorCode: 'SAFE_ERROR',
            eventName: 'smtp.deliveryFailed',
            fingerprint: 'smtp.deliveryFailed:SAFE_ERROR',
            firstOccurredAt: '2026-07-26T08:00:00.000Z',
            lastOccurredAt: '2026-07-27T08:00:00.000Z',
            outcome: 'failure',
          },
        ],
        sourceTruncated: false,
      }),
    };

    const result = await prepareSupportBundleDiagnosticData(
      {
        actorContext: {
          actorId: 'actor-1',
          authenticationMode: 'local',
          companyId: 'company-1',
          permissions: ['createSupportBundle'],
        },
      },
      {
        supportBundleDiagnosticEventReader,
        supportBundleIncidentSummaryReader,
        getRuntimeDiagnosticSummary: async () => createRuntimeSummary(),
        now: () => new Date('2026-07-27T12:00:00.000Z'),
      },
    );

    expect(result.diagnosticEvents.map(({ id }) => id)).toEqual([
      'recent-error',
      'recent-security',
    ]);
    expect(result.truncated).toBe(true);
    expect(result.incidentSummaries).toHaveLength(1);
    expect(result.incidentSummariesTruncated).toBe(false);
    expect(result).not.toHaveProperty('companyId');
    expect(result.runtimeSummary.appVersion).toBe('1.2.3');
    expect(
      supportBundleDiagnosticEventReader.readSupportBundleDiagnosticEvents,
    ).toHaveBeenCalledWith({
      earliestTimestamp: '2026-06-27T12:00:00.000Z',
      latestTimestamp: '2026-07-27T12:00:00.000Z',
    });
    expect(
      supportBundleIncidentSummaryReader.readSupportBundleIncidentSummaries,
    ).toHaveBeenCalledWith({
      earliestTimestamp: '2026-06-27T12:00:00.000Z',
      latestTimestamp: '2026-07-27T12:00:00.000Z',
    });
  });

  it('denies access before reading diagnostics', async () => {
    const supportBundleDiagnosticEventReader = {
      readSupportBundleDiagnosticEvents: vi.fn(),
    };
    const supportBundleIncidentSummaryReader = {
      readSupportBundleIncidentSummaries: vi.fn(),
    };

    await expect(
      prepareSupportBundleDiagnosticData(
        {
          actorContext: {
            actorId: 'actor-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          },
        },
        {
          supportBundleDiagnosticEventReader,
          supportBundleIncidentSummaryReader,
          getRuntimeDiagnosticSummary: vi.fn(),
        },
      ),
    ).rejects.toThrow('Permission denied.');
    expect(
      supportBundleDiagnosticEventReader.readSupportBundleDiagnosticEvents,
    ).not.toHaveBeenCalled();
    expect(
      supportBundleIncidentSummaryReader.readSupportBundleIncidentSummaries,
    ).not.toHaveBeenCalled();
  });
});

function event(
  id: string,
  level: 'error' | 'info' | 'warn',
  category: string,
  occurredAt: string,
) {
  return {
    category,
    component: 'backend' as const,
    errorCode: level === 'error' ? 'SAFE_ERROR' : null,
    eventName: 'smtp.deliveryFailed',
    id,
    level,
    occurredAt,
    outcome: level === 'info' ? ('success' as const) : ('failure' as const),
  };
}

function createRuntimeSummary() {
  return {
    appVersion: '1.2.3',
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
    operationalLogNewestMonth: null,
    operationalLogOldestMonth: null,
    operationalLogsAvailable: false,
    operationalLogTotalBytes: 0,
    platform: 'win32',
    runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };
}
