import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { DesktopIncidentIndexingOperationalLogger } from '../observability/infrastructure/jsonLineDesktopIncidentIndex.js';
import { JsonLineDesktopOperationalLogger } from '../observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import { validateDesktopOperationalEvent } from '../observability/desktopOperationalEventValidator.js';
import { writePackagedDiagnosticFixture } from './packagedDiagnosticFixture.js';

it('writes the packaged G source fixtures and minimized incidents using the existing desktop writer', async context => {
  const root = await mkdtemp(join(tmpdir(), 'eky-g-diagnostic-fixture-'));
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const identity = {
    appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
    runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };
  await writePackagedDiagnosticFixture({
    identity, logsRoot: root,
    logger: new DesktopIncidentIndexingOperationalLogger(
      new JsonLineDesktopOperationalLogger({ logsRoot: root }), root,
    ),
  });
  const rows = async (directory: string): Promise<Record<string, unknown>[]> => {
    const result: Record<string, unknown>[] = [];
    for (const name of await readdir(join(root, directory))) {
      result.push(...(await readFile(join(root, directory, name), 'utf8')).trim().split('\n')
        .map(line => JSON.parse(line) as Record<string, unknown>));
    }
    return result;
  };
  const desktop = await rows('desktop');
  expect(desktop).toHaveLength(9);
  desktop.forEach(row => expect(() => validateDesktopOperationalEvent(row)).not.toThrow());
  expect(desktop.filter(row => row.level === 'info')).toHaveLength(5);
  expect(desktop.find(row => row.eventName === 'update.businessRollbackSucceeded'))
    .toMatchObject({ level: 'warn', outcome: 'success' });
  expect(await rows('backend')).toEqual([{
    ...identity, schemaVersion: 1, eventId: expect.any(String), timestamp: expect.any(String),
    component: 'backend', category: 'invoicePdfArchive', level: 'warn', outcome: 'failure',
    eventName: 'invoicePdfArchive.queueFailed', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED',
    stage: 'queue', retryable: true, sideEffectState: 'none',
  }]);
  const incidents = await rows('incident-index');
  expect(incidents).toHaveLength(2);
  expect(incidents.map(row => row.eventName).sort()).toEqual([
    'update.packageInspectionFailed', 'workspaceManagement.operationFailed',
  ]);
  for (const incident of incidents) {
    expect(incident).not.toHaveProperty('runtimeInstanceId');
    expect(incident).not.toHaveProperty('correlationId');
    expect(incident).not.toHaveProperty('operationId');
  }
});
