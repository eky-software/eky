import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { createDesktopOperationalEvent } from '../../../desktop/src/observability/createDesktopOperationalEvent.js';
import { DesktopIncidentIndexingOperationalLogger } from '../../../desktop/src/observability/infrastructure/jsonLineDesktopIncidentIndex.js';
import { JsonLineDesktopOperationalLogger } from '../../../desktop/src/observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import { createSupportBundleArchive } from '../../../desktop/src/supportBundle/supportBundleArchive.js';
import { readSupportBundleBackendData } from '../../../desktop/src/supportBundle/supportBundleBackendData.js';
import { readDiagnosticPage } from '../../src/assertions/readDiagnosticPage.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';

// The desktop composition test proves the real drain observer emits this event.
// This test starts at its writer boundary and exercises the actual reader chain.
test('OBS-SECRET-DRAIN-001 @critical @security @recovery retains the first drain cause through readers and restart', async ({ e2eBackend }) => {
  const identity = {
    appVersion: '0.2.81', buildRevision: 'development', runtimeInstanceId: randomUUID(),
  };
  const logger = new DesktopIncidentIndexingOperationalLogger(
    new JsonLineDesktopOperationalLogger({ logsRoot: e2eBackend.paths.logsRoot }),
    e2eBackend.paths.logsRoot,
  );
  const causes = [
    'SECRET_BROKER_TRANSPORT_FAILED', 'SECRET_BROKER_DRAIN_TIMEOUT', 'SECRET_WRITE_FAILED',
  ] as const;
  const written = causes.map(errorCode => createDesktopOperationalEvent({
    eventName: 'desktop.shutdownFailed', errorCode, stage: 'secretBrokerDrain',
    retryable: false, sideEffectState: 'unknown',
  } as const, identity));
  const aggregate = createDesktopOperationalEvent({
    eventName: 'desktop.shutdownFailed', errorCode: 'DESKTOP_SHUTDOWN_FAILED',
    stage: 'shutdown', retryable: false, sideEffectState: 'unknown',
  } as const, identity);
  for (const event of [...written, aggregate]) logger.write(event);
  const expectedEvents = [...written, aggregate].map(event => ({
    appVersion: identity.appVersion, buildRevision: identity.buildRevision,
    runtimeInstanceId: identity.runtimeInstanceId, category: 'runtime',
    component: 'desktop', errorCode: event.errorCode, eventName: event.eventName,
    id: `desktop:${event.eventId}`, level: 'error', occurredAt: event.timestamp, outcome: 'failure',
    retryable: false, sideEffectState: 'unknown', stage: event.stage,
  }));

  async function readAndVerify() {
    const { diagnosticEvents: events } = await readDiagnosticPage(e2eBackend.api, { limit: 200 });
    expect(events.filter(event => event.eventName === 'desktop.shutdownFailed'))
      .toEqual(expect.arrayContaining(expectedEvents));
    expect(events.filter(event => event.eventName === 'desktop.shutdownFailed')).toHaveLength(4);

    const response = await e2eBackend.api.get('/diagnostics/support-bundle-data');
    expect(response.status()).toBe(200);
    const support = readSupportBundleBackendData(await response.json());
    expect(support.diagnosticEvents.filter(event => event.eventName === 'desktop.shutdownFailed'))
      .toEqual(expect.arrayContaining(expectedEvents));
    expect(support.diagnosticEvents.filter(event => event.eventName === 'desktop.shutdownFailed')).toHaveLength(4);
    expect(support.truncated).toBe(false);
    const incidents = support.incidentSummaries.filter(event => event.eventName === 'desktop.shutdownFailed');
    expect(incidents).toHaveLength(4);
    for (const event of [...written, aggregate]) {
      expect(incidents).toContainEqual({
        appVersion: identity.appVersion, buildRevision: identity.buildRevision,
        count: 1, errorCode: event.errorCode, eventName: event.eventName,
        fingerprint: `${event.eventName}:${event.errorCode}`,
        firstOccurredAt: event.timestamp, lastOccurredAt: event.timestamp, outcome: 'failure',
      });
    }

    const archive = createSupportBundleArchive({
      appVersion: identity.appVersion, architecture: 'x64', platform: 'win32', backendData: support,
    });
    const document = JSON.parse(gunzipSync(archive.compressed).toString('utf8')) as {
      diagnosticEvents: unknown[];
      incidentSummaries: unknown[];
      manifest: { sectionChecksums: { diagnosticEvents: string; incidentSummaries: string } };
    };
    expect(document.diagnosticEvents).toEqual(support.diagnosticEvents);
    expect(document.incidentSummaries).toEqual(support.incidentSummaries);
    for (const section of ['diagnosticEvents', 'incidentSummaries'] as const) {
      expect(document.manifest.sectionChecksums[section]).toBe(
        createHash('sha256').update(JSON.stringify(document[section]), 'utf8').digest('hex'),
      );
    }
    const published = JSON.stringify({ events, document });
    for (const forbidden of [e2eBackend.runRoot, e2eBackend.backend.sessionSecret]) {
      const encoded = JSON.stringify(forbidden).slice(1, -1);
      expect(JSON.stringify({ value: forbidden })).toContain(encoded);
      expect(published).not.toContain(encoded);
    }
    for (const forbidden of ['"companyId":', '"secret":', '"stack":', '"payload":']) {
      expect(published).not.toContain(forbidden);
    }
    expect(JSON.stringify(incidents)).not.toContain(identity.runtimeInstanceId);
    expect((await e2eBackend.api.get('/health')).status()).toBe(200);
  }

  await readAndVerify();
  await e2eBackend.restartBackend();
  await readAndVerify();
});
