import type Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { historicalDatabase, insert, migrate, removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createSnapshotDatabase } from '../../../database/migration/invoiceContentRevisionMigrationSnapshot.fixture.js';
import type { InvoiceContentRevisionRow, InvoiceLineRow, InvoiceRevisionLineRow, InvoiceRow } from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { approvalContentFields } from './invoiceApprovalRevision.fixture.js';
import { createInvoiceContentRevisionRow, createInvoiceRevisionLineRow, invoiceRevisionHeaderCopyFields, invoiceRevisionLineCopyFields } from './invoiceContentRevisionPersistenceRows.js';
import { invoiceHistoryTextChunkBytes } from './invoiceHistoryRelationScan.js';
import { invoiceRevisionPairScanSql, invoiceRevisionPairSources } from './invoiceRevisionPairScanSql.js';
import { bypassReaderFixtureConstraints, lineFields } from './sqliteInvoiceContentRevisionReader.fixture.js';
import { closePublicationDatabases, createPublicationFixture, nextPublicationRevision, openPublicationDatabase } from './sqliteInvoiceDocumentPublication.fixture.js';
import { validateInvoiceRevisionPairs } from './validateInvoiceRevisionPairs.js';
import { validateInvoiceRevisionCatalog } from './validateInvoiceRevisionCatalog.js';
import { validateInvoiceRevisionCurrentSourceGuards, validateInvoiceRevisionRelations } from './validateInvoiceRevisionRelations.js';
import { validateInvoiceHistoryRelationEncoding } from './validateInvoiceHistoryRelationEncoding.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

async function fixture(encoding = 'UTF-8', input?: Database.Database) {
  const original = input ?? openPublicationDatabase();
  if (!input) await createPublicationFixture(original);
  if (encoding === 'UTF-8') return original;
  const database = openPublicationDatabase();
  database.pragma(`encoding = '${encoding}'`);
  database.pragma('foreign_keys = OFF');
  // Native decoding fixture, not a claim about UTF-16 migration admission.
  for (const table of ['invoices', 'invoice_lines', 'invoice_content_revisions', 'invoice_revision_lines',
    'invoice_revision_vat_breakdown', 'invoice_current_revisions']) {
    database.exec(original.prepare<[string], { sql: string }>('SELECT sql FROM sqlite_master WHERE name = ?').get(table)!.sql);
    for (const row of original.prepare(`SELECT * FROM ${table}`).all()) insert(database, table, row as Record<string, string | number | null>);
  }
  return database;
}

// Small synthetic oracle uses the ordinary persistence mapping, independently
// of the bounded SQL field projection. It is not a second production catalog.
function ordinaryPairs(database: Database.Database): void {
  const revisions = database.prepare<[], InvoiceContentRevisionRow>('SELECT * FROM invoice_content_revisions').all();
  for (const stored of revisions) {
    if (stored.credited_revision_id !== null) {
      const source = revisions.find(row => row.id === stored.credited_revision_id);
      if (!source || source.invoice_number !== stored.credited_invoice_number_snapshot ||
        source.invoice_date !== stored.credited_invoice_date_snapshot) throw new InvoiceContentRevisionIntegrityError();
    }
  }
  for (const current of database.prepare<[], { invoice_id: string; revision_id: string }>('SELECT * FROM invoice_current_revisions').all()) {
    const stored = revisions.find(row => row.id === current.revision_id)!;
    const live = database.prepare<[string], InvoiceRow>('SELECT * FROM invoices WHERE id = ?').get(current.invoice_id)!;
    const source = stored.invoice_kind === 'credit' ? { companyId: stored.company_id, invoiceId: stored.credited_invoice_id!,
      revisionId: stored.credited_revision_id!, invoiceNumber: stored.credited_invoice_number_snapshot!,
      invoiceDate: stored.credited_invoice_date_snapshot! } : null;
    const expected = { ...createInvoiceContentRevisionRow(live, stored.id, source), origin: stored.origin, vat_breakdown_state: stored.vat_breakdown_state };
    if (Object.keys(expected).some(key => expected[key as keyof typeof expected] !== stored[key as keyof typeof stored])) {
      throw new InvoiceContentRevisionIntegrityError();
    }
    const lines = database.prepare<[string], InvoiceLineRow>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_order').all(live.id);
    const saved = database.prepare<[string], InvoiceRevisionLineRow>('SELECT * FROM invoice_revision_lines WHERE revision_id = ? ORDER BY line_order').all(stored.id);
    if (lines.length !== saved.length) throw new InvoiceContentRevisionIntegrityError();
    for (const [index, line] of lines.entries()) {
      const expectedLine = createInvoiceRevisionLineRow(live.company_id, stored.id, line, source);
      if (Object.keys(expectedLine).some(key => expectedLine[key as keyof typeof expectedLine] !== saved[index]![key as keyof InvoiceRevisionLineRow])) {
        throw new InvoiceContentRevisionIntegrityError();
      }
    }
  }
}
function succeeds(operation: () => void): boolean {
  try { operation(); return true; } catch (error) {
    if (error instanceof InvoiceContentRevisionIntegrityError ||
      (error instanceof Error && error.message === 'Invoice revision source binding is invalid.')) return false;
    throw error;
  }
}
function compare(database: Database.Database, expected: boolean): void {
  const before = database.serialize();
  expect(succeeds(() => ordinaryPairs(database))).toBe(expected);
  expect(succeeds(() => database.transaction(() => {
    validateInvoiceRevisionRelations(database);
    validateInvoiceRevisionPairs(database);
    validateInvoiceRevisionCurrentSourceGuards(database);
  }).deferred())).toBe(expected);
  expect(database.serialize().equals(before)).toBe(true);
  expect(database.inTransaction).toBe(false);
}
function rawText(database: Database.Database, table: 'invoices' | 'invoice_content_revisions', field: string, bytes: Buffer): void {
  bypassReaderFixtureConstraints(database, table, () => database.prepare(`UPDATE ${table} SET ${field} = CAST(? AS TEXT)`).run(bytes));
}

describe('bounded exact revision content pairing', () => {
  it('shares every persisted snapshot field without adopting live state', async () => {
    expect([...invoiceRevisionHeaderCopyFields].sort()).toEqual(['company_id', ...approvalContentFields].sort());
    expect([...invoiceRevisionLineCopyFields, 'line_id'].sort()).toEqual(lineFields.map(([field]) => field).sort());
    const database = await fixture();
    compare(database, true);
    bypassReaderFixtureConstraints(database, 'invoices', () => database.exec(
      "UPDATE invoices SET updated_at = 'changed', paid_amount_cents = 999, cancellation_reason = 'changed'",
    ));
    compare(database, true);
  });

  it.each(approvalContentFields)('rejects an independently changed live header field: %s', async field => {
    const database = await fixture();
    bypassReaderFixtureConstraints(database, 'invoices', () => database.prepare(`UPDATE invoices SET ${field} = ?`).run(Buffer.from('different')));
    compare(database, false);
  });

  it.each(lineFields.map(([field]) => field === 'line_id' ? 'id' : field))('rejects an independently changed live line field: %s', async field => {
    const database = await fixture();
    bypassReaderFixtureConstraints(database, 'invoice_lines', () => database.prepare(
      `UPDATE invoice_lines SET ${field} = ? WHERE _rowid_ = (SELECT _rowid_ FROM invoice_lines LIMIT 1)`,
    ).run(Buffer.from('different')));
    compare(database, false);
  });

  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'])('compares complete native decoded text in %s without byte-equality shortcuts', async encoding => {
    const database = await fixture(encoding);
    const encode = (value: string) => {
      const bytes = Buffer.from(value, encoding === 'UTF-8' ? 'utf8' : 'utf16le');
      return encoding === 'UTF-16be' ? bytes.swap16() : bytes;
    };
    const prefix = 'x\ufeff\0\u{1f600}' + 'x'.repeat(invoiceHistoryTextChunkBytes + 7);
    // Unequal byte lengths but equal driver-decoded strings, across chunk boundaries.
    const left = Buffer.concat([encode(prefix), encoding === 'UTF-8' ? Buffer.from([0xff]) : Buffer.from([0x20])]);
    const right = encode(prefix + (encoding === 'UTF-8' ? '\ufffd' : ''));
    rawText(database, 'invoice_content_revisions', 'note', left);
    rawText(database, 'invoices', 'note', right);
    const saved = database.prepare<[], { note: string }>('SELECT note FROM invoice_content_revisions').get()!.note;
    const live = database.prepare<[], { note: string }>('SELECT note FROM invoices').get()!.note;
    expect(saved === live, JSON.stringify({ encoding, storedLength: saved.length, liveLength: live.length,
      storedStart: saved.charCodeAt(0), liveStart: live.charCodeAt(0),
      storedEnd: saved.charCodeAt(saved.length - 1), liveEnd: live.charCodeAt(live.length - 1) })).toBe(true);
    compare(database, true);
    rawText(database, 'invoices', 'note', Buffer.concat([right, encode('late difference')]));
    compare(database, false);
  });

  it('does not mistake different chunk alignment for unequal decoded text', async () => {
    const database = await fixture();
    rawText(database, 'invoice_content_revisions', 'note', Buffer.alloc(invoiceHistoryTextChunkBytes * 3 + 5, 0xff));
    rawText(database, 'invoices', 'note', Buffer.from('\ufffd'.repeat(invoiceHistoryTextChunkBytes * 3 + 5)));
    compare(database, true);
  });

  it.each(['UTF-16le', 'UTF-16be'])('retains native decoded live lifecycle/kind rules in %s', async encoding => {
    const database = await fixture(encoding);
    for (const field of ['status', 'invoice_kind']) {
      const value = (database.prepare(`SELECT ${field} AS value FROM invoices`).get() as { value: string }).value;
      const bytes = Buffer.from(value, 'utf16le');
      if (encoding === 'UTF-16be') bytes.swap16();
      rawText(database, 'invoices', field, Buffer.concat([bytes, Buffer.from([0x20])]));
    }
    compare(database, true);
    expect(() => database.transaction(() => validateInvoiceRevisionCatalog(database)).deferred()).not.toThrow();
  });

  it.each(['UTF-16le', 'UTF-16be'])('does not apply fatal encoding policy to live credited_invoice_id in %s', async encoding => {
    const database = await fixture(encoding, await createSnapshotDatabase());
    const credits = database.prepare<[], { id: string; credited_invoice_id: string }>(
      'SELECT id, credited_invoice_id FROM invoices WHERE credited_invoice_id IS NOT NULL',
    ).all();
    expect(credits.length).toBeGreaterThan(0);
    for (const row of credits) {
      const bytes = Buffer.from(row.credited_invoice_id, 'utf16le');
      if (encoding === 'UTF-16be') bytes.swap16();
      bypassReaderFixtureConstraints(database, 'invoices', () => database.prepare(
        'UPDATE invoices SET credited_invoice_id = CAST(? AS TEXT) WHERE id = ?',
      ).run(Buffer.concat([bytes, Buffer.from([0x20])]), row.id));
    }
    compare(database, true);
    expect(() => database.transaction(() => validateInvoiceRevisionCatalog(database)).deferred()).not.toThrow();
  });

  it.each(['null versus empty', 'numeric versus text', 'blob versus text'])('preserves strict type comparison: %s', async variant => {
    const database = await fixture();
    if (variant === 'null versus empty') {
      bypassReaderFixtureConstraints(database, 'invoices', () => database.exec("UPDATE invoices SET performance_date = ''"));
    } else {
      bypassReaderFixtureConstraints(database, 'invoices', () => database.prepare('UPDATE invoices SET payment_term_days = ?')
        .run(variant === 'numeric versus text' ? 'different' : Buffer.from('14')));
    }
    compare(database, false);
  });

  it('keeps migrated 038 empty sequences and historical provenance', async () => {
    const database = await historicalDatabase();
    database.exec("DELETE FROM invoice_lines WHERE invoice_id = 'invoice-1'");
    await migrate(database);
    compare(database, true);
  });

  it('keeps credit and non-current history without copying live status', async () => {
    compare(await createSnapshotDatabase(), true);
    const database = openPublicationDatabase();
    const { key } = await createPublicationFixture(database);
    nextPublicationRevision(database, key);
    compare(database, true);
  });

  it('uses bounded projections and indexed traversal, without a result-sized sort', async () => {
    const database = await fixture();
    rawText(database, 'invoice_content_revisions', 'note', Buffer.alloc(invoiceHistoryTextChunkBytes * 2 + 1, 65));
    rawText(database, 'invoices', 'note', Buffer.alloc(invoiceHistoryTextChunkBytes * 2 + 1, 65));
    for (const source of invoiceRevisionPairSources) for (const side of [0, 1] as const) {
      const sql = invoiceRevisionPairScanSql(source, side);
      const plan = database.prepare('EXPLAIN QUERY PLAN ' + sql).all({ chunkBytes: invoiceHistoryTextChunkBytes }) as { detail: string }[];
      expect(plan.some(row => /TEMP B-TREE|AUTOMATIC.*INDEX/.test(row.detail)), JSON.stringify(plan)).toBe(false);
      for (const row of database.prepare(sql).iterate({ chunkBytes: invoiceHistoryTextChunkBytes }) as Iterable<Record<string, unknown>>) {
        expect(Object.values(row).every(value => value === null || typeof value === 'number' ||
          (typeof value === 'string' && value.length <= 7) || (Buffer.isBuffer(value) && value.length <= invoiceHistoryTextChunkBytes))).toBe(true);
      }
    }
  });

  it.each(['extra live', 'extra stored', 'missing live', 'missing stored', 'swapped order'])(
    'full catalog rejects unequal ordered sequence: %s', async variant => {
      const database = await fixture();
      const table = variant.endsWith('live') ? 'invoice_lines' : 'invoice_revision_lines';
      bypassReaderFixtureConstraints(database, table, () => {
        if (variant.startsWith('missing')) database.exec(`DELETE FROM ${table} WHERE line_order = 1`);
        else if (variant.startsWith('extra')) {
          const row = database.prepare(`SELECT * FROM ${table} LIMIT 1`).get() as Record<string, string | number | null>;
          insert(database, table, { ...row, [table === 'invoice_lines' ? 'id' : 'line_id']: 'extra-line', line_order: 100 });
        } else database.exec(`UPDATE ${table} SET line_order = line_order + 100`);
      });
      expect(() => database.transaction(() => {
        validateInvoiceHistoryRelationEncoding(database);
        validateInvoiceRevisionCatalog(database);
      }).deferred()).toThrow(InvoiceContentRevisionIntegrityError);
    },
  );
});
