import { createActorContext } from '@eky/auth';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { insert, type Row } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { eventRow } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import type { StoredInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';

export function historyInput(scope: InvoiceScope, eventId = 'event-history') {
  return { actorContext: createActorContext({
    actorId: 'synthetic-actor', authenticationMode: 'local', companyId: scope.companyId, permissions: ['sendInvoices'],
  }), invoiceId: scope.invoiceId, eventId };
}

export function insertBoundHistoryEvent(database: DatabaseConnection, document: StoredInvoiceDocumentMetadata, overrides: Row = {}) {
  insert(database, 'invoice_delivery_events', eventRow({
    id: 'event-history', company_id: document.companyId, invoice_id: document.invoiceId,
    document_id: document.id, binding_kind: document.binding.kind,
    revision_id: document.binding.kind === 'revision' ? document.binding.revisionId : null,
    document_sha256: document.sha256, document_size_bytes: document.sizeBytes,
    send_mode: 'smtpTest', status: 'succeeded', ...overrides,
  }));
}

export function corruptEvent(database: DatabaseConnection, assignment: string, eventId = 'event-history') {
  const guard = database.prepare<[], { sql: string }>(`
    SELECT sql FROM sqlite_master WHERE name = 'invoice_delivery_events_binding_no_update'
  `).get()!;
  database.pragma('foreign_keys = OFF');
  database.pragma('ignore_check_constraints = ON');
  database.exec('DROP TRIGGER invoice_delivery_events_binding_no_update');
  try {
    // Only fixed synthetic assignments enter this corruption fixture.
    database.prepare(`UPDATE invoice_delivery_events SET ${assignment} WHERE id = ?`).run(eventId);
  } finally {
    database.exec(guard.sql);
    database.pragma('ignore_check_constraints = OFF');
    database.pragma('foreign_keys = ON');
  }
}
