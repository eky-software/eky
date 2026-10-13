import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { invoiceRevisionHeaderScanSql, invoiceRevisionLineScanSql, invoiceRevisionVatScanSql } from './invoiceRevisionScalarScanSql.js';
import { bypassReaderFixtureConstraints } from './sqliteInvoiceContentRevisionReader.fixture.js';
import { closePublicationDatabases, createPublicationFixture, nextPublicationRevision, openPublicationDatabase } from './sqliteInvoiceDocumentPublication.fixture.js';
import { validateInvoiceRevisionScalars } from './validateInvoiceRevisionScalars.js';

const databases: Database.Database[] = [];
const roots: string[] = [];
afterEach(context => {
  vi.restoreAllMocks();
  const failures: unknown[] = [];
  for (const database of databases.splice(0)) {
    try { database.close(); } catch (error) { failures.push(error); }
  }
  try { closePublicationDatabases(); } catch (error) { failures.push(error); }
  const directories = roots.splice(0);
  if (failures.length) throw new AggregateError(failures, 'SYNTHETIC_DATABASE_CLOSE_FAILED');
  if (context.task.result?.state === 'pass') for (const root of directories) rmSync(root, { recursive: true, force: true });
});

const scans = [
  { name: 'header', sql: invoiceRevisionHeaderScanSql, corrupt: { text_types_valid: 0 } },
  { name: 'line', sql: invoiceRevisionLineScanSql, corrupt: { text_types_valid: 0 } },
  { name: 'VAT', sql: invoiceRevisionVatScanSql, corrupt: { net_cents: -1 } },
];

describe('bounded revision scalar cursor lifecycle', () => {
  it.each(scans.flatMap(scan => ['success', 'validation', 'native'].map(failure => ({ ...scan, failure })) ))(
    '$name preserves $failure result separately from close failure', async ({ sql: target, corrupt, failure }) => {
      const database = openPublicationDatabase();
      const { key } = await createPublicationFixture(database);
      nextPublicationRevision(database, key);
      const prepare = database.prepare.bind(database);
      const first = Object.assign(new Error('SYNTHETIC_NATIVE_FAILURE'), { code: 'SQLITE_NOMEM' });
      const cleanup = new Error('SYNTHETIC_CURSOR_CLOSE_FAILURE');
      let closes = 0;
      vi.spyOn(database, 'prepare').mockImplementation(sql => {
        const statement = prepare(sql);
        if (sql !== target) return statement;
        const iterate = statement.iterate.bind(statement);
        statement.iterate = (...args: unknown[]) => {
          const cursor = iterate(...args);
          const next = cursor.next.bind(cursor);
          const close = cursor.return?.bind(cursor);
          let calls = 0;
          cursor.next = () => {
            calls++;
            if (calls === 2 && failure === 'native') throw first;
            const result = next();
            if (calls === 2 && failure === 'validation' && !result.done) {
              return { done: false, value: { ...(result.value as Record<string, unknown>), ...corrupt } };
            }
            return result;
          };
          cursor.return = () => { closes++; close?.(); expect(statement.busy).toBe(false); throw cleanup; };
          return cursor;
        };
        return statement;
      });
      const before = database.serialize();
      expect(() => database.transaction(() => validateInvoiceRevisionScalars(database)).deferred())
        .toThrow(failure === 'native' ? first : failure === 'validation' ? InvoiceContentRevisionIntegrityError : cleanup);
      expect(closes).toBe(1);
      expect(database.inTransaction).toBe(false);
      expect(database.serialize().equals(before)).toBe(true);
    },
  );

  it.each(scans)('$name refuses success when return leaves the native reader busy', async ({ sql: target }) => {
    const database = openPublicationDatabase();
    await createPublicationFixture(database);
    const prepare = database.prepare.bind(database);
    let release: (() => unknown) | undefined;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql !== target) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        cursor.next();
        release = cursor.return?.bind(cursor);
        cursor.next = () => ({ done: true, value: undefined });
        cursor.return = () => ({ done: true, value: undefined });
        return cursor;
      };
      return statement;
    });
    database.exec('BEGIN');
    try { expect(() => validateInvoiceRevisionScalars(database)).toThrow(InvoiceContentRevisionIntegrityError); }
    finally { release?.(); database.exec('ROLLBACK'); }
  });

  it('keeps headers, lines and VAT in one WAL snapshot despite a concurrent commit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-revision-scalars-'));
    roots.push(root);
    const path = join(root, 'history.sqlite');
    const database = openPublicationDatabase(path);
    database.pragma('journal_mode = WAL');
    await createPublicationFixture(database);
    const writer = new Database(path, { timeout: 0 });
    databases.push(writer);
    const prepare = database.prepare.bind(database);
    let updated = false;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql !== invoiceRevisionHeaderScanSql) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        cursor.next = () => {
          const row = next();
          if (!updated && !row.done) {
            updated = true;
            bypassReaderFixtureConstraints(writer, 'invoice_revision_lines', () => {
              writer.exec('UPDATE invoice_revision_lines SET net_cents = -1');
            });
          }
          return row;
        };
        return cursor;
      };
      return statement;
    });
    expect(() => database.transaction(() => validateInvoiceRevisionScalars(database)).deferred()).not.toThrow();
    expect(updated).toBe(true);
    expect(() => database.transaction(() => validateInvoiceRevisionScalars(database)).deferred())
      .toThrow(InvoiceContentRevisionIntegrityError);
    expect(database.inTransaction).toBe(false);
  });
});
