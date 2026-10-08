import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import {
  closePublicationDatabases, createLegacyPublicationFixture, createPublicationFixture,
  documentCandidate, nextPublicationRevision, openPublicationDatabase,
  publicationState, setInvoiceStatus,
} from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('current revision document read', () => {
  it.each(['approved', 'sent'] as const)('reads %s metadata without writes and remains company/invoice/revision scoped', async (status) => {
    const database = openPublicationDatabase();
    const f = await createPublicationFixture(database);
    const result = await f.repository.publishDocumentIfCurrent({ key: f.key, candidate: documentCandidate(f.key) });
    if (result.outcome !== 'published') throw new Error('Synthetic publication failed.');
    setInvoiceStatus(database, f.key, status);
    const before = publicationState(database);
    database.pragma('query_only = ON');
    await expect(f.repository.findCurrentDocumentForRevision(f.key)).resolves.toEqual(result.document);
    for (const key of [
      { ...f.key, companyId: 'another-company' },
      { ...f.key, invoiceId: 'another-invoice' },
      { ...f.key, revisionId: 'another-revision' },
    ]) await expect(f.repository.findCurrentDocumentForRevision(key)).resolves.toBeUndefined();
    expect(publicationState(database)).toEqual(before);
  });

  it.each(['reopened_for_edit', 'cancelled'] as const)('retains history but denies current access for %s', async (status) => {
    const database = openPublicationDatabase();
    const f = await createPublicationFixture(database);
    await f.repository.publishDocumentIfCurrent({ key: f.key, candidate: documentCandidate(f.key) });
    setInvoiceStatus(database, f.key, status);
    const before = publicationState(database);
    await expect(f.repository.findCurrentDocumentForRevision(f.key)).resolves.toBeUndefined();
    await expect(f.repository.findDocumentForRevision(f.key)).resolves.toBeDefined();
    expect(publicationState(database)).toEqual(before);
  });

  it('does not fall back to a historical document when the current revision has none', async () => {
    const database = openPublicationDatabase();
    const f = await createPublicationFixture(database);
    await f.repository.publishDocumentIfCurrent({ key: f.key, candidate: documentCandidate(f.key) });
    const next = nextPublicationRevision(database, f.key);
    const before = publicationState(database);
    await expect(f.repository.findCurrentDocumentForRevision(f.key)).resolves.toBeUndefined();
    await expect(f.repository.findCurrentDocumentForRevision(next)).resolves.toBeUndefined();
    expect(publicationState(database)).toEqual(before);
  });

  it('does not adopt a legacy original as a revision document', async () => {
    const f = await createLegacyPublicationFixture();
    const row = f.database.prepare('SELECT revision_id FROM invoice_current_revisions WHERE company_id = ? AND invoice_id = ?')
      .get(f.scope.companyId, f.scope.invoiceId) as { revision_id: string };
    const before = publicationState(f.database);
    await expect(f.repository.findCurrentDocumentForRevision({ ...f.scope, revisionId: row.revision_id })).resolves.toBeUndefined();
    expect(publicationState(f.database)).toEqual(before);
  });
});
