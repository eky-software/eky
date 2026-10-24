import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createDiagnosticsApi } from '../../../../packages/api-client/src/diagnostics/diagnosticsClient.js';
import { readDiagnosticsResponse } from '../../../../packages/api-client/src/diagnostics/diagnosticsResponse.js';
import type { DiagnosticEventItem } from '../../../../packages/api-client/src/diagnostics/diagnosticsTypes.js';
import { createBackendOperationalEvent } from '../../../backend/src/observability/createOperationalEvent.js';
import { createBackendOperationalLogger } from '../../../backend/src/observability/infrastructure/createBackendOperationalLogger.js';
import { createDesktopOperationalEvent } from '../../../desktop/src/observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalEvent } from '../../../desktop/src/observability/desktopOperationalEvent.js';
import { IncidentIndexDesktopLogFailureSink } from '../../../desktop/src/observability/infrastructure/incidentIndexDesktopLogFailureSink.js';
import { DesktopIncidentIndexingOperationalLogger } from '../../../desktop/src/observability/infrastructure/jsonLineDesktopIncidentIndex.js';
import { JsonLineDesktopOperationalLogger } from '../../../desktop/src/observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import { createSupportBundleArchive } from '../../../desktop/src/supportBundle/supportBundleArchive.js';
import { readSupportBundleBackendData } from '../../../desktop/src/supportBundle/supportBundleBackendData.js';
import { inspectSupportBundle } from '../../../desktop/scripts/inspect-support-bundle.mjs';
import { expectSafeHttpError } from '../../src/assertions/expectSafeHttpError.js';
import { readDiagnosticPage } from '../../src/assertions/readDiagnosticPage.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';

// Seeded writer-boundary proof, not business/production-composition or UI coverage.
// G1/G3 own the real queue-failure and replacement-lineage producer tests.
test('OBS-DIAGNOSTIC-CHAIN-001 @critical @security carries G events through HTTP and strict readers into a generated archive', async ({ e2eBackend }) => {
  const identity = {
    appVersion: '0.2.81', buildRevision: 'development', runtimeInstanceId: randomUUID(),
  };
  const logger = new DesktopIncidentIndexingOperationalLogger(
    new JsonLineDesktopOperationalLogger({ logsRoot: e2eBackend.paths.logsRoot }),
    e2eBackend.paths.logsRoot,
  );
  const backendIdentity = { ...identity, runtimeInstanceId: randomUUID() };
  const queueFailure = createBackendOperationalEvent({
    eventName: 'invoicePdfArchive.queueFailed', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED',
    stage: 'queue', retryable: true, sideEffectState: 'none',
  } as const, backendIdentity);
  createBackendOperationalLogger(e2eBackend.paths.logsRoot, backendIdentity).write(queueFailure);
  const expectedQueueFailure = {
    ...backendIdentity, category: 'invoicePdfArchive', component: 'backend',
    eventName: 'invoicePdfArchive.queueFailed', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED',
    id: `backend:${queueFailure.eventId}`, occurredAt: queueFailure.timestamp,
    level: 'warn', outcome: 'failure', stage: 'queue', retryable: true, sideEffectState: 'none',
  } satisfies DiagnosticEventItem;
  const updateCorrelationId = randomUUID();
  const workspaceCorrelationId = randomUUID();
  const archiveFailure = createDesktopOperationalEvent({
    eventName: 'invoicePdfArchive.copyFailed', errorCode: 'ARCHIVE_STORAGE_FAILED',
    attemptCount: 2, durationMs: 7, retryable: true, sideEffectState: 'none',
    stage: 'copy', fingerprint: 'synthetic-archive-fingerprint',
  } as const, identity);
  const updateFailure = createDesktopOperationalEvent({
    eventName: 'update.runtimeShutdownFailed', correlationId: updateCorrelationId,
    stage: 'runtimeShutdown', durationMs: 11, errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED',
    retryable: false, sideEffectState: 'unknown',
  } as const, identity);
  const rollbackSuccess = createDesktopOperationalEvent({
    eventName: 'update.businessRollbackSucceeded', correlationId: updateCorrelationId,
    stage: 'businessRollback', durationMs: 13,
  } as const, identity);
  const lineageFailure = createDesktopOperationalEvent({
    eventName: 'workspaceManagement.operationFailed', correlationId: workspaceCorrelationId,
    operationId: 'workspace.replace', stage: 'lineageCheck', durationMs: 3,
    errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', retryable: false, sideEffectState: 'none',
  } as const, identity);
  const taskQueued = createDesktopOperationalEvent({ eventName: 'invoicePdfArchive.taskQueued' } as const, identity);
  const copySuccess = createDesktopOperationalEvent({
    eventName: 'invoicePdfArchive.copySucceeded', attemptCount: 1, durationMs: 5,
  } as const, identity);
  const configurationChanged = createDesktopOperationalEvent({
    eventName: 'invoicePdfArchive.configurationChanged', stage: 'enabled',
  } as const, identity);
  const updateSuccess = createDesktopOperationalEvent({
    eventName: 'update.packageInspectionSucceeded', correlationId: randomUUID(),
    stage: 'packageInspection', durationMs: 2,
  } as const, identity);
  const legacyFailure = createDesktopOperationalEvent({
    eventName: 'desktop.shutdownFailed', errorCode: 'DESKTOP_SHUTDOWN_FAILED',
    stage: 'shutdown', retryable: false, sideEffectState: 'unknown',
  } as const, identity);
  const written = [archiveFailure, updateFailure, rollbackSuccess, lineageFailure,
    taskQueued, copySuccess, configurationChanged, updateSuccess, legacyFailure];
  for (const event of written) logger.write(event);

  const desktopRoot = join(e2eBackend.paths.logsRoot, 'desktop');
  const heldDesktopRoot = join(e2eBackend.paths.logsRoot, 'h5-preserved-desktop');
  await rename(desktopRoot, heldDesktopRoot);
  await writeFile(desktopRoot, 'synthetic H5 writer obstruction', { flag: 'wx' });
  const failureSink = new IncidentIndexDesktopLogFailureSink({
    logsRoot: e2eBackend.paths.logsRoot, operationalIdentity: identity,
  });
  const blockedLogger = new JsonLineDesktopOperationalLogger({
    logsRoot: e2eBackend.paths.logsRoot, failureSink,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    blockedLogger.write(createDesktopOperationalEvent({ eventName: 'desktop.started' }, identity));
  }
  expect(failureSink.failureObserved).toBe(true);
  await unlink(desktopRoot);
  await rename(heldDesktopRoot, desktopRoot);

  const expectedSupportEvents = [
    projection(archiveFailure, { durationMs: 7, retryable: true, sideEffectState: 'none' }),
    projection(updateFailure, { correlationId: updateCorrelationId, stage: 'runtimeShutdown',
      durationMs: 11, retryable: false, sideEffectState: 'unknown' }),
    projection(rollbackSuccess, { correlationId: updateCorrelationId, stage: 'businessRollback', durationMs: 13 }),
    projection(lineageFailure, { correlationId: workspaceCorrelationId, operationId: 'workspace.replace',
      stage: 'lineageCheck', durationMs: 3, retryable: false, sideEffectState: 'none' }),
    projection(legacyFailure, { stage: 'shutdown', retryable: false, sideEffectState: 'unknown' }),
    expectedQueueFailure,
  ];
  const expectedInfoEvents = [
    projection(taskQueued), projection(copySuccess, { durationMs: 5 }),
    projection(configurationChanged, { stage: 'enabled' }),
    projection(updateSuccess, { correlationId: updateSuccess.correlationId, stage: 'packageInspection', durationMs: 2 }),
  ];
  const names = new Set<string>([...written, queueFailure].map(event => event.eventName));
  const api = createDiagnosticsApi(async input => {
    const url = new URL(String(input));
    expect(url.origin).toBe(e2eBackend.backend.backendOrigin);
    const response = await e2eBackend.api.get(`${url.pathname}${url.search}`);
    return new Response(await response.text(), {
      status: response.status(), headers: { 'content-type': 'application/json' },
    });
  }, e2eBackend.backend.backendOrigin);
  const page = await readDiagnosticPage(e2eBackend.api, { limit: 200 });
  const { diagnosticEvents: events, readState } = page;
  expect(readState).toEqual({ status: 'complete', reasons: [] });
  expect((await api.getDiagnosticSummary()).operationalLogReadState)
    .toEqual({ status: 'complete', reasons: [] });
  const selectedEvents = events.filter(event => names.has(event.eventName));
  expect(selectedEvents).toHaveLength(written.length + 1);
  expect(selectedEvents).toEqual(expect.arrayContaining([...expectedSupportEvents, ...expectedInfoEvents]));
  expect(selectedEvents.find(event => event.eventName === archiveFailure.eventName)).toMatchObject({
    category: 'invoicePdfArchive', level: 'warn', outcome: 'failure', errorCode: 'ARCHIVE_STORAGE_FAILED',
  });
  expect(selectedEvents.find(event => event.eventName === updateFailure.eventName)).toMatchObject({
    category: 'update', level: 'error', outcome: 'failure', errorCode: 'UPDATE_RUNTIME_SHUTDOWN_FAILED',
  });
  expect(selectedEvents.find(event => event.eventName === lineageFailure.eventName)).toMatchObject({
    category: 'workspaceManagement', level: 'error', outcome: 'failure',
    errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH',
  });
  expect(selectedEvents.find(event => event.eventName === rollbackSuccess.eventName)).toMatchObject({
    level: 'warn', outcome: 'success', errorCode: null,
  });

  const response = await e2eBackend.api.get('/diagnostics/support-bundle-data');
  expect(response.status()).toBe(200);
  const support = readSupportBundleBackendData(await response.json());
  const supportEvents = support.diagnosticEvents.filter(event => names.has(event.eventName));
  expect(supportEvents).toHaveLength(expectedSupportEvents.length);
  expect(supportEvents).toEqual(expect.arrayContaining(expectedSupportEvents));
  expect(support.truncated).toBe(false);
  expect(support.incidentSummariesTruncated).toBe(false);
  const incidents = support.incidentSummaries.filter(event => names.has(event.eventName));
  expect(incidents).toHaveLength(3);
  expect(incidents).not.toContainEqual(expect.objectContaining({ eventName: queueFailure.eventName }));
  const logFailures = support.incidentSummaries.filter(event => event.eventName === 'operationalLog.writeFailed');
  expect(logFailures).toHaveLength(1);
  expect(logFailures[0]).toMatchObject({
    appVersion: identity.appVersion, buildRevision: identity.buildRevision,
    count: 1, errorCode: 'LOG_WRITE_FAILED', fingerprint: 'LOG_WRITE_FAILED:desktop-info',
    outcome: 'failure',
  });
  expect(logFailures[0]?.firstOccurredAt).toBe(logFailures[0]?.lastOccurredAt);
  expect(events.some(event => event.eventName === 'operationalLog.writeFailed')).toBe(false);
  for (const event of [updateFailure, lineageFailure, legacyFailure]) {
    expect(incidents).toContainEqual({
      appVersion: identity.appVersion, buildRevision: identity.buildRevision, count: 1,
      errorCode: event.errorCode, eventName: event.eventName,
      fingerprint: `${event.eventName}:${event.errorCode}`, outcome: 'failure',
      firstOccurredAt: event.timestamp, lastOccurredAt: event.timestamp,
    });
  }

  const archive = createSupportBundleArchive({
    appVersion: identity.appVersion, architecture: 'x64', platform: 'win32', backendData: support,
  });
  const document = JSON.parse(gunzipSync(archive.compressed).toString('utf8')) as {
    diagnosticEvents: unknown[];
    incidentSummaries: unknown[];
    runtimeSummary: Record<string, unknown>;
    manifest: {
      supportBundleFormatVersion: number;
      truncatedSections: string[];
      sectionChecksums: { diagnosticEvents: string; incidentSummaries: string; runtimeSummary: string };
    };
  };
  expect(archive.fileName).toMatch(/\.json\.gz$/);
  expect(document.manifest.supportBundleFormatVersion).toBe(2);
  expect(document.manifest.truncatedSections).toEqual([]);
  expect(document.diagnosticEvents).toEqual(support.diagnosticEvents);
  expect(document.diagnosticEvents).toContainEqual(expectedQueueFailure);
  expect(document.incidentSummaries).toEqual(support.incidentSummaries);
  expect(document.runtimeSummary).not.toHaveProperty('operationalLogReadState');
  expect(support.runtimeSummary).not.toHaveProperty('operationalLogReadState');
  for (const section of ['diagnosticEvents', 'incidentSummaries', 'runtimeSummary'] as const) {
    expect(document.manifest.sectionChecksums[section]).toBe(
      createHash('sha256').update(JSON.stringify(document[section]), 'utf8').digest('hex'),
    );
  }
  for (const name of [archive.fileName, 'synthetic-legacy.ekysupport']) {
    const path = join(e2eBackend.paths.supportBundlesRoot, name);
    await writeFile(path, archive.compressed, { flag: 'wx', mode: 0o600 });
    expect(inspectSupportBundle(path).summary.formatVersion).toBe(2);
  }
  for (const event of expectedInfoEvents) {
    expect(event).toMatchObject({ level: 'info', outcome: 'success', errorCode: null });
    expect(document.diagnosticEvents).not.toContainEqual(expect.objectContaining({ eventName: event.eventName }));
    expect(document.incidentSummaries).not.toContainEqual(expect.objectContaining({ eventName: event.eventName }));
    expect(() => readSupportBundleBackendData({ ...support, diagnosticEvents: [event] }))
      .toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  }

  // Mutate real projected rows only at the receiving boundaries, not the HTTP server.
  for (const event of supportEvents.filter(event => event.eventName !== legacyFailure.eventName)) {
    for (const change of [{ recoveryPointKind: 'preUpdate' }, { durationMs: 'invalid' }]) {
      const invalid = { ...event, ...change };
      expect(() => readDiagnosticsResponse({ ...page, diagnosticEvents: [invalid] })).toThrow();
      expect(() => readSupportBundleBackendData({ ...support, diagnosticEvents: [invalid] }))
        .toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
    }
  }
  expect(() => readDiagnosticsResponse({
    ...page,
    diagnosticEvents: [{ ...expectedSupportEvents[0], eventName: 'invoicePdfArchive.unknown' }],
  })).toThrow();

  const published = JSON.stringify({ events, document });
  for (const forbidden of [e2eBackend.runRoot, e2eBackend.backend.sessionSecret,
    'synthetic-archive-fingerprint']) {
    const encoded = JSON.stringify(forbidden).slice(1, -1);
    // Boolean assertions keep private paths/session values out of failure messages.
    expect(published.includes(encoded)).toBe(false);
  }
  for (const key of ['companyId', 'actorUserId', 'entityId', 'invoiceId', 'documentId',
    'deliveryEventId', 'workspaceId', 'profileId', 'label', 'attemptCount', 'currentVersion',
    'targetVersion', 'releaseChannel', 'path', 'targetPath', 'pdfHash', 'pdfBytes', 'journal',
    'payload', 'metadata', 'rawError', 'message', 'stack', 'secret', 'password', 'token',
    'authorization', 'cookie', 'smtpProfile', 'recoveryPointKind']) {
    expect(published.includes(`"${key}":`)).toBe(false);
  }
  expect(published.includes('%PDF-')).toBe(false);
  for (const key of ['runtimeInstanceId', 'correlationId', 'operationId', 'stage', 'durationMs']) {
    expect(JSON.stringify(document.incidentSummaries).includes(`"${key}":`)).toBe(false);
  }

  // This fixture has no restricted-permission actor: prove missing-session denial only.
  for (const route of ['/diagnostics/events', '/diagnostics/support-bundle-data']) {
    await expectSafeHttpError(await e2eBackend.anonymousApi.get(route), [401], [
      e2eBackend.backend.sessionSecret,
    ]);
  }
  expect((await readDiagnosticPage(e2eBackend.api, { limit: 200 })).diagnosticEvents)
    .toEqual(expect.arrayContaining(expectedSupportEvents));
  expect((await e2eBackend.api.get('/health')).status()).toBe(200);
});

function projection(event: DesktopOperationalEvent, payload: Partial<DiagnosticEventItem> = {}) {
  return {
    appVersion: event.appVersion, buildRevision: event.buildRevision,
    runtimeInstanceId: event.runtimeInstanceId, category: event.category, component: event.component,
    eventName: event.eventName, id: `desktop:${event.eventId}`, occurredAt: event.timestamp,
    level: event.level, outcome: event.outcome, errorCode: 'errorCode' in event ? event.errorCode : null,
    ...payload,
  };
}
