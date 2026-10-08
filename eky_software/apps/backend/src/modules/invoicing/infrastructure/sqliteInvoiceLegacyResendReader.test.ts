import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { insert, removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { eventRow } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { corruptEvent } from './invoiceEventPdfRead.fixture.js';
import { createLegacyPdfReadFixture } from './invoicePdfRead.fixture.js';
import { SqliteInvoiceLegacyResendReader } from './sqliteInvoiceLegacyResendReader.js';
import { closePublicationDatabases, corruptDocumentMetadata, createLegacyPublicationFixture, publicationState,
  publishValidatedLegacyRevision, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('legacy resend source selection', () => {
  it('selects the original and its exact preserved copy without writing or inventing historical mode', async () => {
    const f = await createLegacyPublicationFixture();
    const reader = new SqliteInvoiceLegacyResendReader(f.database);
    expect(await reader.findDocuments(f.scope)).toEqual({ source: f.original, preserved: undefined });
    const result = await f.repository.publishPreservedLegacyDocument(f);
    if (result.outcome === 'conflict') throw new Error('Synthetic publication failed.');
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    expect(await reader.findDocuments(f.scope)).toEqual({ source: f.original, preserved: result.document });
    expect(before.events).toEqual([expect.objectContaining({ send_mode: 'legacyUnknown', binding_kind: 'legacyOriginal' })]);
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each([
    null,
    { status: 'succeeded', documentId: null },
    { status: 'attempted' },
    { status: 'outcomeUnknown' },
    { status: 'failed' },
    { status: 'attempted', provider: 'dryRun' },
    { status: 'outcomeUnknown', provider: 'gmail' },
  ] as const)('rejects missing, ambiguous or unresolved history %j in both selection and publication', async (event) => {
    const f = await createLegacyPublicationFixture(event);
    const before = publicationState(f.database);
    expect(await new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope)).toBeUndefined();
    expect(await f.repository.publishPreservedLegacyDocument(f)).toEqual({ outcome: 'conflict' });
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['approved', 'cancelled', 'reopened_for_edit'] as const)('does not authorize %s from historical read access', async (status) => {
    const f = await createLegacyPublicationFixture();
    setInvoiceStatus(f.database, f.scope, status);
    expect(await new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope)).toBeUndefined();
  });

  it('does not select a legacy document for a validated current revision or another company/invoice', async () => {
    const f = await createLegacyPublicationFixture();
    const reader = new SqliteInvoiceLegacyResendReader(f.database);
    for (const scope of [{ ...f.scope, companyId: 'other' }, { ...f.scope, invoiceId: 'other' }]) {
      expect(await reader.findDocuments(scope)).toBeUndefined();
    }
    await f.repository.publishPreservedLegacyDocument(f);
    publishValidatedLegacyRevision(f.database);
    expect(await reader.findDocuments(f.scope)).toBeUndefined();
    expect(await f.repository.publishPreservedLegacyDocument(f)).toEqual({ outcome: 'conflict' });
  });

  it('rechecks an existing copy when another delivery reservation appeared', async () => {
    const f = await createLegacyPublicationFixture();
    await f.repository.publishPreservedLegacyDocument(f);
    insert(f.database, 'invoice_delivery_events', eventRow({
      id: 'new-attempt', document_id: f.candidate.id, binding_kind: 'preservedLegacy', revision_id: null,
      document_sha256: f.source.sha256, document_size_bytes: f.source.sizeBytes,
    }));
    const before = publicationState(f.database);
    expect(await new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope)).toBeUndefined();
    expect(await f.repository.publishPreservedLegacyDocument(f)).toEqual({ outcome: 'conflict' });
    expect(publicationState(f.database)).toEqual(before);
  });

  it('reports corrupt preserved metadata without substituting the original as a resend document', async () => {
    const f = await createLegacyPublicationFixture();
    await f.repository.publishPreservedLegacyDocument(f);
    corruptDocumentMetadata(f.database, f.candidate.id, { sha256: 'b'.repeat(64) });
    const before = publicationState(f.database);
    await expect(new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope))
      .rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(publicationState(f.database)).toEqual(before);
  });

  it('allows repeated legacy references to the same source but rejects distinct or missing references', async () => {
    const f = await createLegacyPdfReadFixture('repeated');
    setInvoiceStatus(f.database, f.scope, 'sent');
    const reader = new SqliteInvoiceLegacyResendReader(f.database);
    expect((await reader.findDocuments(f.scope))?.source.id).toBe('legacy-document');
    corruptEvent(f.database, "document_id = 'different-document'", 'legacy-repeat-event');
    expect(await reader.findDocuments(f.scope)).toBeUndefined();
    corruptEvent(f.database, 'document_id = NULL', 'legacy-repeat-event');
    expect(await reader.findDocuments(f.scope)).toBeUndefined();
  });
});
