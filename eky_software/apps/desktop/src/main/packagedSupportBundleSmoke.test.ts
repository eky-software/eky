import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { createSupportBundleArchive } from '../supportBundle/supportBundleArchive.js';
import { validateSupportBundleDocument } from './packagedSupportBundleSmoke.js';

describe('validateSupportBundleDocument', () => {
  it('accepts a version 2 archive with matching identity and checksums', () => {
    const document = createDocument();

    expect(() =>
      validateSupportBundleDocument(document, expectedIdentity),
    ).not.toThrow();
  });

  it('rejects checksum changes and forbidden personal metadata', () => {
    const document = createDocument();

    expect(() =>
      validateSupportBundleDocument(
        {
          ...document,
          database: {
            ...(document.database as Record<string, unknown>),
            appliedMigrationCount: 999,
          },
        },
        expectedIdentity,
      ),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_CHECKSUM_FAILED');

    expect(() =>
      validateSupportBundleDocument(
        {
          ...document,
          companyId: 'must-not-exist',
        },
        expectedIdentity,
      ),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it('rejects an archive without the smoke security incident', () => {
    const document = createDocument([]);

    expect(() =>
      validateSupportBundleDocument(document, expectedIdentity),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });
});

const expectedIdentity = {
  appVersion: '0.1.0-alpha.1',
  buildRevision: 'abcdef123456',
  runtimeSessionSecret: 'private-runtime-session',
};

function createDocument(
  incidentSummaries = [
    {
      appVersion: expectedIdentity.appVersion,
      buildRevision: expectedIdentity.buildRevision,
      count: 1,
      errorCode: 'DESKTOP_SECURITY_EVENT_BLOCKED',
      eventName: 'applicationWindow.newWindowBlocked',
      fingerprint:
        'applicationWindow.newWindowBlocked:DESKTOP_SECURITY_EVENT_BLOCKED',
      firstOccurredAt: '2026-07-27T12:00:00.000Z',
      lastOccurredAt: '2026-07-27T12:00:00.000Z',
      outcome: 'blocked' as const,
    },
  ],
): Record<string, unknown> {
  const archive = createSupportBundleArchive({
    appVersion: expectedIdentity.appVersion,
    architecture: 'x64',
    backendData: {
      backendVersion: expectedIdentity.appVersion,
      database: {
        appliedMigrationCount: 35,
        health: 'ok',
        latestMigrationName: '035_example.sql',
      },
      diagnosticEvents: [],
      diagnosticPeriodDays: 30,
      incidentSummaries,
      incidentSummariesTruncated: false,
      runtimeSummary: {
        appVersion: expectedIdentity.appVersion,
        appliedMigrationCount: 35,
        architecture: 'x64',
        buildCreatedAt: '2026-07-27T10:00:00.000Z',
        buildDirty: false,
        buildRevision: expectedIdentity.buildRevision,
        databaseHealth: 'ok',
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
        runtimeInstanceId:
          'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      },
      truncated: false,
    },
    createdAt: new Date('2026-07-27T12:30:00.000Z'),
    creationCorrelationId: 'correlation-1',
    platform: 'win32',
  });

  return JSON.parse(
    gunzipSync(archive.compressed).toString('utf8'),
  ) as Record<string, unknown>;
}
