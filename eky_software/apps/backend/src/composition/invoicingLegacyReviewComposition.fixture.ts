import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { vi } from 'vitest';

import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { createLegacyPdfReadFixture } from '../modules/invoicing/infrastructure/invoicePdfRead.fixture.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';
import type { InvoiceEmailDeliveryProvider } from '../modules/invoicing/ports/invoiceEmailDeliveryProvider.js';
import type { InvoiceSmtpDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpDeliveryProvider.js';
import type { InvoiceSmtpTestDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpTestDeliveryProvider.js';
import type { InvoiceEmailSettingsReader } from '../modules/invoicing/ports/invoiceEmailSettingsReader.js';
import type { DeliveredInvoiceArchiveTaskSink } from '../modules/invoicing/ports/deliveredInvoiceArchiveTaskSink.js';
import { createInvoicingComposition } from './invoicingComposition.js';
import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';

export async function createLegacyReviewCompositionFixture(
  withHistory = true,
  beforeMigration?: (database: DatabaseConnection) => void,
) {
  const f = await createLegacyPdfReadFixture(withHistory ? 'unambiguous' : false, beforeMigration);
  // The historical read fixture omits the source draft's approval lock.
  f.database.prepare(`
    UPDATE invoice_drafts SET approved_invoice_id = ?, approved_at = '2026-07-01T00:00:00Z'
    WHERE company_id = ? AND id = (SELECT source_draft_id FROM invoices WHERE id = ? AND company_id = ?)
  `).run(f.scope.invoiceId, f.scope.companyId, f.scope.invoiceId, f.scope.companyId);
  const noExternalEffect = vi.fn(async (): Promise<never> => { throw new Error('Unexpected external operation.'); });
  const write = vi.fn();
  function createApp(options: {
    allowed?: boolean; companyId?: string; logger?: OperationalLogger;
    prepareEmail?: InvoiceEmailDeliveryProvider['prepareDryRunEmail'];
    sendEmail?: InvoiceSmtpDeliveryProvider['sendEmail'];
    sendTestEmail?: InvoiceSmtpTestDeliveryProvider['sendTestEmail'];
    getEmailSettings?: InvoiceEmailSettingsReader['getEmailSettings'];
    queueArchive?: DeliveredInvoiceArchiveTaskSink['queueDeliveredInvoiceArchiveTask'];
  } = {}) {
    const composition = createInvoicingComposition({
      schema: 'revisionHistory',
      database: f.database,
      infrastructureAdapters: {
        invoiceDocumentStorage: f.storage,
        invoiceEmailDeliveryProvider: {
          prepareDryRunEmail: options.prepareEmail ?? noExternalEffect, sendDryRunEmail: noExternalEffect,
        },
        invoiceSmtpDeliveryProvider: { sendEmail: options.sendEmail ?? noExternalEffect },
        invoiceSmtpTestDeliveryProvider: { sendTestEmail: options.sendTestEmail ?? noExternalEffect },
      },
      companyEmailSecretReader: { getSecret: noExternalEffect },
      customerAccessReader: { belongsToCompany: noExternalEffect },
      invoiceCustomerTaxProfileReader: { getTaxProfile: noExternalEffect },
      invoiceEmailSettingsReader: { getEmailSettings: options.getEmailSettings ?? noExternalEffect },
      deliveredInvoiceArchiveTaskSink: { queueDeliveredInvoiceArchiveTask: options.queueArchive ?? noExternalEffect },
      operationalIdentity: {
        appVersion: '0.0.0', buildRevision: '123456789abc',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      },
      operationalLogger: options.logger ?? { write },
    });
    const app = new Hono<BackendEnvironment>();
    app.use('*', async (context, next) => {
      context.set('actorContext', createActorContext({
        actorId: 'synthetic-review-actor', authenticationMode: 'local',
        companyId: options.companyId ?? f.scope.companyId,
        permissions: options.allowed === false ? [] : ['manageInvoiceCorrections', 'sendInvoices'],
      }));
      await next();
    });
    app.route('/', composition.routes);
    return app;
  }
  return { ...f, createApp, noExternalEffect, write };
}

const email = { to: 'synthetic@example.invalid', cc: '', subject: 'Synthetic invoice', body: 'Synthetic preview' };
const send = { ...email, attemptId: 'synthetic-attempt', authorizationToken: 'synthetic-token' };
export const legacyReviewCommands = [
  { route: 'reopen-for-edit', body: undefined },
  { route: 'mark-sent', body: { deliveryMethod: 'manual' } },
  { route: 'email/dry-run', body: undefined },
  { route: 'email/dry-run/send', body: email },
  { route: 'email/smtp/prepare', body: { ...email, documentTarget: { kind: 'revision', documentId: 'synthetic-document' } } },
  { route: 'email/smtp/send', body: { ...send, documentTarget: { kind: 'revision', documentId: 'synthetic-document' } } },
  { route: 'email/smtp-test/prepare', body: email },
  { route: 'email/smtp-test/send', body: send },
];

export function legacyReviewRequest(body: unknown): RequestInit {
  return { method: 'POST', ...(body === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) };
}
