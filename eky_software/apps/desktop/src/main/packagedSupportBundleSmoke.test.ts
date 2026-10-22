import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { createSupportBundleArchive } from '../supportBundle/supportBundleArchive.js';
import type { SupportBundleDiagnosticEvent, SupportBundleIncidentSummary } from '../supportBundle/supportBundleBackendData.js';
import { runPackagedSupportBundleSmoke, validateSupportBundleDocument } from './packagedSupportBundleSmoke.js';

it('offers the original smoke failure before its public conversion even if the observer fails', async context => {
  const root = await mkdtemp(join(tmpdir(), 'eky-g-support-failure-'));
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { force: true, recursive: true });
  });
  const original = new Error('synthetic G4 original failure', { cause: new Error('synthetic G4 cause') });
  const observeFailure = vi.fn(() => { throw new Error('synthetic observer failure'); });
  const mainWindow = { webContents: { executeJavaScript: async () => { throw original; } } } as unknown as BrowserWindow;
  await expect(runPackagedSupportBundleSmoke({
    ...expectedIdentity, mainWindow, observeFailure, supportBundlePath: join(root, 'support.json.gz'),
  })).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  expect(observeFailure).toHaveBeenCalledExactlyOnceWith(original);
});

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

  it('rejects an archive without the current smoke diagnostic event', () => {
    const document = createDocument(undefined, []);

    expect(() =>
      validateSupportBundleDocument(document, expectedIdentity),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it('rejects a complete smoke source marked as diagnostic truncated', () => {
    const document = createDocument();
    (
      document.manifest as Record<string, unknown>
    ).truncatedSections = ['diagnosticEvents'];

    expect(() =>
      validateSupportBundleDocument(document, expectedIdentity),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it.each([
    'invoicePdfArchive.queueFailed', 'invoicePdfArchive.copyFailed',
    'update.packageInspectionFailed', 'update.businessRollbackSucceeded',
    'workspaceManagement.operationFailed',
  ])('requires the G representative %s even with valid old sentinels', name => {
    const document = createDocument();
    document.diagnosticEvents = (document.diagnosticEvents as SupportBundleDiagnosticEvent[])
      .filter(event => event.eventName !== name);
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_G_EVIDENCE_FAILED');
  });

  it.each([
    ['invoicePdfArchive.queueFailed', { retryable: false }],
    ['invoicePdfArchive.copyFailed', { attemptCount: 1 }],
    ['invoicePdfArchive.copyFailed', { path: 'private-path' }],
    ['update.packageInspectionFailed', { stage: 'businessRollback' }],
    ['update.packageInspectionFailed', { targetVersion: '0.3.0' }],
    ['update.businessRollbackSucceeded', { outcome: 'failure' }],
    ['workspaceManagement.operationFailed', { operationId: 'workspace.create' }],
    ['workspaceManagement.operationFailed', { durationMs: '1' }],
    ['workspaceManagement.operationFailed', { companyId: 'private-company' }],
  ] as const)('rejects a checksum-correct invalid G event %s (%j)', (name, change) => {
    const document = createDocument();
    const events = document.diagnosticEvents as SupportBundleDiagnosticEvent[];
    // Keep all valid representatives: even an additional invalid G row must fail.
    events.push({ ...events.find(event => event.eventName === name)!, ...change } as SupportBundleDiagnosticEvent);
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity))
      .toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });

  it.each([
    { count: 0 }, { runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    { eventName: 'workspaceManagement.unknown' }, { fingerprint: 'invented' },
    { errorCode: 'UNKNOWN_CODE' }, { outcome: 'unknown' },
  ])('rejects a checksum-correct invalid extra G incident (%j)', change => {
    const document = createDocument();
    const incidents = document.incidentSummaries as SupportBundleIncidentSummary[];
    incidents.push({ ...incidents.find(item => item.eventName === 'workspaceManagement.operationFailed')!, ...change } as SupportBundleIncidentSummary);
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity)).toThrow();
  });

  it('requires a G incident as well as the old minimized incident', () => {
    const document = createDocument();
    document.incidentSummaries = (document.incidentSummaries as SupportBundleIncidentSummary[])
      .filter(item => item.eventName === 'applicationWindow.newWindowBlocked');
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_G_EVIDENCE_FAILED');
  });

  it('rejects info in the support artifact even when all required events remain', () => {
    const document = createDocument();
    (document.diagnosticEvents as SupportBundleDiagnosticEvent[]).push({
      id: 'accepted', appVersion: expectedIdentity.appVersion,
      buildRevision: expectedIdentity.buildRevision, occurredAt: '2026-07-27T12:00:00.000Z',
      eventName: 'update.accepted', category: 'update', component: 'desktop',
      level: 'info', outcome: 'success', stage: 'firstStartValidation', errorCode: null,
      correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity))
      .toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });
});

const expectedIdentity = {
  appVersion: '0.1.0-alpha.1',
  buildRevision: 'abcdef123456',
  runtimeSessionSecret: 'private-runtime-session',
};

function createDocument(
  incidentSummaries: SupportBundleIncidentSummary[] = [
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
    ...gEvents().filter(event => event.level === 'error').map(event => ({
      appVersion: expectedIdentity.appVersion, buildRevision: expectedIdentity.buildRevision,
      count: 1, errorCode: event.errorCode!, eventName: event.eventName,
      fingerprint: `${event.eventName}:${event.errorCode}`,
      firstOccurredAt: event.occurredAt, lastOccurredAt: event.occurredAt, outcome: 'failure' as const,
    })),
  ],
  diagnosticEvents: SupportBundleDiagnosticEvent[] = [
    {
      appVersion: expectedIdentity.appVersion,
      buildRevision: expectedIdentity.buildRevision,
      category: 'security',
      component: 'desktop' as const,
      errorCode: null,
      eventName: 'applicationWindow.newWindowBlocked',
      id: 'desktop-smoke-security-event',
      level: 'warn' as const,
      occurredAt: '2026-07-27T12:00:00.000Z',
      outcome: 'blocked' as const,
      stage: 'window-open',
    },
    ...gEvents(),
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
      diagnosticEvents,
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

function gEvents(): SupportBundleDiagnosticEvent[] {
  const common = {
    appVersion: expectedIdentity.appVersion, buildRevision: expectedIdentity.buildRevision,
    occurredAt: '2026-07-27T12:00:00.000Z', outcome: 'failure' as const,
  };
  return [
    { ...common, id: 'queue', eventName: 'invoicePdfArchive.queueFailed', category: 'invoicePdfArchive',
      component: 'backend', level: 'warn', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED',
      stage: 'queue', retryable: true, sideEffectState: 'none' },
    { ...common, id: 'copy', eventName: 'invoicePdfArchive.copyFailed', category: 'invoicePdfArchive',
      component: 'desktop', level: 'warn', errorCode: 'INVOICE_PDF_ARCHIVE_WRITE_FAILED',
      durationMs: 1, retryable: true, sideEffectState: 'none' },
    { ...common, id: 'update', eventName: 'update.packageInspectionFailed', category: 'update',
      component: 'desktop', level: 'error', errorCode: 'UPDATE_PACKAGE_INVALID',
      correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', stage: 'packageInspection',
      durationMs: 1, retryable: false, sideEffectState: 'none' },
    { ...common, id: 'rollback', eventName: 'update.businessRollbackSucceeded', category: 'update',
      component: 'desktop', level: 'warn', outcome: 'success', errorCode: null,
      correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', stage: 'businessRollback', durationMs: 1 },
    { ...common, id: 'lineage', eventName: 'workspaceManagement.operationFailed', category: 'workspaceManagement',
      component: 'desktop', level: 'error', errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH',
      correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', operationId: 'workspace.replace',
      stage: 'lineageCheck', durationMs: 1, retryable: false, sideEffectState: 'none' },
  ];
}

function refreshChecksums(document: Record<string, unknown>): void {
  const manifest = document.manifest as Record<string, unknown>;
  const sums = manifest.sectionChecksums as Record<string, string>;
  for (const name of Object.keys(sums)) {
    sums[name] = createHash('sha256').update(JSON.stringify(document[name])).digest('hex');
  }
}
