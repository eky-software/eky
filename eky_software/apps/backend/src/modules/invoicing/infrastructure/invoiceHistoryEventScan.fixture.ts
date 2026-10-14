import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryEventRow } from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { insertBoundHistoryEvent } from './invoiceEventPdfRead.fixture.js';
import { readInvoiceEventDocument } from './readInvoiceEventDocument.js';
import { createPublicationFixture, documentCandidate, openPublicationDatabase } from './sqliteInvoiceDocumentPublication.fixture.js';

export async function createEventScanFixture(database = openPublicationDatabase()) {
  const fixture = await createPublicationFixture(database);
  const result = await fixture.repository.publishDocumentIfCurrent({
    key: fixture.key, candidate: documentCandidate(fixture.key),
  });
  if (result.outcome === 'conflict') throw new Error('SYNTHETIC_DOCUMENT_MISSING');
  insertBoundHistoryEvent(database, result.document);
  return { ...fixture, database, document: result.document };
}

// Test-only oracle for the replaced whole-event-array algorithm. The ordinary
// document reader has its own regressions; production never calls this oracle.
export function previousEventCatalogCheck(database: DatabaseConnection): void {
  const events = database.prepare<[], InvoiceDeliveryEventRow>('SELECT * FROM invoice_delivery_events').all();
  const unresolved = new Set<string>();
  for (const event of events) {
    if (!['prepared', 'attempted', 'succeeded', 'failed', 'outcomeUnknown'].includes(event.status)
      || !['email', 'manual', 'print', 'other'].includes(event.delivery_method)
      || !['dryRun', 'smtp', 'gmail', 'microsoft', 'manual', 'other'].includes(event.provider)) fail();
    if (readInvoiceEventDocument(database, {
      companyId: event.company_id, invoiceId: event.invoice_id,
    }, event.id) === undefined) fail();
    if (event.binding_kind === 'legacyOriginal') continue;
    const validMode = (event.send_mode === 'customer' || event.send_mode === 'smtpTest')
      ? event.delivery_method === 'email' && event.provider === 'smtp'
      : event.send_mode === 'dryRun'
        ? event.delivery_method === 'email' && event.provider === 'dryRun'
        : event.send_mode === 'manual' && ['manual', 'print'].includes(event.delivery_method) && event.provider === 'manual';
    if (!validMode) fail();
    if (event.provider === 'smtp' && ['attempted', 'outcomeUnknown'].includes(event.status)) {
      const key = JSON.stringify([event.company_id, event.invoice_id]);
      if (unresolved.has(key)) fail();
      unresolved.add(key);
    }
  }
}

export function eventCheckOutcome(check: () => void): 'accepted' | 'rejected' {
  try { check(); return 'accepted'; } catch (error) {
    if (error instanceof InvoiceDocumentIntegrityError) return 'rejected';
    throw error;
  }
}

function fail(): never { throw new InvoiceDocumentIntegrityError(); }
