import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { createSupportBundleArchive } from './supportBundleArchive.js';
import { supportBundleSizeBudget } from './supportBundleSizeBudget.js';

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
        incidentSummaries: [
          {
            appVersion: '1.2.3',
            buildRevision: 'abcdef123456',
            count: 3,
            errorCode: 'SMTP_TLS_FAILED',
            eventName: 'smtp.tlsFailed',
            fingerprint: 'smtp.tlsFailed:SMTP_TLS_FAILED',
            firstOccurredAt: '2026-07-26T12:00:00.000Z',
            lastOccurredAt: '2026-07-27T12:00:00.000Z',
            outcome: 'failure',
          },
        ],
        incidentSummariesTruncated: true,
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
        supportBundleFormatVersion: 2,
        truncatedSections: ['incidentSummaries'],
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
    expect(document.incidentSummaries).toEqual([
      expect.objectContaining({
        count: 3,
        eventName: 'smtp.tlsFailed',
      }),
    ]);
    expect(serialized).not.toContain('companyId');
    expect(serialized).not.toContain('userData');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('requestBody');
  });

  it('enforces the projected section budgets and preserves newest items', () => {
    const diagnosticEvents = Array.from({ length: 180 }, (_, index) =>
      createDiagnosticEvent(index, 100_000),
    );
    const incidentSummaries = Array.from({ length: 55 }, (_, index) =>
      createIncidentSummary(index, 80_000),
    );
    const document = readArchiveDocument(
      createSupportBundleArchive(
        createArchiveInput({ diagnosticEvents, incidentSummaries }),
      ),
    );

    expect(
      Buffer.byteLength(
        JSON.stringify(document.diagnosticEvents),
        'utf8',
      ),
    ).toBeLessThanOrEqual(
      supportBundleSizeBudget.diagnosticEventsBytes,
    );
    expect(
      Buffer.byteLength(
        JSON.stringify(document.incidentSummaries),
        'utf8',
      ),
    ).toBeLessThanOrEqual(
      supportBundleSizeBudget.incidentSummariesBytes,
    );
    expect(document.diagnosticEvents.length).toBeLessThan(
      diagnosticEvents.length,
    );
    expect(document.incidentSummaries.length).toBeLessThan(
      incidentSummaries.length,
    );
    expect(document.diagnosticEvents[0]?.id).toBe('backend:event-0');
    expect(document.incidentSummaries[0]?.errorCode).toBe('ERROR_0');
    expect(document.manifest.truncatedSections).toEqual([
      'diagnosticEvents',
      'incidentSummaries',
    ]);
  });

  it('trims diagnostics first when core headroom makes the final document exceed the limit', () => {
    const diagnosticEvents = Array.from({ length: 170 }, (_, index) =>
      createDiagnosticEvent(index, 98_000),
    );
    const incidentSummaries = Array.from({ length: 40 }, (_, index) =>
      createIncidentSummary(index, 95_000),
    );
    const input = createArchiveInput({
      diagnosticEvents,
      incidentSummaries,
    });
    input.backendData.runtimeSummary.nodeVersion = `v${'x'.repeat(
      6 * 1024 * 1024,
    )}`;
    const archive = createSupportBundleArchive(input);
    const document = readArchiveDocument(archive);
    const uncompressed = gunzipSync(archive.compressed);

    expect(uncompressed.byteLength).toBeLessThanOrEqual(
      supportBundleSizeBudget.maximumUncompressedBytes,
    );
    expect(document.diagnosticEvents.length).toBeLessThan(
      diagnosticEvents.length,
    );
    expect(document.incidentSummaries.length).toBe(
      incidentSummaries.length,
    );
    expect(document.operationalSummary.eventCount).toBe(
      document.diagnosticEvents.length,
    );
    expect(document.manifest.sectionChecksums.diagnosticEvents).toBe(
      sha256(document.diagnosticEvents),
    );
    expect(document.manifest.sectionChecksums.operationalSummary).toBe(
      sha256(document.operationalSummary),
    );
  });

  it('trims incident summaries only after diagnostics are exhausted', () => {
    const incidentSummaries = Array.from({ length: 45 }, (_, index) =>
      createIncidentSummary(index, 90_000),
    );
    const input = createArchiveInput({
      diagnosticEvents: [],
      incidentSummaries,
    });
    input.backendData.runtimeSummary.nodeVersion = `v${'x'.repeat(
      23 * 1024 * 1024,
    )}`;
    const archive = createSupportBundleArchive(input);
    const document = readArchiveDocument(archive);

    expect(gunzipSync(archive.compressed).byteLength).toBeLessThanOrEqual(
      supportBundleSizeBudget.maximumUncompressedBytes,
    );
    expect(document.diagnosticEvents).toEqual([]);
    expect(document.incidentSummaries.length).toBeLessThan(
      incidentSummaries.length,
    );
    expect(document.incidentSummaries[0]?.errorCode).toBe('ERROR_0');
    expect(document.manifest.truncatedSections).toContain(
      'incidentSummaries',
    );
    expect(document.manifest.sectionChecksums.incidentSummaries).toBe(
      sha256(document.incidentSummaries),
    );
  });

  it('fails safely if the bundle core alone exceeds the total budget', () => {
    const input = createArchiveInput({
      diagnosticEvents: [],
      incidentSummaries: [],
    });
    input.backendData.runtimeSummary.nodeVersion = `v${'x'.repeat(
      26 * 1024 * 1024,
    )}`;

    expect(() => createSupportBundleArchive(input)).toThrow(
      'SUPPORT_BUNDLE_CORE_TOO_LARGE',
    );
  });
});

interface ArchiveDocument {
  diagnosticEvents: Array<{ id: string }>;
  incidentSummaries: Array<{ errorCode: string }>;
  manifest: {
    sectionChecksums: Record<string, string>;
    truncatedSections: string[];
  };
  operationalSummary: {
    eventCount: number;
  };
}

function createArchiveInput(input: {
  diagnosticEvents: ReturnType<typeof createDiagnosticEvent>[];
  incidentSummaries: ReturnType<typeof createIncidentSummary>[];
}) {
  return {
    appVersion: '0.1.0-alpha.1',
    architecture: 'x64',
    backendData: {
      backendVersion: '0.1.0-alpha.1',
      database: {
        appliedMigrationCount: 35,
        health: 'ok' as const,
        latestMigrationName: '035_example.sql',
      },
      diagnosticEvents: input.diagnosticEvents,
      diagnosticPeriodDays: 30 as const,
      incidentSummaries: input.incidentSummaries,
      incidentSummariesTruncated: false,
      runtimeSummary: createRuntimeSummary(),
      truncated: false,
    },
    createdAt: new Date('2026-07-27T12:30:00.000Z'),
    creationCorrelationId: 'correlation-1',
    platform: 'win32',
  };
}

function createDiagnosticEvent(index: number, payloadLength: number) {
  return {
    category: 'smtp',
    component: 'backend' as const,
    errorCode: 'SMTP_TLS_FAILED',
    eventName: 'smtp.tlsFailed',
    fingerprint: `fingerprint-${index}-${'x'.repeat(payloadLength)}`,
    id: `backend:event-${index}`,
    level: 'error' as const,
    occurredAt: new Date(Date.UTC(2026, 6, 27, 12, 0, index)).toISOString(),
    outcome: 'failure' as const,
  };
}

function createIncidentSummary(index: number, payloadLength: number) {
  return {
    appVersion: '0.1.0-alpha.1',
    buildRevision: 'abcdef123456',
    count: 1,
    errorCode: `ERROR_${index}`,
    eventName: 'smtp.deliveryFailed',
    fingerprint: `fingerprint-${index}-${'x'.repeat(payloadLength)}`,
    firstOccurredAt: new Date(
      Date.UTC(2026, 6, 27, 12, 0, index),
    ).toISOString(),
    lastOccurredAt: new Date(
      Date.UTC(2026, 6, 27, 12, 0, index),
    ).toISOString(),
    outcome: 'failure' as const,
  };
}

function readArchiveDocument(archive: {
  compressed: Buffer;
}): ArchiveDocument {
  return JSON.parse(
    gunzipSync(archive.compressed).toString('utf8'),
  ) as ArchiveDocument;
}

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
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
