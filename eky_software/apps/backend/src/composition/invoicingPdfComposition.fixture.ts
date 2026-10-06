import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { vi } from 'vitest';

import { temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import type { InvoiceRevisionKey } from '../modules/invoicing/domain/invoiceContentRevision.js';
import { createApprovalRevisionFixture, createRevisionDraft } from '../modules/invoicing/infrastructure/invoiceApprovalRevision.fixture.js';
import { LocalInvoiceDocumentStorage } from '../modules/invoicing/infrastructure/localInvoiceDocumentStorage.js';
import { SqliteInvoiceApprovalSnapshotReader } from '../modules/invoicing/infrastructure/sqliteInvoiceApprovalSnapshotReader.js';
import { openPublicationDatabase } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import type { InvoiceDocumentStorage } from '../modules/invoicing/ports/invoiceDocumentStorage.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';
import { createInvoicingComposition, type InvoicingInfrastructureAdapters } from './invoicingComposition.js';
import type { InvoiceEmailSettingsReader } from '../modules/invoicing/ports/invoiceEmailSettingsReader.js';
import type { DeliveredInvoiceArchiveTaskSink } from '../modules/invoicing/ports/deliveredInvoiceArchiveTaskSink.js';

export async function createPdfCompositionFixture(seedDraft = true) {
  const database = openPublicationDatabase();
  const approval = await createApprovalRevisionFixture(database);
  if (seedDraft) await approval.drafts.saveDraft(createRevisionDraft());
  // Control only cross-module master data; approval, revisions, PDF and routes are real.
  vi.spyOn(SqliteInvoiceApprovalSnapshotReader.prototype, 'getSnapshotData').mockReturnValue(approval.snapshot);
  const storage = new LocalInvoiceDocumentStorage(temporaryDirectory());
  const write = vi.fn();
  const noNetwork = vi.fn(async (): Promise<never> => { throw new Error('Unexpected network operation.'); });
  const createApp = (
    adapter: InvoiceDocumentStorage = storage,
    creditPermission = true,
    options: {
      companyId?: string; operationalLogger?: OperationalLogger; deliveryPermission?: boolean;
      infrastructureAdapters?: Omit<InvoicingInfrastructureAdapters, 'invoiceDocumentStorage'>;
      invoiceEmailSettingsReader?: InvoiceEmailSettingsReader;
      deliveredInvoiceArchiveTaskSink?: DeliveredInvoiceArchiveTaskSink;
    } = {},
  ) => {
    const composition = createInvoicingComposition({
      schema: 'revisionHistory',
      database,
      infrastructureAdapters: { ...options.infrastructureAdapters, invoiceDocumentStorage: adapter },
      companyEmailSecretReader: { getSecret: noNetwork },
      customerAccessReader: { belongsToCompany: noNetwork },
      invoiceCustomerTaxProfileReader: { getTaxProfile: noNetwork },
      invoiceEmailSettingsReader: options.invoiceEmailSettingsReader ?? { getEmailSettings: noNetwork },
      deliveredInvoiceArchiveTaskSink: options.deliveredInvoiceArchiveTaskSink ?? { queueDeliveredInvoiceArchiveTask: noNetwork },
      operationalIdentity: {
        appVersion: '0.0.0', buildRevision: '123456789abc',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      },
      operationalLogger: options.operationalLogger ?? { write },
    });
    const app = new Hono<BackendEnvironment>();
    app.use('*', async (context, next) => {
      context.set('actorContext', createActorContext({
        actorId: 'revision-actor', authenticationMode: 'local',
        companyId: options.companyId ?? 'revision-company',
        permissions: [
          ...(creditPermission ? ['manageInvoiceCorrections' as const] : []),
          ...(options.deliveryPermission ? ['sendInvoices' as const] : []),
        ],
      }));
      await next();
    });
    app.route('/', composition.routes);
    return app;
  };
  const approve = (app: Hono<BackendEnvironment>) => app.request('/invoice-drafts/revision-draft/approve', { method: 'POST' });
  const current = (): InvoiceRevisionKey => {
    const row = database.prepare('SELECT company_id, invoice_id, revision_id FROM invoice_current_revisions').get() as {
      company_id: string; invoice_id: string; revision_id: string;
    };
    return { companyId: row.company_id, invoiceId: row.invoice_id, revisionId: row.revision_id };
  };
  return { database, approval, storage, write, noNetwork, createApp, approve, current };
}
