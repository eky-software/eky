import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createInvoiceHistoryTextDecoder } from './createInvoiceHistoryTextDecoder.js';
import { invoiceHistoryTextChunkBytes } from './invoiceHistoryRelationScan.js';

const databases: Database.Database[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const database of databases.splice(0)) {
    try { database.close(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'SYNTHETIC_DATABASE_CLOSE_FAILED');
});

describe('invoice history text decoder native compatibility', () => {
  it.each(['UTF-16le', 'UTF-16be'])('preserves stored BOM units at real fragment boundaries in %s', encoding => {
    const database = new Database(':memory:');
    databases.push(database);
    database.pragma(`encoding = '${encoding}'`);
    database.exec('CREATE TABLE stored (value TEXT)');
    for (const text of ['\ufeffvalue', 'x'.repeat(invoiceHistoryTextChunkBytes / 2) + '\ufeffvalue']) {
      const bytes = Buffer.from(text, 'utf16le');
      if (encoding === 'UTF-16be') bytes.swap16();
      for (const raw of [bytes, Buffer.concat([bytes, Buffer.from([0x20])])]) {
        database.exec('DELETE FROM stored');
        database.prepare('INSERT INTO stored VALUES (CAST(? AS TEXT))').run(raw);
        // Fetch raw bytes independently, before requesting the text getter.
        const saved = database.prepare<[], { bytes: Buffer }>('SELECT CAST(value AS BLOB) AS bytes FROM stored').get()!.bytes;
        const expected = database.prepare<[], { value: string }>('SELECT value FROM stored').get()!.value;
        const decoder = createInvoiceHistoryTextDecoder(database, encoding);
        let decoded = '';
        for (let start = 0; start < saved.length; start += invoiceHistoryTextChunkBytes) {
          decoded += decoder.decode(saved.subarray(start, start + invoiceHistoryTextChunkBytes), { stream: true });
        }
        decoded += decoder.decode();
        expect(decoded === expected, JSON.stringify({ encoding, savedBytes: saved.length,
          actualLength: decoded.length, expectedLength: expected.length })).toBe(true);
      }
    }
  });

  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'])('matches exact driver text across every short byte boundary in %s', encoding => {
    const database = new Database(':memory:');
    databases.push(database);
    database.pragma(`encoding = '${encoding}'`);
    database.exec('CREATE TABLE stored (value TEXT)');
    const update = database.prepare<[Buffer]>('INSERT INTO stored VALUES (CAST(? AS TEXT))');
    const read = database.prepare<[], { value: string; bytes: Buffer }>('SELECT value, CAST(value AS BLOB) AS bytes FROM stored');
    const units = [0, 0x20, 0x61, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfffd, 0xfeff];
    const values = ['\uFEFFa\u0000\u{1f600}\uFEFFz', ...units.flatMap(first => units.map(second => String.fromCharCode(first, second)))];
    for (const value of values) {
      const raw = Buffer.from(value, encoding === 'UTF-8' ? 'utf8' : 'utf16le');
      if (encoding === 'UTF-16be') raw.swap16();
      for (const bytes of [raw, Buffer.concat([raw, Buffer.from([0x80])])]) {
        database.exec('DELETE FROM stored');
        update.run(bytes);
        const stored = read.get()!;
        for (let step = 1; step <= Math.max(1, stored.bytes.length); step++) {
          const decoder = createInvoiceHistoryTextDecoder(database, encoding);
          let decoded = '';
          for (let offset = 0; offset < stored.bytes.length; offset += step) {
            decoded += decoder.decode(stored.bytes.subarray(offset, offset + step), { stream: true });
          }
          decoded += decoder.decode();
          expect(decoded, `${encoding}:${bytes.toString('hex')}:${step}`).toBe(stored.value);
          // A completed field does not leak pending bytes or BOM state to the next field.
          expect(decoder.decode(stored.bytes)).toBe(stored.value);
        }
      }
    }
  });

  it.each(['UTF-16le', 'UTF-16be'])('delegates conversion to SQLite only for bounded fragments in %s', encoding => {
    const queries: string[] = [];
    const database = new Database(':memory:', { verbose: sql => queries.push(String(sql)) });
    databases.push(database);
    database.pragma(`encoding = '${encoding}'`);
    const decoder = createInvoiceHistoryTextDecoder(database, encoding);
    const prefix = ' '.repeat(invoiceHistoryTextChunkBytes / 2 - 1);
    const text = prefix + '\ud800\ud800' + '\uFEFFh\u0000';
    const bytes = Buffer.from(text, 'utf16le');
    if (encoding === 'UTF-16be') bytes.swap16();
    const expected = database.prepare<[Buffer], { value: string }>('SELECT CAST(? AS TEXT) AS value').get(bytes)!.value;
    expect(decoder.decode(bytes.subarray(0, invoiceHistoryTextChunkBytes), { stream: true }) +
      decoder.decode(bytes.subarray(invoiceHistoryTextChunkBytes))).toBe(expected);
    expect(queries.filter(sql => sql.includes('sqlite_compileoption_used'))).toHaveLength(1);
  });
});
