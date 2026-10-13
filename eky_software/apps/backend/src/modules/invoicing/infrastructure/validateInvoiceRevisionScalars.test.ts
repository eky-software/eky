import type Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { historicalDatabase, insert, migrate, removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createSnapshotDatabase } from '../../../database/migration/invoiceContentRevisionMigrationSnapshot.fixture.js';
import type { InvoiceContentRevisionRow, InvoiceRevisionLineRow, InvoiceRevisionVatBreakdownRow } from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { createApprovalRevisionFixture, createReverseChargeRevisionDraft, revisionApprovalInput } from './invoiceApprovalRevision.fixture.js';
import { toInvoiceContentRevision } from './invoiceContentRevisionMapping.js';
import { invoiceRevisionHeaderScanSql, invoiceRevisionLineScanSql, invoiceRevisionVatScanSql } from './invoiceRevisionScalarScanSql.js';
import { bypassReaderFixtureConstraints, headerFields, lineFields } from './sqliteInvoiceContentRevisionReader.fixture.js';
import { closePublicationDatabases, createPublicationFixture, nextPublicationRevision, openPublicationDatabase } from './sqliteInvoiceDocumentPublication.fixture.js';
import { validateInvoiceRevisionIdentifiers } from './validateInvoiceRevisionIdentifiers.js';
import { validateInvoiceRevisionScalars } from './validateInvoiceRevisionScalars.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

const headerTable = 'invoice_content_revisions';
const lineTable = 'invoice_revision_lines';
const vatTable = 'invoice_revision_vat_breakdown';
type Table = typeof headerTable | typeof lineTable | typeof vatTable;
const queries = [invoiceRevisionHeaderScanSql, invoiceRevisionLineScanSql, invoiceRevisionVatScanSql];
const headerIdentifiers = ['source_draft_id', 'credited_invoice_id', 'series_key', 'sequence_scope', 'customer_id', 'billing_recipient_customer_id'];
const headerScalars = [...headerFields.map(([field]) => field).filter(field => !headerIdentifiers.includes(field)),
  'origin', 'vat_breakdown_state', 'credited_invoice_number_snapshot', 'credited_invoice_date_snapshot'];
const lineIdentifiers = ['line_id', 'invoice_id', 'source_invoice_line_id', 'description', 'unit'];
const lineScalars = lineFields.map(([field]) => field).filter(field => !lineIdentifiers.includes(field));
const scalarFields = [
  ...headerScalars.map(field => ({ table: headerTable, field })),
  ...lineScalars.map(field => ({ table: lineTable, field })),
  ...['vat_rate_basis_points', 'net_cents', 'vat_cents', 'gross_cents'].map(field => ({ table: vatTable, field })),
];

async function fixture() {
  const database = openPublicationDatabase();
  const setup = await createPublicationFixture(database);
  return { database, ...setup };
}
async function scalarDatabase(encoding: string) {
  const source = await fixture();
  if (encoding === 'UTF-8') return source.database;
  const database = openPublicationDatabase();
  database.pragma(`encoding = '${encoding}'`);
  database.pragma('foreign_keys = OFF');
  // Copy the actual table definitions and rows, not the application's migration
  // admission path. This isolates native text decoding from migration support.
  for (const table of [headerTable, lineTable, vatTable]) {
    database.exec(source.database.prepare<[string], { sql: string }>('SELECT sql FROM sqlite_master WHERE name = ?').get(table)!.sql);
    for (const row of source.database.prepare(`SELECT * FROM ${table}`).all()) {
      insert(database, table, row as Record<string, string | number | null>);
    }
  }
  expect(database.pragma('encoding', { simple: true })).toBe(encoding);
  return database;
}
function change(database: Database.Database, table: Table, field: string, value: unknown): void {
  const key = table === headerTable ? 'id' : table === lineTable ? 'line_id' : 'vat_rate_basis_points';
  bypassReaderFixtureConstraints(database, table, () => {
    database.prepare(`UPDATE ${table} SET ${field} = ? WHERE ${key} = (SELECT ${key} FROM ${table} LIMIT 1)`).run(value);
  });
}
function check(database: Database.Database): void {
  database.transaction(() => {
    // Fixtures use known valid relation encodings. Their corruption policy has
    // separate real-catalog tests; this suite targets scalar/value equivalence.
    validateInvoiceRevisionIdentifiers(database);
    validateInvoiceRevisionScalars(database);
  })();
}
function ordinary(database: Database.Database): void {
  for (const header of database.prepare<[], InvoiceContentRevisionRow>(`SELECT * FROM ${headerTable}`).all()) {
    const lines = database.prepare<[string], InvoiceRevisionLineRow>(`SELECT * FROM ${lineTable} WHERE revision_id = ?`).all(header.id);
    const vat = database.prepare<[string], InvoiceRevisionVatBreakdownRow>(`SELECT * FROM ${vatTable} WHERE revision_id = ?`).all(header.id);
    toInvoiceContentRevision(header, lines, vat);
  }
}
function accepted(operation: () => void): boolean {
  try { operation(); return true; } catch (error) {
    if (!(error instanceof InvoiceContentRevisionIntegrityError)) throw error;
    return false;
  }
}
function compare(database: Database.Database, expected?: boolean): void {
  const before = database.serialize();
  const normal = accepted(() => ordinary(database));
  expect(accepted(() => check(database))).toBe(normal);
  if (expected !== undefined) expect(normal).toBe(expected);
  expect(database.serialize().equals(before)).toBe(true);
  expect(database.inTransaction).toBe(false);
}

describe('bounded revision scalar validation', () => {
  it('requires the owner transaction and accepts empty history', async () => {
    const database = openPublicationDatabase();
    await createApprovalRevisionFixture(database);
    expect(() => validateInvoiceRevisionScalars(database)).toThrow(InvoiceContentRevisionIntegrityError);
    check(database);
  });

  it.each(scalarFields)('rejects a BLOB instead of the mapped scalar in $table / $field', async ({ table, field }) => {
    const { database } = await fixture();
    change(database, table as Table, field, Buffer.from('invalid'));
    compare(database, false);
  });

  it.each([
    'sequence_number', 'payment_term_days', 'reminder_period_days', 'late_payment_interest_basis_points',
    'total_net_cents', 'total_vat_cents', 'total_gross_cents',
  ])('preserves safe integer and per-field range rules: header.%s', async field => {
    const { database } = await fixture();
    for (const value of [-1, 0, 1, 365, 366, 100000, 100001, 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      change(database, headerTable, field, value);
      compare(database);
    }
  });

  it.each(['line_order', 'quantity_hundredths', 'unit_price_cents', 'vat_rate_basis_points', 'discount_value',
    'base_cents', 'discount_cents', 'net_cents', 'vat_cents', 'gross_cents'])('preserves numeric rules: line.%s', async field => {
    const { database } = await fixture();
    for (const value of [-1, 0, 1, 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      change(database, lineTable, field, value);
      compare(database);
    }
  });

  it.each(['invoice_kind', 'origin', 'vat_breakdown_state', 'numbering_mode', 'reference_number_type', 'price_input_mode', 'tax_treatment'])(
    'compares the entire decoded enum, never its prefix: %s', async field => {
      const { database } = await fixture();
      const value = (database.prepare(`SELECT ${field} AS value FROM ${headerTable}`).get() as { value: string }).value;
      for (const suffix of ['\0', ' ', '\n', 'x'.repeat(65536)]) {
        change(database, headerTable, field, value + suffix);
        compare(database, false);
      }
    },
  );

  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'])('preserves bounded date rules and nullable pairs in %s', async encoding => {
    const database = await scalarDatabase(encoding);
    for (const [date, start, end] of [
      [null, null, null], ['2028-02-29', null, null], ['2027-02-29', null, null],
      ['2028-02-29\n', null, null], ['2028-02-29\0', null, null], ['2028-02-29' + 'x'.repeat(65536), null, null],
      [null, '2027-01-01', '2027-02-01'], [null, '2027-02-01', '2027-01-01'],
      [null, '2027-01-01', null], ['2027-01-01', '2027-01-01', '2027-02-01'],
    ]) {
      change(database, headerTable, 'performance_date', date);
      change(database, headerTable, 'performance_period_start', start);
      change(database, headerTable, 'performance_period_end', end);
      compare(database);
    }
  });

  it.each(['UTF-16le', 'UTF-16be'])('preserves SQLite ignored odd tail for short non-relation values in %s', async encoding => {
    const database = await scalarDatabase(encoding);
    const fields = ['invoice_kind', 'origin', 'vat_breakdown_state', 'numbering_mode', 'reference_number_type',
      'price_input_mode', 'tax_treatment', 'tax_treatment_label_snapshot', 'tax_legal_basis_snapshot', 'performance_date'];
    change(database, headerTable, 'performance_date', '2028-02-29');
    for (const field of fields) {
      const value = (database.prepare(`SELECT ${field} AS value FROM ${headerTable}`).get() as { value: string }).value;
      const bytes = Buffer.from(value, 'utf16le');
      if (encoding === 'UTF-16be') bytes.swap16();
      bypassReaderFixtureConstraints(database, headerTable, () => {
        database.prepare(`UPDATE ${headerTable} SET ${field} = CAST(? AS TEXT)`).run(Buffer.concat([bytes, Buffer.from([0x20])]));
      });
      compare(database, true);
    }
  });

  it('does not restrict free text or newly validate legacy invoice dates', async () => {
    const { database } = await fixture();
    for (const field of ['note', 'subject', 'invoice_number', 'invoice_date', 'due_date', 'created_at']) {
      change(database, headerTable, field, 'not-a-date\0\u{1f600}'.repeat(5000));
    }
    change(database, lineTable, 'code', 'x'.repeat(65536));
    compare(database, true);
    for (const query of queries) {
      for (const row of database.prepare(query).iterate() as Iterable<Record<string, unknown>>) {
        expect(Object.values(row).every(value => value === null || typeof value === 'number' ||
          (typeof value === 'string' && value.length <= 32))).toBe(true);
      }
    }
  });

  it('accepts reverse charge and rejects a VAT group without changing its early branch', async () => {
    const database = openPublicationDatabase();
    const setup = await createApprovalRevisionFixture(database);
    await setup.drafts.saveDraft(createReverseChargeRevisionDraft());
    const approved = await setup.repository.approveDraft(revisionApprovalInput({ reverseChargeEligibilityConfirmed: true }));
    compare(database, true);
    bypassReaderFixtureConstraints(database, vatTable, () => insert(database, vatTable, {
      company_id: approved!.revisionKey.companyId, invoice_id: approved!.revisionKey.invoiceId,
      revision_id: approved!.revisionKey.revisionId, vat_rate_basis_points: 0, net_cents: 0, vat_cents: 0, gross_cents: 0,
    }));
    compare(database, false);
  });

  it.each(['inconsistent totals', 'empty lines'] as const)('keeps migrated 038 %s', async variant => {
    const database = await historicalDatabase();
    if (variant === 'empty lines') database.exec("DELETE FROM invoice_lines WHERE invoice_id = 'invoice-1'");
    else {
      database.exec("UPDATE invoices SET total_net_cents = 111, total_vat_cents = 22, total_gross_cents = 999 WHERE id = 'invoice-1'");
      database.exec("UPDATE invoice_lines SET net_cents = 77, vat_cents = 3, gross_cents = 444 WHERE id = 'line-1'");
    }
    await migrate(database);
    compare(database, true);
  });

  it('accepts mixed credit and validated legacy history without current-source assumptions', async () => {
    compare(await createSnapshotDatabase(), true);
  });

  it.each([lineTable, vatTable] as const)('rejects an orphan or foreign child in %s', async table => {
    const { database } = await fixture();
    change(database, table, 'company_id', 'foreign-company');
    compare(database, false);
    change(database, table, 'revision_id', 'missing-parent');
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it.each(['group arithmetic', 'total mismatch', 'missing group', 'extra rate'] as const)('rejects VAT %s', async variant => {
    const { database } = await fixture();
    if (variant === 'group arithmetic') change(database, vatTable, 'gross_cents', 1);
    else if (variant === 'total mismatch') {
      change(database, vatTable, 'net_cents', 1);
      change(database, vatTable, 'vat_cents', 0);
      change(database, vatTable, 'gross_cents', 1);
    } else if (variant === 'missing group') {
      bypassReaderFixtureConstraints(database, vatTable, () => database.exec(`DELETE FROM ${vatTable}`));
    } else {
      const row = database.prepare(`SELECT * FROM ${vatTable}`).get() as Record<string, string | number>;
      bypassReaderFixtureConstraints(database, vatTable, () => insert(database, vatTable, {
        ...row, vat_rate_basis_points: 1234, net_cents: 0, vat_cents: 0, gross_cents: 0,
      }));
    }
    compare(database, false);
  });

  it('keeps per-revision VAT totals separate and visits non-current history', async () => {
    const { database, key, approve } = await fixture();
    nextPublicationRevision(database, key);
    await approve('another-invoice');
    compare(database, true);
    bypassReaderFixtureConstraints(database, vatTable, () => {
      database.prepare(`UPDATE ${vatTable} SET gross_cents = 1 WHERE revision_id = ?`).run(key.revisionId);
    });
    compare(database, false);
  });

  it('uses real indexed traversal without a result-sized temporary sort', async () => {
    const { database } = await fixture();
    for (const query of queries) {
      const plan = database.prepare('EXPLAIN QUERY PLAN ' + query).all() as { detail: string }[];
      expect(plan.some(row => /TEMP B-TREE|AUTOMATIC.*INDEX/.test(row.detail)), JSON.stringify(plan)).toBe(false);
    }
  });
});
