import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { invoiceRevisionPairScanSql } from './invoiceRevisionPairScanSql.js';
import { bypassReaderFixtureConstraints } from './sqliteInvoiceContentRevisionReader.fixture.js';
import { closePublicationDatabases, createPublicationFixture, openPublicationDatabase } from './sqliteInvoiceDocumentPublication.fixture.js';
import { validateInvoiceRevisionPairs } from './validateInvoiceRevisionPairs.js';

const writers: Database.Database[] = [];
const roots: string[] = [];
afterEach(context => {
  vi.restoreAllMocks();
  const errors: unknown[] = [];
  for (const writer of writers.splice(0)) try { writer.close(); } catch (error) { errors.push(error); }
  try { closePublicationDatabases(); } catch (error) { errors.push(error); }
  const paths = roots.splice(0);
  if (errors.length) throw new AggregateError(errors, 'SYNTHETIC_DATABASE_CLOSE_FAILED');
  if (context.task.result?.state === 'pass') for (const path of paths) rmSync(path, { recursive: true, force: true });
});

const queries = [invoiceRevisionPairScanSql('currentHeaders', 0), invoiceRevisionPairScanSql('currentHeaders', 1)];
describe('paired revision reader ownership', () => {
  it.each(['success', 'left read', 'right read', 'mismatch', 'right start'])(
    'keeps %s separate from both close failures', async variant => {
      const database = openPublicationDatabase();
      await createPublicationFixture(database);
      const prepare = database.prepare.bind(database);
      const original = Object.assign(new Error('SYNTHETIC_NATIVE_FAILURE'), { code: 'SQLITE_NOMEM' });
      const cleanup = new Error('SYNTHETIC_CLOSE_FAILURE');
      const closes = [0, 0];
      vi.spyOn(database, 'prepare').mockImplementation(sql => {
        const statement = prepare(sql);
        const side = queries.indexOf(sql);
        if (side < 0) return statement;
        const iterate = statement.iterate.bind(statement);
        statement.iterate = (...args: unknown[]) => {
          if (side === 1 && variant === 'right start') throw original;
          const cursor = iterate(...args);
          const next = cursor.next.bind(cursor);
          const close = cursor.return?.bind(cursor);
          let reads = 0;
          cursor.next = () => {
            if (++reads === 2 && variant === (side === 0 ? 'left read' : 'right read')) throw original;
            const result = next();
            if (variant === 'mismatch' && side === 1 && reads === 2 && !result.done) {
              return { done: false, value: { ...(result.value as object), kind: 'blob', part: null } };
            }
            return result;
          };
          cursor.return = () => { closes[side] = (closes[side] ?? 0) + 1; close?.(); throw cleanup; };
          return cursor;
        };
        return statement;
      });
      const before = database.serialize();
      expect(() => database.transaction(() => validateInvoiceRevisionPairs(database)).deferred())
        .toThrow(variant === 'success' ? cleanup : variant === 'mismatch' ? InvoiceContentRevisionIntegrityError : original);
      expect(closes).toEqual(variant === 'right start' ? [1, 0] : [1, 1]);
      expect(database.inTransaction).toBe(false);
      expect(database.serialize().equals(before)).toBe(true);
    },
  );

  it.each([0, 1])('refuses a prematurely ended but still busy reader on side %i', async side => {
    const database = openPublicationDatabase();
    await createPublicationFixture(database);
    const prepare = database.prepare.bind(database);
    let release: (() => unknown) | undefined;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql !== queries[side]) return statement;
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
    try { expect(() => validateInvoiceRevisionPairs(database)).toThrow(InvoiceContentRevisionIntegrityError); }
    finally { release?.(); database.exec('ROLLBACK'); }
  });

  it('keeps both sides in one WAL snapshot despite another writer changing the next field', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-revision-pairs-'));
    roots.push(root);
    const path = join(root, 'history.sqlite');
    const database = openPublicationDatabase(path);
    database.pragma('journal_mode = WAL');
    await createPublicationFixture(database);
    const writer = new Database(path, { timeout: 0 });
    writers.push(writer);
    const prepare = database.prepare.bind(database);
    let changed = false;
    vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql !== queries[0]) return statement;
      const iterate = statement.iterate.bind(statement);
      statement.iterate = (...args: unknown[]) => {
        const cursor = iterate(...args);
        const next = cursor.next.bind(cursor);
        cursor.next = () => {
          const result = next();
          if (!changed && !result.done) {
            changed = true;
            bypassReaderFixtureConstraints(writer, 'invoices', () => writer.exec("UPDATE invoices SET note = 'concurrent change'"));
          }
          return result;
        };
        return cursor;
      };
      return statement;
    });
    expect(() => database.transaction(() => validateInvoiceRevisionPairs(database)).deferred()).not.toThrow();
    expect(changed).toBe(true);
    expect(() => database.transaction(() => validateInvoiceRevisionPairs(database)).deferred()).toThrow(InvoiceContentRevisionIntegrityError);
  });
});
