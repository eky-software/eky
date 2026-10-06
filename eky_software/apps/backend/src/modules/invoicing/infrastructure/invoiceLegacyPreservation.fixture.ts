import { createActorContext } from '@eky/auth';

import { createLegacyPdfReadFixture } from './invoicePdfRead.fixture.js';
import { setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceLegacyResendReader } from './sqliteInvoiceLegacyResendReader.js';
import type { PreparePreservedLegacyInvoiceDocumentDependencies } from '../application/preparePreservedLegacyInvoiceDocument.js';

export async function legacyPreservationFixture(history: boolean | 'unambiguous' = 'unambiguous') {
  const f = await createLegacyPdfReadFixture(history);
  setInvoiceStatus(f.database, f.scope, 'sent');
  const actorContext = createActorContext({
    actorId: 'synthetic-actor', companyId: f.scope.companyId, authenticationMode: 'local', permissions: ['sendInvoices'],
  });
  const dependencies: PreparePreservedLegacyInvoiceDocumentDependencies = {
    invoiceLegacyResendReader: new SqliteInvoiceLegacyResendReader(f.database),
    invoiceDocumentRepository: f.dependencies.invoiceDocumentRepository,
    invoiceDocumentStorage: f.storage,
  };
  return { ...f, dependencies, input: { actorContext, invoiceId: f.scope.invoiceId, createdAt: '2027-01-15T13:00:00.000Z' } };
}
