import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import {
  invoiceHistoryRelationScanSql, invoiceHistoryRelationSources, invoiceHistoryTextChunkBytes,
  type InvoiceHistoryRelationChunk, type InvoiceHistoryRelationSource,
} from './invoiceHistoryRelationScan.js';
import { validateInvoiceHistoryRelationEncoding } from './validateInvoiceHistoryRelationEncoding.js';

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(context => {
  vi.restoreAllMocks();
  const errors: unknown[] = [];
  for (const database of databases.splice(0)) {
    try { database.close(); } catch (error) { errors.push(error); }
  }
  const roots = directories.splice(0);
  if (errors.length) throw new AggregateError(errors, 'SYNTHETIC_DATABASE_CLOSE_FAILED');
  if (context.task.result?.state === 'pass') {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

const sources = Object.keys(invoiceHistoryRelationSources) as InvoiceHistoryRelationSource[];
const relationFields = sources.flatMap(source => invoiceHistoryRelationSources[source].fields.map(field => ({ source, field })));

describe('invoice history bounded relation encoding', () => {
  it('keeps the explicitly approved encoding fields separate from all other stored fields', () => {
    expect(Object.fromEntries(sources.map(source => [source, invoiceHistoryRelationSources[source].fields]))).toEqual({
      invoices: ['id', 'company_id'],
      invoice_lines: ['id', 'invoice_id', 'source_invoice_line_id'],
      invoice_content_revisions: ['id', 'company_id', 'invoice_id', 'credited_invoice_id', 'credited_revision_id'],
      invoice_revision_lines: ['company_id', 'invoice_id', 'revision_id', 'line_id', 'source_revision_id', 'source_invoice_line_id'],
      invoice_revision_vat_breakdown: ['company_id', 'invoice_id', 'revision_id'],
      invoice_current_revisions: ['company_id', 'invoice_id', 'revision_id'],
      invoice_documents: ['id', 'company_id', 'invoice_id', 'revision_id', 'source_document_id'],
      invoice_delivery_events: ['id', 'company_id', 'invoice_id', 'revision_id', 'document_id'],
    });
  });
  it('requires the owning catalog read transaction', () => {
    expect(() => validateInvoiceHistoryRelationEncoding(createDatabase())).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'])('accepts exact Unicode, BOM and NUL in the existing %s storage encoding', encoding => {
    const database = createDatabase(encoding);
    for (const source of sources) {
      insertRow(database, source, '\uFEFFa\u0000\u00e4\u{1f600}\uFFFD');
      insertRow(database, source, 'e\u0301');
      insertRow(database, source, '\u00e9');
    }
    const before = database.serialize();
    check(database);
    expect(database.serialize()).toEqual(before);
    expect(database.inTransaction).toBe(false);
  });

  it.each(relationFields)('rejects malformed bytes in $source.$field without modifying storage', ({ source, field }) => {
    const database = createDatabase();
    insertRow(database, source, 'first');
    insertRow(database, source, 'last');
    database.prepare(`UPDATE ${source} SET ${field} = CAST(? AS TEXT) WHERE ${field} = 'last'`)
      .run(Buffer.from([0x80]));
    const before = database.serialize();
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(database.serialize()).toEqual(before);
    expect(database.inTransaction).toBe(false);
  });

  it.each(['80', 'c080', 'eda080', 'f4908080', 'e282', '61f0288cbc'])('rejects later-chunk malformed UTF-8: %s', hex => {
    const database = createDatabase();
    insertRow(database, 'invoices', 'first');
    const bytes = Buffer.concat([Buffer.from('a'.repeat(invoiceHistoryTextChunkBytes - 1)), Buffer.from(hex, 'hex')]);
    database.prepare('UPDATE invoices SET company_id = CAST(? AS TEXT)').run(bytes);
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it.each(['UTF-16le', 'UTF-16be'])('handles surrogate pairs across chunks in %s and rejects an unpaired surrogate', encoding => {
    const database = createDatabase(encoding);
    insertRow(database, 'invoices', 'first');
    const valid = 'a'.repeat(invoiceHistoryTextChunkBytes / 2 - 1) + '\u{1f600}';
    database.prepare('UPDATE invoices SET company_id = ?').run(valid);
    check(database);
    const malformed = Buffer.from('a'.repeat(invoiceHistoryTextChunkBytes / 2 - 1) + '\ud800', 'utf16le');
    if (encoding === 'UTF-16be') malformed.swap16();
    database.prepare('UPDATE invoices SET company_id = CAST(? AS TEXT)').run(malformed);
    const stored = database.prepare<[], { bytes: Buffer }>('SELECT CAST(company_id AS BLOB) AS bytes FROM invoices').get()!.bytes;
    expect(stored).toEqual(malformed);
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it.each([0, invoiceHistoryTextChunkBytes - 1, invoiceHistoryTextChunkBytes, invoiceHistoryTextChunkBytes + 1])(
    'ends an exact text length without dropping the following field or row: %s', size => {
      const database = createDatabase();
      insertRow(database, 'invoices', 'first');
      insertRow(database, 'invoices', 'second');
      database.prepare("UPDATE invoices SET company_id = ? WHERE id = 'first'").run('a'.repeat(size));
      check(database);
      const rows = database.prepare<{ chunkBytes: number }, InvoiceHistoryRelationChunk>(invoiceHistoryRelationScanSql('invoices'))
        .all({ chunkBytes: invoiceHistoryTextChunkBytes });
      const parts = rows.filter(row => row.ordinal === 0 && row.field_index === 1);
      expect(parts).toHaveLength(Math.max(1, Math.ceil(size / invoiceHistoryTextChunkBytes)));
      expect(parts.reduce((sum, row) => sum + (row.part?.length ?? 0), 0)).toBe(size);
      database.exec("UPDATE invoices SET company_id = CAST(x'80' AS TEXT) WHERE id = 'second'");
      expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
    },
  );

  it('does not silently broaden the encoding decision to free text or other identifiers', () => {
    const database = createDatabase();
    insertRow(database, 'invoices', 'first');
    insertRow(database, 'invoice_content_revisions', 'first');
    database.exec(`
      ALTER TABLE invoices ADD COLUMN credited_invoice_id TEXT;
      ALTER TABLE invoice_content_revisions ADD COLUMN note TEXT;
      ALTER TABLE invoice_content_revisions ADD COLUMN customer_id TEXT;
      ALTER TABLE invoice_content_revisions ADD COLUMN source_draft_id TEXT;
      UPDATE invoices SET credited_invoice_id = CAST(x'80' AS TEXT);
      UPDATE invoice_content_revisions SET note = CAST(x'80' AS TEXT),
        customer_id = CAST(x'80' AS TEXT), source_draft_id = CAST(x'80' AS TEXT);
    `);
    check(database);
  });

  it('leaves existing type/null validation with its owner and does not skip older nullable IDs', () => {
    const database = createDatabase();
    insertRow(database, 'invoices', 'first');
    database.exec("UPDATE invoices SET id = NULL, company_id = CAST(x'80' AS TEXT)");
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
    database.exec("UPDATE invoices SET company_id = NULL; INSERT INTO invoices VALUES ('second', zeroblob(65536))");
    check(database);
    database.exec("UPDATE invoices SET company_id = CAST(x'80' AS TEXT) WHERE id = 'second'");
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it.each(sources)('keeps long keys and compound-key continuations inside SQLite: %s', source => {
    const database = createDatabase();
    const longValue = 'x'.repeat(invoiceHistoryTextChunkBytes - 1) + '\u{1f600}' + 'z'.repeat(invoiceHistoryTextChunkBytes);
    insertRow(database, source, longValue);
    insertRow(database, source, 'second');
    const before = database.serialize();
    let chunks = 0;
    let largest = 0;
    const ordinals = new Set<number>();
    for (const row of database.prepare<{ chunkBytes: number }, InvoiceHistoryRelationChunk>(invoiceHistoryRelationScanSql(source))
      .iterate({ chunkBytes: invoiceHistoryTextChunkBytes })) {
      expect(Object.keys(row).sort()).toEqual(['byte_length', 'byte_offset', 'field_index', 'kind', 'ordinal', 'part']);
      if (row.part) { chunks++; largest = Math.max(largest, row.part.length); }
      ordinals.add(row.ordinal);
    }
    expect(ordinals).toEqual(new Set([0, 1]));
    expect(chunks).toBeGreaterThan(invoiceHistoryRelationSources[source].fields.length * 2);
    expect(largest).toBe(invoiceHistoryTextChunkBytes);
    check(database);
    expect(database.serialize()).toEqual(before);
  });

  it.each(sources)('uses an indexed successor, not a growing SQL traversal set: %s', source => {
    const database = createDatabase();
    const sql = invoiceHistoryRelationScanSql(source);
    const plan = database.prepare('EXPLAIN QUERY PLAN ' + sql).all({ chunkBytes: invoiceHistoryTextChunkBytes }) as { detail: string }[];
    expect(plan.some(row => row.detail === 'CO-ROUTINE scan')).toBe(true);
    expect(plan.some(row => /SEARCH next_row.*(?:PRIMARY KEY|INDEX)/.test(row.detail))).toBe(true);
    expect(plan.some(row => /MATERIALIZE scan|TEMP B-TREE|AUTOMATIC.*INDEX/.test(row.detail))).toBe(false);
    expect(sql).not.toMatch(/\bOFFSET\s+(?:\?|[@:$]\w+|\d+)/i);
    expect(sql.match(/\bUNION\b/g)).toHaveLength(1);
    expect(sql).toContain('UNION ALL');
  });

  it.each(['invoice_revision_lines', 'invoice_revision_vat_breakdown', 'invoice_current_revisions'] as const)(
    'visits every second-component successor with the same first key: %s', source => {
      const database = createDatabase();
      for (const value of ['a', 'b', 'c']) insertRow(database, source, value);
      const firstKey = invoiceHistoryRelationSources[source].keys[0];
      if (source === 'invoice_revision_vat_breakdown') {
        database.exec("UPDATE invoice_revision_vat_breakdown SET vat_rate_basis_points = CASE revision_id WHEN 'a' THEN 0 WHEN 'b' THEN 1400 ELSE 2550 END");
      }
      database.exec(`UPDATE ${source} SET ${firstKey} = 'same-key'`);
      const rows = database.prepare<{ chunkBytes: number }, InvoiceHistoryRelationChunk>(invoiceHistoryRelationScanSql(source))
        .all({ chunkBytes: invoiceHistoryTextChunkBytes });
      const fieldCount = invoiceHistoryRelationSources[source].fields.length;
      expect(rows).toHaveLength(fieldCount * 3);
      expect(rows.map(row => row.ordinal)).toEqual([0, 1, 2].flatMap(value => Array.from({ length: fieldCount }, () => value)));
      database.exec(`UPDATE ${source} SET company_id = CAST(x'80' AS TEXT) WHERE ${source === 'invoice_current_revisions'
        ? "invoice_id = 'c'" : source === 'invoice_revision_lines' ? "line_id = 'c'" : 'vat_rate_basis_points = 2550'}`);
      expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
    },
  );

  it('keeps later chunks and table scans in the same WAL snapshot during a second writer commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-history-relations-'));
    directories.push(root);
    const path = join(root, 'history.sqlite');
    const database = createDatabase('UTF-8', path);
    database.pragma('journal_mode = WAL');
    insertRow(database, 'invoices', 'x'.repeat(invoiceHistoryTextChunkBytes + 1));
    insertRow(database, 'invoice_delivery_events', 'event');
    const writer = new Database(path);
    databases.push(writer);
    const prepare = database.prepare.bind(database);
    let updated = false;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (!sql.startsWith('WITH RECURSIVE scan')) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        cursor.next = () => {
          const row = next();
          if (!updated && !row.done) {
            updated = true;
            writer.exec("UPDATE invoices SET company_id = CAST(x'80' AS TEXT); UPDATE invoice_delivery_events SET document_id = CAST(x'80' AS TEXT)");
          }
          return row;
        };
        return cursor;
      };
      return statement;
    });
    check(database);
    expect(updated).toBe(true);
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it.each([true, false])('preserves the first error and never ignores a sole cursor-close failure: %s', firstFailure => {
    const database = createDatabase();
    insertRow(database, 'invoices', 'first');
    const prepare = database.prepare.bind(database);
    const first = new Error('SYNTHETIC_FIRST_FAILURE');
    const cleanup = new Error('SYNTHETIC_CLOSE_FAILURE');
    let closes = 0;
    let statementBusy: boolean | undefined;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (!sql.startsWith('WITH RECURSIVE scan')) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        const close = cursor.return?.bind(cursor);
        let calls = 0;
        cursor.next = () => {
          if (firstFailure && ++calls === 2) throw first;
          return next();
        };
        cursor.return = () => { closes++; close?.(); statementBusy = statement.busy; throw cleanup; };
        return cursor;
      };
      return statement;
    });
    expect(() => check(database)).toThrow(firstFailure ? first : cleanup);
    expect(closes).toBe(1);
    expect(statementBusy).toBe(false);
    expect(database.inTransaction).toBe(false);
  });
});

function check(database: Database.Database): void {
  database.transaction(() => validateInvoiceHistoryRelationEncoding(database)).deferred();
}

function createDatabase(encoding = 'UTF-8', path = ':memory:'): Database.Database {
  const database = new Database(path);
  databases.push(database);
  database.pragma(`encoding = '${encoding}'`);
  database.exec(`
    CREATE TABLE invoices (id TEXT PRIMARY KEY, company_id TEXT);
    CREATE TABLE invoice_lines (id TEXT PRIMARY KEY, invoice_id TEXT, source_invoice_line_id TEXT);
    CREATE TABLE invoice_content_revisions (id TEXT PRIMARY KEY, company_id TEXT, invoice_id TEXT,
      credited_invoice_id TEXT, credited_revision_id TEXT) WITHOUT ROWID;
    CREATE TABLE invoice_revision_lines (company_id TEXT, invoice_id TEXT, revision_id TEXT, line_id TEXT,
      source_revision_id TEXT, source_invoice_line_id TEXT, PRIMARY KEY(revision_id, line_id)) WITHOUT ROWID;
    CREATE TABLE invoice_revision_vat_breakdown (company_id TEXT, invoice_id TEXT, revision_id TEXT,
      vat_rate_basis_points INTEGER, PRIMARY KEY(revision_id, vat_rate_basis_points)) WITHOUT ROWID;
    CREATE TABLE invoice_current_revisions (company_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
      revision_id TEXT, PRIMARY KEY(company_id, invoice_id));
    CREATE TABLE invoice_documents (id TEXT PRIMARY KEY, company_id TEXT, invoice_id TEXT,
      revision_id TEXT, source_document_id TEXT) WITHOUT ROWID;
    CREATE TABLE invoice_delivery_events (id TEXT PRIMARY KEY, company_id TEXT, invoice_id TEXT,
      revision_id TEXT, document_id TEXT) WITHOUT ROWID;
  `);
  return database;
}

function insertRow(database: Database.Database, source: InvoiceHistoryRelationSource, text: string): void {
  const { fields, keys } = invoiceHistoryRelationSources[source];
  const columns = [...fields, ...keys.filter(key => key !== '_rowid_' && !(fields as readonly string[]).includes(key))];
  database.prepare(`INSERT INTO ${source} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map(column => column === 'vat_rate_basis_points' ? 2550 : text));
}
