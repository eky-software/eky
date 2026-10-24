import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalEventInput, DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';

// Seed only the existing isolated packaged smoke. These are reader-chain
// fixtures, not evidence that the corresponding business operation ran.
export async function writePackagedDiagnosticFixture(options: {
  identity: DesktopOperationalIdentity;
  logger: DesktopOperationalLogger;
  logsRoot: string;
}): Promise<void> {
  const events: DesktopOperationalEventInput[] = [
    { eventName: 'backup.completed', correlationId: randomUUID(), durationMs: 1, stage: 'portable' },
    { eventName: 'invoicePdfArchive.taskQueued' },
    { eventName: 'invoicePdfArchive.copySucceeded', attemptCount: 1, durationMs: 1 },
    { eventName: 'invoicePdfArchive.configurationChanged', stage: 'enabled' },
    {
      eventName: 'invoicePdfArchive.copyFailed', attemptCount: 1, durationMs: 1,
      errorCode: 'INVOICE_PDF_ARCHIVE_WRITE_FAILED', retryable: true, sideEffectState: 'none',
    },
    { eventName: 'update.accepted', correlationId: randomUUID(), stage: 'firstStartValidation' },
    {
      eventName: 'update.packageInspectionFailed', correlationId: randomUUID(),
      stage: 'packageInspection', durationMs: 1, errorCode: 'UPDATE_PACKAGE_INVALID',
      retryable: false, sideEffectState: 'none',
    },
    {
      eventName: 'update.businessRollbackSucceeded', correlationId: randomUUID(),
      stage: 'businessRollback', durationMs: 1,
    },
    {
      eventName: 'workspaceManagement.operationFailed', correlationId: randomUUID(),
      operationId: 'workspace.replace', stage: 'lineageCheck', durationMs: 1,
      errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', retryable: false, sideEffectState: 'none',
    },
  ];
  for (const event of events) {
    options.logger.write(createDesktopOperationalEvent<DesktopOperationalEventInput>(event, options.identity));
  }
  // Older informational rows force real HTTP and renderer pagination without
  // changing the existing incidents or required newest-page fixtures.
  for (let index = 0; index < 220; index++) {
    options.logger.write(createDesktopOperationalEvent({ eventName: 'desktop.started' }, {
      ...options.identity,
      timestamp: new Date(Date.now() - 60_000 - index * 1_000).toISOString(),
    }));
  }

  // Main does not import backend infrastructure. A fixed backend-source
  // fixture exercises the packaged reader; the system test uses its writer.
  const timestamp = new Date().toISOString();
  const directory = join(options.logsRoot, 'backend');
  await mkdir(directory, { recursive: true });
  await appendFile(join(directory, `backend-warning-error-${timestamp.slice(0, 7)}-001.jsonl`),
    `${JSON.stringify({
      ...options.identity, schemaVersion: 1, eventId: randomUUID(), timestamp,
      component: 'backend', category: 'invoicePdfArchive', level: 'warn', outcome: 'failure',
      eventName: 'invoicePdfArchive.queueFailed', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED',
      stage: 'queue', retryable: true, sideEffectState: 'none',
    })}\n`, { encoding: 'utf8', mode: 0o600 });
}
