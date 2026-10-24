import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { closePublicationDatabases, publicationState } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { createDiagnosticsComposition } from './diagnosticsComposition.js';
import { readDiagnosticHttpPageForTest } from '../modules/diagnostics/diagnosticHttpRead.fixture.js';
import { createPdfCompositionFixture } from './invoicingPdfComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

it.each([false, true])('preserves delivery and its queue failure read chain when loggerFails=%s', async loggerFails => {
  const f = await createPdfCompositionFixture();
  const logsRoot = temporaryDirectory();
  const logger = createBackendOperationalLogger(logsRoot);
  const app = f.createApp(f.storage, true, {
    deliveryPermission: true,
    operationalLogger: loggerFails ? { write() { throw new Error('SYNTHETIC_WRITER_FAILURE'); } } : logger,
    deliveredInvoiceArchiveTaskSink: {
      async queueDeliveredInvoiceArchiveTask() { throw new Error('SYNTHETIC_QUEUE_PRIVATE_CAUSE'); },
    },
  });
  expect((await f.approve(app)).status).toBe(200);
  const key = f.current();
  const response = await app.request(`/invoices/${key.invoiceId}/mark-sent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveryMethod: 'manual' }),
  });
  expect(response.status).toBe(200);
  expect(publicationState(f.database).events).toEqual([expect.objectContaining({ status: 'succeeded' })]);
  expect(f.database.prepare('SELECT status FROM invoices').get()).toEqual({ status: 'sent' });

  let permissions = true;
  const diagnosticsApp = new Hono<BackendEnvironment>();
  diagnosticsApp.use('*', async (context, next) => {
    context.set('actorContext', createActorContext({
      actorId: 'synthetic-diagnostics-actor', authenticationMode: 'local', companyId: key.companyId,
      permissions: permissions ? ['viewDiagnostics', 'createSupportBundle'] : [],
    }));
    await next();
  });
  diagnosticsApp.route('/', createDiagnosticsComposition({
    buildCreatedAt: '2026-10-22T10:00:00.000Z', buildDirty: false,
    database: f.database, electronVersion: null, operationalLogsRoot: logsRoot,
    operationalIdentity: { appVersion: '0.2.81', buildRevision: 'development',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
    runtimeArchitecture: 'x64', runtimeNodeVersion: '24.0.0', runtimePlatform: 'win32',
  }));
  for (const route of ['/diagnostics/events', '/diagnostics/support-bundle-data']) {
    const body = route === '/diagnostics/events' ? await readDiagnosticHttpPageForTest(diagnosticsApp)
      : await (async () => {
        const result = await diagnosticsApp.request(route);
        expect(result.status).toBe(200);
        return result.json();
      })();
    const archive = body.diagnosticEvents.filter((event: { eventName: string }) =>
      event.eventName === 'invoicePdfArchive.queueFailed');
    expect(archive).toEqual(loggerFails ? [] : [expect.objectContaining({
      category: 'invoicePdfArchive', component: 'backend',
      errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED', level: 'warn', outcome: 'failure',
      retryable: true, sideEffectState: 'none', stage: 'queue',
    })]);
    for (const forbidden of ['SYNTHETIC_QUEUE', 'SYNTHETIC_WRITER', logsRoot, key.invoiceId, key.companyId]) {
      expect(JSON.stringify(body)).not.toContain(forbidden);
    }
  }
  permissions = false;
  for (const route of ['/diagnostics/events', '/diagnostics/support-bundle-data']) {
    expect((await diagnosticsApp.request(route)).status).toBe(403);
  }
  expect(f.noNetwork).not.toHaveBeenCalled();
});
