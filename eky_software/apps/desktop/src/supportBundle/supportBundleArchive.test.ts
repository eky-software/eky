import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { createSupportBundleArchive } from './supportBundleArchive.js';

describe('createSupportBundleArchive', () => {
  it('creates a gzip JSON artifact with only sanitized diagnostics and checksums', () => {
    const diagnosticEvents = [
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
    ];
    const archive = createSupportBundleArchive({
      appVersion: '1.2.3',
      architecture: 'x64',
      backendData: {
        backendVersion: '1.2.3',
        database: {
          appliedMigrationCount: 35,
          health: 'ok',
          latestMigrationName: '035_example.sql',
        },
        diagnosticEvents,
        diagnosticPeriodDays: 30,
        runtimeSummary: createRuntimeSummary(),
        truncated: false,
      },
      createdAt: new Date('2026-07-27T12:30:00.000Z'),
      creationCorrelationId: 'correlation-1',
      platform: 'win32',
    });
    const document = JSON.parse(
      gunzipSync(archive.compressed).toString('utf8'),
    ) as Record<string, unknown>;
    const serialized = JSON.stringify(document);

    expect(archive.fileName).toBe('eky-support-2026-07-27.ekysupport');
    expect(document).toMatchObject({
      manifest: {
        creationCorrelationId: 'correlation-1',
        supportBundleFormatVersion: 1,
      },
      system: {
        appVersion: '1.2.3',
        architecture: 'x64',
        backendVersion: '1.2.3',
        platform: 'win32',
      },
    });
    expect(
      (
        document.manifest as {
          sectionChecksums: Record<string, string>;
        }
      ).sectionChecksums.diagnosticEvents,
    ).toBe(
      createHash('sha256')
        .update(JSON.stringify(diagnosticEvents), 'utf8')
        .digest('hex'),
    );
    expect(
      Object.keys(
        (
          document.manifest as {
            sectionChecksums: Record<string, string>;
          }
        ).sectionChecksums,
      ),
    ).toEqual([
      'database',
      'diagnosticEvents',
      'incidentSummaries',
      'operationalSummary',
      'runtimeSummary',
      'system',
    ]);
    expect(serialized).not.toContain('companyId');
    expect(serialized).not.toContain('userData');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('requestBody');
  });
});

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
