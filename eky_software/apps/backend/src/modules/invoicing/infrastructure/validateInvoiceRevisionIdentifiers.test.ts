import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { historicalDatabase, migrate, removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import type { InvoiceContentRevisionRow, InvoiceRevisionLineRow, InvoiceRevisionVatBreakdownRow } from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { toInvoiceContentRevision } from './invoiceContentRevisionMapping.js';
import {
  invoiceHistoryTextChunkBytes, invoiceRevisionIdentifierFields, invoiceRevisionIdentifierScanSql,
  type InvoiceHistoryRelationChunk, type InvoiceRevisionIdentifierSource,
} from './invoiceHistoryRelationScan.js';
import { validateInvoiceRevisionUnitLength } from './invoiceRevisionConsistency.js';
import { revisionIdentifier, revisionNullableIdentifier } from './invoiceRevisionStoredValues.js';
import { bypassReaderFixtureConstraints, corruptStoredReaderRow } from './sqliteInvoiceContentRevisionReader.fixture.js';
import { closePublicationDatabases, createPublicationFixture, openPublicationDatabase } from './sqliteInvoiceDocumentPublication.fixture.js';
import { validateInvoiceRevisionIdentifiers } from './validateInvoiceRevisionIdentifiers.js';

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(context => {
  vi.restoreAllMocks();
  const failures: unknown[] = [];
  for (const database of databases.splice(0)) {
    try { database.close(); } catch (error) { failures.push(error); }
  }
  try { closePublicationDatabases(); } catch (error) { failures.push(error); }
  const roots = directories.splice(0);
  if (failures.length) throw new AggregateError(failures, 'SYNTHETIC_DATABASE_CLOSE_FAILED');
  if (context.task.result?.state === 'pass') for (const root of roots) rmSync(root, { recursive: true, force: true });
});
afterAll(removeDirectories);

const sources = ['invoice_content_revisions', 'invoice_revision_lines'] as const;
const fields = sources.flatMap(source => invoiceRevisionIdentifierFields[source].map(field => ({ source, field, label: `${source}.${field}` })));
const whitespace = '\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

describe('bounded revision identifier values', () => {
  it('covers exactly the ordinary mapper nonblank fields, separately from the encoding-policy fields', () => {
    expect(invoiceRevisionIdentifierFields).toEqual({
      invoice_content_revisions: ['company_id', 'invoice_id', 'id', 'source_draft_id', 'credited_invoice_id',
        'credited_revision_id', 'series_key', 'sequence_scope', 'customer_id', 'billing_recipient_customer_id'],
      invoice_revision_lines: ['line_id', 'invoice_id', 'source_invoice_line_id', 'source_revision_id', 'description', 'unit'],
    });
  });
  it('requires a transaction and accepts an empty history', () => {
    const database = createDatabase();
    expect(() => validateInvoiceRevisionIdentifiers(database)).toThrow(InvoiceContentRevisionIntegrityError);
    database.exec('DELETE FROM invoice_content_revisions; DELETE FROM invoice_revision_lines');
    check(database);
  });

  it.each(fields)('matches the existing scalar reader for $label including type and null', ({ source, field }) => {
    const database = createDatabase();
    for (const value of [null, '', whitespace, 'valid', '\u0000', '\u200b', Buffer.alloc(32)]) {
      if (value === null && (field === 'id' || field === 'line_id')) {
        expect(() => database.prepare(`UPDATE ${source} SET ${field} = ?`).run(value)).toThrow('NOT NULL');
        continue;
      }
      database.prepare(`UPDATE ${source} SET ${field} = ?`).run(value);
      expect(accepts(() => check(database))).toBe(accepts(() => ordinaryIdentifiers(database)));
    }
  });

  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'])('preserves decoded trim and UTF-16 length in %s', encoding => {
    const database = createDatabase(encoding);
    const padding = whitespace.repeat(700);
    for (const value of [
      padding, padding + 'h' + padding, padding + '12345678' + padding, padding + '123456789' + padding,
      'a' + padding + 'b', '\u{1f600}'.repeat(4), '\u{1f600}'.repeat(4) + 'a', '\ufeffh\ufeff',
      '\u0000h', '\u200bh', 'a\u0000b', 'e\u0301'.repeat(4), '\u0085'.repeat(8), '\u180e'.repeat(9),
      ' '.repeat(invoiceHistoryTextChunkBytes - 1) + '\u{1f600}' + ' '.repeat(invoiceHistoryTextChunkBytes),
    ]) {
      database.prepare('UPDATE invoice_revision_lines SET unit = ?').run(value);
      expect(accepts(() => check(database)), JSON.stringify(value.slice(-12)))
        .toBe(accepts(() => ordinaryIdentifiers(database)));
    }
  });

  it.each(['80', 'c080', 'eda080', 'f4908080', 'e282', '61f0288cbc'])('keeps nonfatal free-field decoding for %s', hex => {
    const database = createDatabase();
    for (const prefix of ['', ' '.repeat(invoiceHistoryTextChunkBytes - 1)]) {
      const bytes = Buffer.concat([Buffer.from(prefix), Buffer.from(hex, 'hex')]);
      database.prepare('UPDATE invoice_revision_lines SET description = CAST(? AS TEXT), unit = CAST(? AS TEXT)')
        .run(bytes, bytes);
      database.prepare('UPDATE invoice_content_revisions SET source_draft_id = CAST(? AS TEXT)').run(bytes);
      expect(accepts(() => check(database))).toBe(accepts(() => ordinaryIdentifiers(database)));
    }
  });

  it.each(['UTF-16le', 'UTF-16be'])('compares malformed free-field storage with the native reader in %s', encoding => {
    const database = createDatabase(encoding);
    for (const suffix of ['\ud800', '\udc00', '\ud800a', '\ud800\ud800', '\udc00\udc00']) {
      const bytes = Buffer.from('1234567' + suffix, 'utf16le');
      if (encoding === 'UTF-16be') bytes.swap16();
      database.prepare('UPDATE invoice_revision_lines SET unit = CAST(? AS TEXT)').run(bytes);
      expect(accepts(() => check(database)), suffix).toBe(accepts(() => ordinaryIdentifiers(database)));
    }
  });

  it('does not restrict long identifiers/descriptions or bridge full traversal keys', () => {
    const database = createDatabase();
    const text = 'x'.repeat(invoiceHistoryTextChunkBytes * 3) + '\u{1f600}';
    database.prepare('UPDATE invoice_content_revisions SET id = ?, source_draft_id = ?').run(text, text);
    database.prepare('UPDATE invoice_revision_lines SET revision_id = ?, line_id = ?, description = ?').run(text, text, text);
    const before = database.serialize();
    check(database);
    for (const source of sources) {
      const sql = invoiceRevisionIdentifierScanSql(source);
      let chunks = 0;
      for (const row of database.prepare<{ chunkBytes: number }, InvoiceHistoryRelationChunk>(sql)
        .iterate({ chunkBytes: invoiceHistoryTextChunkBytes })) {
        expect(Object.keys(row).sort()).toEqual(['byte_length', 'byte_offset', 'field_index', 'kind', 'ordinal', 'part']);
        expect(row.part?.length ?? 0).toBeLessThanOrEqual(invoiceHistoryTextChunkBytes);
        chunks++;
      }
      expect(chunks).toBeGreaterThan(invoiceRevisionIdentifierFields[source].length);
      const plan = database.prepare('EXPLAIN QUERY PLAN ' + sql).all({ chunkBytes: invoiceHistoryTextChunkBytes }) as { detail: string }[];
      expect(plan.some(row => row.detail === 'CO-ROUTINE scan')).toBe(true);
      expect(plan.some(row => /SEARCH next_row.*(?:PRIMARY KEY|INDEX)/.test(row.detail))).toBe(true);
      expect(plan.some(row => /MATERIALIZE scan|TEMP B-TREE|AUTOMATIC.*INDEX/.test(row.detail))).toBe(false);
    }
    expect(database.serialize()).toEqual(before);
  });

  it('checks later rows and second compound-key components without a growing JS set', () => {
    const database = createDatabase();
    database.transaction(() => {
      for (let index = 0; index < 1001; index++) {
        database.prepare(`INSERT INTO invoice_revision_lines SELECT revision_id, ?, invoice_id,
          source_invoice_line_id, source_revision_id, description, unit FROM invoice_revision_lines WHERE line_id = 'line'`)
          .run(`line-${String(index).padStart(4, '0')}`);
      }
    })();
    check(database);
    database.exec("UPDATE invoice_revision_lines SET description = '   ' WHERE line_id = 'line-1000'");
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it.each([true, false])('preserves first cursor failure and rejects a sole close failure: %s', initial => {
    const database = createDatabase();
    const prepare = database.prepare.bind(database);
    const first = new Error('SYNTHETIC_READ_FAILURE');
    const cleanup = new Error('SYNTHETIC_CLOSE_FAILURE');
    let closed = 0;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        const close = cursor.return?.bind(cursor);
        let calls = 0;
        cursor.next = () => { if (initial && ++calls === 2) throw first; return next(); };
        cursor.return = () => { close?.(); closed++; expect(statement.busy).toBe(false); throw cleanup; };
        return cursor;
      };
      return statement;
    });
    expect(() => check(database)).toThrow(initial ? first : cleanup);
    expect(closed).toBe(1);
    expect(database.inTransaction).toBe(false);
  });

  it('keeps late fields and the second table in the same WAL snapshot after a concurrent commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-revision-text-'));
    directories.push(root);
    const path = join(root, 'history.sqlite');
    const database = createDatabase('UTF-16le', path);
    database.pragma('journal_mode = WAL');
    const writer = new Database(path);
    databases.push(writer);
    const prepare = database.prepare.bind(database);
    let changed = false;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (!sql.startsWith('WITH RECURSIVE scan')) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        cursor.next = () => {
          const result = next();
          if (!changed && !result.done) {
            changed = true;
            writer.exec("UPDATE invoice_content_revisions SET source_draft_id = ''; UPDATE invoice_revision_lines SET unit = '123456789'");
          }
          return result;
        };
        return cursor;
      };
      return statement;
    });
    check(database);
    expect(changed).toBe(true);
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(database.inTransaction).toBe(false);
  });

  it('does not acquire a scan cursor when native text conversion preparation fails', () => {
    const database = createDatabase('UTF-16le');
    const prepare = database.prepare.bind(database);
    const failure = Object.assign(new Error('SYNTHETIC_NATIVE_MEMORY_FAILURE'), { code: 'SQLITE_NOMEM' });
    let scans = 0;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      if (sql === 'SELECT CAST(? AS TEXT) AS value') throw failure;
      if (sql.startsWith('WITH RECURSIVE scan')) scans++;
      return prepare(sql);
    });
    expect(() => check(database)).toThrow(failure);
    expect(scans).toBe(0);
    expect(database.inTransaction).toBe(false);
  });

  it.each([
    { terminal: false, closeFailure: false }, { terminal: false, closeFailure: true },
    { terminal: true, closeFailure: false }, { terminal: true, closeFailure: true },
  ])('preserves native conversion failure with terminal=$terminal and closeFailure=$closeFailure', ({ terminal, closeFailure }) => {
    const database = createDatabase('UTF-16le');
    if (terminal) database.prepare('UPDATE invoice_content_revisions SET company_id = CAST(? AS TEXT)')
      .run(Buffer.from([0x00, 0xd8]));
    const prepare = database.prepare.bind(database);
    const first = Object.assign(new Error('SYNTHETIC_CONVERSION_MEMORY_FAILURE'), { code: 'SQLITE_NOMEM' });
    const cleanup = new Error('SYNTHETIC_CURSOR_CLOSE_FAILURE');
    let conversions = 0;
    let closed = 0;
    let busyAfterClose: boolean | undefined;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql === 'SELECT CAST(? AS TEXT) AS value') {
        statement.get = (...args: unknown[]) => {
          conversions++;
          expect(args[0]).toEqual(Buffer.from(terminal ? '\ud800' : 'company', 'utf16le'));
          throw first;
        };
      }
      if (!sql.startsWith('WITH RECURSIVE scan')) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const close = cursor.return?.bind(cursor);
        cursor.return = () => {
          const result = close?.();
          closed++;
          busyAfterClose = statement.busy;
          if (closeFailure) throw cleanup;
          return result ?? { done: true, value: undefined };
        };
        return cursor;
      };
      return statement;
    });
    let failure: unknown;
    try { check(database); } catch (error) { failure = error; }
    expect(failure).toBe(first);
    expect(conversions).toBe(1);
    expect(closed).toBe(1);
    expect(busyAfterClose).toBe(false);
    expect(database.inTransaction).toBe(false);
  });

  it('does not accept delivery completion while its real native cursor remains busy', () => {
    const database = createDatabase();
    const prepare = database.prepare.bind(database);
    let release: (() => void) | undefined;
    let isBusy: (() => boolean) | undefined;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (!sql.startsWith('WITH RECURSIVE scan')) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const close = cursor.return?.bind(cursor);
        cursor.next();
        release = () => { close?.(); };
        isBusy = () => statement.busy;
        cursor.next = () => ({ done: true, value: undefined });
        cursor.return = () => ({ done: true, value: undefined });
        return cursor;
      };
      return statement;
    });
    database.exec('BEGIN');
    try {
      expect(() => validateInvoiceRevisionIdentifiers(database)).toThrow(InvoiceContentRevisionIntegrityError);
      expect(isBusy?.()).toBe(true);
    } finally {
      release?.();
      database.exec('ROLLBACK');
    }
    expect(isBusy?.()).toBe(false);
  });

  it.each(['offset', 'ordinal', 'field', 'bytes', 'truncated'] as const)('rejects invalid chunk delivery: %s', fault => {
    const database = createDatabase();
    const prepare = database.prepare.bind(database);
    let closed = false;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        const close = cursor.return?.bind(cursor);
        let calls = 0;
        cursor.next = () => {
          const result = next();
          if (++calls !== 2 || result.done) return result;
          if (fault === 'truncated') return { done: true, value: undefined };
          const row = { ...(result.value as InvoiceHistoryRelationChunk) };
          if (fault === 'offset') row.byte_offset = 1;
          if (fault === 'ordinal') row.ordinal = 99;
          if (fault === 'field') row.field_index = 99;
          if (fault === 'bytes') row.part = Buffer.alloc(invoiceHistoryTextChunkBytes + 1);
          return { done: false, value: row };
        };
        cursor.return = () => { const result = close?.(); closed = true; return result ?? { done: true, value: undefined }; };
        return cursor;
      };
      return statement;
    });
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(closed).toBe(true);
    expect(database.inTransaction).toBe(false);
  });

  it.each(['valid', 'blank', 'tooLong', 'replacement'] as const)('matches the real full mapper on %s description/unit content', async variant => {
    const database = openPublicationDatabase();
    const { key } = await createPublicationFixture(database);
    const unit = variant === 'blank' ? whitespace : variant === 'tooLong' ? '123456789' : whitespace.repeat(700) + 'h';
    corruptStoredReaderRow(database, 'invoice_revision_lines', { revision_id: key.revisionId, line_order: 1 }, {
      unit, description: 'x'.repeat(invoiceHistoryTextChunkBytes * 2),
    });
    if (variant === 'replacement') bypassReaderFixtureConstraints(database, 'invoice_revision_lines', () => {
      database.exec("UPDATE invoice_revision_lines SET description = CAST(x'80' AS TEXT), unit = CAST(x'80' AS TEXT)");
    });
    const before = database.serialize();
    expect(accepts(() => check(database))).toBe(accepts(() => fullMapper(database)));
    expect(database.serialize()).toEqual(before);
  });

  it('keeps historical unavailable VAT and historical arithmetic separate from text checks', async () => {
    const database = await historicalDatabase();
    database.exec("UPDATE invoices SET total_gross_cents = 999 WHERE id = 'invoice-1'");
    await migrate(database);
    fullMapper(database);
    check(database);
    corruptStoredReaderRow(database, 'invoice_revision_lines', { line_order: 1 }, { unit: whitespace });
    expect(() => fullMapper(database)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(() => check(database)).toThrow(InvoiceContentRevisionIntegrityError);
  });
});

function check(database: Database.Database) { database.transaction(() => validateInvoiceRevisionIdentifiers(database)).deferred(); }
function accepts(operation: () => void): boolean {
  try { operation(); return true; } catch (error) {
    if (!(error instanceof InvoiceContentRevisionIntegrityError)) throw error;
    return false;
  }
}

function ordinaryIdentifiers(database: Database.Database): void {
  const optional = new Set(['credited_invoice_id', 'credited_revision_id', 'billing_recipient_customer_id', 'source_invoice_line_id', 'source_revision_id']);
  for (const source of sources) {
    for (const row of database.prepare(`SELECT * FROM ${source}`).all() as Record<string, unknown>[]) {
      for (const field of invoiceRevisionIdentifierFields[source]) {
        if (optional.has(field)) revisionNullableIdentifier(row[field]);
        else revisionIdentifier(row[field]);
        if (field === 'unit') validateInvoiceRevisionUnitLength((row[field] as string).trim().length);
      }
    }
  }
}

function fullMapper(database: Database.Database): void {
  for (const header of database.prepare<[], InvoiceContentRevisionRow>('SELECT * FROM invoice_content_revisions').all()) {
    toInvoiceContentRevision(header,
      database.prepare<[string], InvoiceRevisionLineRow>('SELECT * FROM invoice_revision_lines WHERE revision_id = ? ORDER BY line_order').all(header.id),
      database.prepare<[string], InvoiceRevisionVatBreakdownRow>('SELECT * FROM invoice_revision_vat_breakdown WHERE revision_id = ? ORDER BY vat_rate_basis_points').all(header.id));
  }
}

function createDatabase(encoding = 'UTF-8', path = ':memory:'): Database.Database {
  const database = new Database(path);
  databases.push(database);
  database.pragma(`encoding = '${encoding}'`);
  database.exec(`
    CREATE TABLE invoice_content_revisions (company_id TEXT, invoice_id TEXT, id TEXT PRIMARY KEY,
      source_draft_id TEXT, credited_invoice_id TEXT, credited_revision_id TEXT, series_key TEXT,
      sequence_scope TEXT, customer_id TEXT, billing_recipient_customer_id TEXT) WITHOUT ROWID;
    CREATE TABLE invoice_revision_lines (revision_id TEXT, line_id TEXT, invoice_id TEXT,
      source_invoice_line_id TEXT, source_revision_id TEXT, description TEXT, unit TEXT,
      PRIMARY KEY(revision_id, line_id)) WITHOUT ROWID;
    INSERT INTO invoice_content_revisions VALUES ('company','invoice','revision','draft',NULL,NULL,'series','scope','customer',NULL);
    INSERT INTO invoice_revision_lines VALUES ('revision','line','invoice',NULL,NULL,'description','h');
  `);
  return database;
}
