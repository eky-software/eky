import { describe, expect, it, vi } from 'vitest';

import { prepareSupportBundleDiagnosticData } from './prepareSupportBundleDiagnosticData.js';

describe('prepareSupportBundleDiagnosticData', () => {
  it('requires permission and includes only recent warning, error and security projections', async () => {
    const diagnosticEventReader = {
      listRecentDiagnosticEvents: vi.fn().mockResolvedValue([
        event('recent-error', 'error', 'smtp', '2026-07-27T10:00:00.000Z'),
        event('recent-info', 'info', 'runtime', '2026-07-27T09:00:00.000Z'),
        event('recent-security', 'info', 'security', '2026-07-27T08:00:00.000Z'),
        event('old-error', 'error', 'smtp', '2026-05-01T08:00:00.000Z'),
      ]),
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
        diagnosticEventReader,
        getRuntimeDiagnosticSummary: async () => createRuntimeSummary(),
        now: () => new Date('2026-07-27T12:00:00.000Z'),
      },
    );

    expect(result.diagnosticEvents.map(({ id }) => id)).toEqual([
      'recent-error',
      'recent-security',
    ]);
    expect(result).not.toHaveProperty('companyId');
    expect(result.runtimeSummary.appVersion).toBe('1.2.3');
    expect(diagnosticEventReader.listRecentDiagnosticEvents).toHaveBeenCalledWith(
      10_001,
    );
  });

  it('denies access before reading diagnostics', async () => {
    const diagnosticEventReader = {
      listRecentDiagnosticEvents: vi.fn(),
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
          diagnosticEventReader,
          getRuntimeDiagnosticSummary: vi.fn(),
        },
      ),
    ).rejects.toThrow('Permission denied.');
    expect(diagnosticEventReader.listRecentDiagnosticEvents).not.toHaveBeenCalled();
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
