import { afterAll, afterEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  historicalDatabase, insert, migrate, removeDirectories,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createSnapshotDatabase } from '../../../database/migration/invoiceContentRevisionMigrationSnapshot.fixture.js';
import type { InvoiceRevisionLineRow, InvoiceRevisionVatBreakdownRow } from '../../../database/schema.js';
import {
  createApprovalRevisionFixture, createReverseChargeRevisionDraft, revisionApprovalInput,
} from './invoiceApprovalRevision.fixture.js';
import {
  createLegacyCreditRevisionSource, creditApprovalInput, markRevisionSourceSent,
  persistRevisionCreditDraft, readCreditRevision,
} from './invoiceCreditRevision.fixture.js';
import { SqliteInvoiceBackupArtifactCatalog } from './sqliteInvoiceBackupArtifactCatalog.js';
import {
  bypassReaderFixtureConstraints, corruptStoredReaderRow, deleteStoredReaderRows,
  totalChanges, type StoredValues,
} from './sqliteInvoiceContentRevisionReader.fixture.js';
import { SqliteInvoiceCreditApprovalRepository } from './sqliteInvoiceCreditApprovalRepository.js';
import {
  closePublicationDatabases, createPublicationFixture, nextPublicationRevision,
  openPublicationDatabase, publicationState, setInvoiceStatus,
} from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

function catalog(database: DatabaseConnection) {
  return new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory');
}

async function expectInvalid(database: DatabaseConnection) {
  const before = publicationState(database);
  const changes = totalChanges(database);
  database.pragma('query_only = ON');
  await expect(catalog(database).listAuthoritativeArtifacts()).rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
  expect(database.inTransaction).toBe(false);
  expect(totalChanges(database)).toBe(changes);
  expect(publicationState(database)).toStrictEqual(before);
}

describe('invoice revision catalog history validation', () => {
  it.each(['approved', 'sent', 'cancelled'] as const)('accepts %s content without any PDF', async (status) => {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    setInvoiceStatus(database, fixture.key, status);
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
  });

  it('accepts reopened history without a current pointer or PDF', async () => {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    await expect(fixture.approval.repository.reopenApprovedInvoiceForEditing({
      ...fixture.key, actorUserId: 'synthetic-actor', auditEventId: 'catalog-reopen',
      reopenedAt: '2027-01-16T00:00:00.000Z',
    })).resolves.toMatchObject({ invoiceId: fixture.key.invoiceId });
    expect(database.prepare('SELECT * FROM invoice_current_revisions').all()).toEqual([]);
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
  });

  it('accepts reverse charge with an authoritative empty VAT collection', async () => {
    const database = openPublicationDatabase();
    const fixture = await createApprovalRevisionFixture(database);
    await fixture.drafts.saveDraft(createReverseChargeRevisionDraft());
    await fixture.repository.approveDraft(revisionApprovalInput({ reverseChargeEligibilityConfirmed: true }));
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
  });

  it('accepts validated legacy provenance without reclassifying the content', async () => {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    corruptStoredReaderRow(database, 'invoice_content_revisions', { id: fixture.key.revisionId }, {
      origin: 'validatedLegacySnapshot',
    });
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
  });

  it.each<[string, StoredValues]>([
    ['unknown origin', { origin: 'unknown' }],
    ['unavailable approval VAT', { vat_breakdown_state: 'unavailable' }],
    ['unsafe total', { total_net_cents: Number.MAX_SAFE_INTEGER + 1 }],
    ['broken total', { total_gross_cents: 1 }],
    ['foreign company', { company_id: 'foreign-company' }],
    ['missing owner', { invoice_id: 'missing-invoice' }],
    ['standard with source', { credited_invoice_id: 'another-invoice' }],
    ['partial reference', { reference_number_type: null }],
  ])('rejects PDF-less historical %s corruption, not only current documents', async (_label, values) => {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    nextPublicationRevision(database, fixture.key);
    corruptStoredReaderRow(database, 'invoice_content_revisions', { id: fixture.key.revisionId }, values);
    await expectInvalid(database);
  });

  it.each(['invoice_revision_lines', 'invoice_revision_vat_breakdown'] as const)(
    'rejects an orphan %s row even when every published revision remains valid', async (table) => {
      const database = openPublicationDatabase();
      await createPublicationFixture(database);
      const source = database.prepare<[], InvoiceRevisionLineRow | InvoiceRevisionVatBreakdownRow>(
        `SELECT * FROM ${table} LIMIT 1`,
      ).get()!;
      bypassReaderFixtureConstraints(database, table, () => {
        insert(database, table, { ...source, revision_id: 'missing-parent' });
      });
      await expectInvalid(database);
    },
  );

  it.each(['invoice_revision_lines', 'invoice_revision_vat_breakdown'] as const)(
    'rejects wrong child company scoping in %s without a PDF', async (table) => {
      const database = openPublicationDatabase();
      const fixture = await createPublicationFixture(database);
      const key: StoredValues = table === 'invoice_revision_lines'
        ? { revision_id: fixture.key.revisionId, line_order: 1 }
        : { revision_id: fixture.key.revisionId, vat_rate_basis_points: 2550 };
      corruptStoredReaderRow(database, table, key, { company_id: 'foreign-company' });
      await expectInvalid(database);
    },
  );

  it('validates historical line content rather than just its foreign keys', async () => {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    nextPublicationRevision(database, fixture.key);
    corruptStoredReaderRow(database, 'invoice_revision_lines', {
      revision_id: fixture.key.revisionId, line_order: 1,
    }, { quantity_hundredths: 0.5 });
    await expectInvalid(database);
  });

  it('rejects an invoice with its entire history removed', async () => {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    for (const table of ['invoice_current_revisions', 'invoice_revision_lines', 'invoice_revision_vat_breakdown'] as const) {
      deleteStoredReaderRows(database, table, { revision_id: fixture.key.revisionId });
    }
    deleteStoredReaderRows(database, 'invoice_content_revisions', { id: fixture.key.revisionId });
    await expectInvalid(database);
  });

  it.each(['missing', 'foreign company', 'wrong invoice', 'missing revision', 'reopened'] as const)(
    'rejects a %s current relationship without any PDF', async (variant) => {
      const database = openPublicationDatabase();
      const fixture = await createPublicationFixture(database);
      if (variant === 'missing') {
        deleteStoredReaderRows(database, 'invoice_current_revisions', { invoice_id: fixture.key.invoiceId });
      } else if (variant === 'reopened') {
        setInvoiceStatus(database, fixture.key, 'reopened_for_edit');
      } else {
        const other = await fixture.approve('other-invoice');
        corruptStoredReaderRow(database, 'invoice_current_revisions', { invoice_id: fixture.key.invoiceId },
          variant === 'foreign company' ? { company_id: 'foreign-company' }
            : { revision_id: variant === 'wrong invoice' ? other.revisionId : 'missing-revision' });
      }
      await expectInvalid(database);
    },
  );

  it.each(['header', 'line'] as const)('rejects a current %s projection differing from its immutable snapshot', async (part) => {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    if (part === 'header') {
      corruptStoredReaderRow(database, 'invoices', { id: fixture.key.invoiceId }, { subject: 'Changed projection' });
    } else {
      corruptStoredReaderRow(database, 'invoice_lines', { invoice_id: fixture.key.invoiceId, line_order: 1 }, {
        description: 'Changed projection',
      });
    }
    await expectInvalid(database);
  });

  it('accepts mixed migrated standard, credit, reopened and foreign-company history', async () => {
    const database = await createSnapshotDatabase();
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toHaveLength(1);
  });

  it.each(['inconsistent totals', 'empty lines'] as const)('preserves valid legacy %s without recomputing history', async (variant) => {
    const database = await historicalDatabase();
    if (variant === 'empty lines') database.prepare("DELETE FROM invoice_lines WHERE invoice_id = 'invoice-1'").run();
    else {
      database.prepare("UPDATE invoices SET total_net_cents = 111, total_vat_cents = 22, total_gross_cents = 999 WHERE id = 'invoice-1'").run();
      database.prepare("UPDATE invoice_lines SET net_cents = 77, vat_cents = 3, gross_cents = 444 WHERE id = 'line-1'").run();
    }
    await migrate(database);
    const before = publicationState(database);
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
    expect(publicationState(database)).toStrictEqual(before);
  });
});

describe('invoice revision catalog credit sources', () => {
  async function createCredit() {
    const database = openPublicationDatabase();
    const fixture = await createPublicationFixture(database);
    const source = await markRevisionSourceSent(database, fixture.approval);
    await persistRevisionCreditDraft(database, source);
    await expect(new SqliteInvoiceCreditApprovalRepository(database).approveCreditDraft(creditApprovalInput()))
      .resolves.toMatchObject({ outcome: 'approved' });
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toEqual([]);
    return { database, credit: readCreditRevision(database, creditApprovalInput().invoiceId), fixture };
  }

  it('accepts a new credit whose exact source is a legacy snapshot', async () => {
    const { database, source } = await createLegacyCreditRevisionSource();
    await persistRevisionCreditDraft(database, source);
    await expect(new SqliteInvoiceCreditApprovalRepository(database).approveCreditDraft(creditApprovalInput({
      companyId: source.companyId,
    }))).resolves.toMatchObject({ outcome: 'approved' });
    await expect(catalog(database).listAuthoritativeArtifacts()).resolves.toHaveLength(1);
  });

  it.each<[string, StoredValues]>([
    ['missing source', { credited_revision_id: 'missing' }],
    ['wrong invoice', { credited_invoice_id: 'missing' }],
    ['wrong number', { credited_invoice_number_snapshot: '20990001' }],
    ['wrong date', { credited_invoice_date_snapshot: '2099-01-01' }],
    ['partial source', { credited_revision_id: null }],
  ])('rejects PDF-less credit %s', async (_label, values) => {
    const { database, credit } = await createCredit();
    corruptStoredReaderRow(database, 'invoice_content_revisions', { id: credit.header.id }, values);
    await expectInvalid(database);
  });

  it.each(['missing line', 'wrong revision', 'partial source'] as const)('rejects PDF-less credit line %s', async (variant) => {
    const { database, credit } = await createCredit();
    const line = credit.lines.find((entry) => entry.source_invoice_line_id !== null)!;
    corruptStoredReaderRow(database, 'invoice_revision_lines', {
      revision_id: credit.header.id, line_id: line.line_id,
    }, variant === 'missing line' ? { source_invoice_line_id: 'missing-line' }
      : { source_revision_id: variant === 'partial source' ? null : credit.header.id });
    await expectInvalid(database);
  });

  it('rejects an internally valid source in a different company', async () => {
    const { database, credit, fixture } = await createCredit();
    const foreign = await fixture.approve('foreign-source', 'foreign-company');
    const row = readCreditRevision(database, foreign.invoiceId, foreign.companyId).header;
    corruptStoredReaderRow(database, 'invoice_content_revisions', { id: credit.header.id }, {
      credited_invoice_id: foreign.invoiceId, credited_revision_id: foreign.revisionId,
      credited_invoice_number_snapshot: row.invoice_number, credited_invoice_date_snapshot: row.invoice_date,
    });
    await expectInvalid(database);
  });
});
