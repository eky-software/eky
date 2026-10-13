import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { corruptEvent, insertBoundHistoryEvent } from './invoiceEventPdfRead.fixture.js';
import { createEventScanFixture } from './invoiceHistoryEventScan.fixture.js';
import { invoiceHistoryEventScanSql, validateInvoiceHistoryEvents } from './invoiceHistoryEventScan.js';
import { SqliteInvoiceBackupArtifactCatalog } from './sqliteInvoiceBackupArtifactCatalog.js';

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

function open(path = ':memory:') {
  const database = new Database(path, { timeout: 0 });
  databases.push(database);
  return database;
}

describe('bounded event-history cursor lifecycle', () => {
  it('keeps all event rows in the catalog snapshot while another connection changes later history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-history-events-'));
    directories.push(root);
    const path = join(root, 'history.sqlite');
    const database = open(path);
    database.pragma('journal_mode = WAL');
    const f = await createEventScanFixture(database);
    insertBoundHistoryEvent(database, f.document, { id: 'zz-later' });
    const writer = open(path);
    writer.pragma('ignore_check_constraints = ON');
    const prepare = database.prepare.bind(database);
    let updated = false;
    let rows = 0;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql !== invoiceHistoryEventScanSql) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        cursor.next = () => {
          const row = next();
          if (!row.done) rows++;
          if (!updated && !row.done) {
            updated = true;
            writer.exec("UPDATE invoice_delivery_events SET status = 'unknown' WHERE id = 'zz-later'");
          }
          return row;
        };
        return cursor;
      };
      return statement;
    });
    const catalog = new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory');
    await expect(catalog.listAuthoritativeArtifacts()).resolves.toHaveLength(1);
    expect(updated).toBe(true);
    expect(rows).toBe(2);
    await expect(catalog.listAuthoritativeArtifacts()).rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
    expect(database.inTransaction).toBe(false);
  });

  it.each(['success', 'validation', 'native'] as const)('closes after %s, retaining the first error if close also fails', async failure => {
    const database = open();
    const f = await createEventScanFixture(database);
    insertBoundHistoryEvent(database, f.document, { id: 'zz-later' });
    if (failure === 'validation') corruptEvent(database, "status = 'unknown'", 'zz-later');
    const prepare = database.prepare.bind(database);
    const first = Object.assign(new Error('SYNTHETIC_NATIVE_ERROR'), { code: 'SQLITE_NOMEM' });
    const cleanup = new Error('SYNTHETIC_CLOSE_ERROR');
    let closes = 0;
    let busy: boolean | undefined;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql !== invoiceHistoryEventScanSql) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        const close = cursor.return?.bind(cursor);
        let calls = 0;
        cursor.next = () => {
          if (failure === 'native' && ++calls === 2) throw first;
          return next();
        };
        cursor.return = () => { closes++; close?.(); busy = statement.busy; throw cleanup; };
        return cursor;
      };
      return statement;
    });
    const before = database.serialize();
    expect(() => database.transaction(() => validateInvoiceHistoryEvents(database)).deferred())
      .toThrow(failure === 'native' ? first : failure === 'validation' ? InvoiceDocumentIntegrityError : cleanup);
    expect(closes).toBe(1);
    expect(busy).toBe(false);
    expect(database.inTransaction).toBe(false);
    expect(database.serialize()).toEqual(before);
  });

  it('does not accept a cursor that reports remaining native work after return', async () => {
    const database = open();
    await createEventScanFixture(database);
    const prepare = database.prepare.bind(database);
    let release: (() => unknown) | undefined;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql === invoiceHistoryEventScanSql) {
        const iterate = statement.iterate.bind(statement);
        statement.iterate = (...args: unknown[]) => {
          const cursor = iterate(...args);
          cursor.next();
          release = cursor.return?.bind(cursor);
          cursor.next = () => ({ done: true, value: undefined });
          cursor.return = () => ({ done: true, value: undefined });
          return cursor;
        };
      }
      return statement;
    });
    database.exec('BEGIN');
    try {
      expect(() => validateInvoiceHistoryEvents(database)).toThrow(InvoiceDocumentIntegrityError);
    } finally {
      // This fixture deliberately breaks cursor.return; release its native read
      // before asking SQLite to finish the owning transaction.
      release?.();
      database.exec('ROLLBACK');
    }
    expect(database.inTransaction).toBe(false);
  });
});
