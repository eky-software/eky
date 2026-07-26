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
        appVersion: '1.2.3',
        diagnosticEventReader,
        now: () => new Date('2026-07-27T12:00:00.000Z'),
        systemDiagnosticSummaryReader: {
          async readDatabaseSummary() {
            return {
              appliedMigrationCount: 35,
              health: 'ok' as const,
              latestMigrationName: '035_example.sql',
            };
          },
        },
      },
    );

    expect(result.diagnosticEvents.map(({ id }) => id)).toEqual([
      'recent-error',
      'recent-security',
    ]);
    expect(result).not.toHaveProperty('companyId');
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
          appVersion: '1.2.3',
          diagnosticEventReader,
          systemDiagnosticSummaryReader: {
            readDatabaseSummary: vi.fn(),
          },
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
