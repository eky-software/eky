import { TextDecoder } from 'node:util';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { invoiceHistoryTextChunkBytes } from './invoiceHistoryRelationScan.js';

// Preserve the ordinary driver's SQLite-to-UTF-8 conversion, including malformed free text.
// This is not the separate fatal relation-identifier encoding guard.
export function createInvoiceHistoryTextDecoder(database: DatabaseConnection, encoding: string) {
  if (encoding === 'UTF-8') return new TextDecoder('utf-8', { ignoreBOM: true });
  if (encoding !== 'UTF-16le' && encoding !== 'UTF-16be') throw new InvoiceContentRevisionIntegrityError();
  const convert = database.prepare<[Buffer], { value: string }>('SELECT CAST(? AS TEXT) AS value');
  const replaceInvalid = database.prepare<[], { enabled: number }>(
    "SELECT sqlite_compileoption_used('REPLACE_INVALID_UTF') AS enabled",
  ).get()!.enabled === 1;
  const codeUnit = encoding === 'UTF-16le'
    ? (bytes: Buffer, offset: number) => bytes.readUInt16LE(offset)
    : (bytes: Buffer, offset: number) => bytes.readUInt16BE(offset);
  let pending = Buffer.alloc(0);
  return {
    decode(part: Buffer = Buffer.alloc(0), options?: { stream: boolean }): string {
      if (part.length > invoiceHistoryTextChunkBytes) throw new InvoiceContentRevisionIntegrityError();
      const bytes = pending.length ? Buffer.concat([pending, part]) : part;
      let end = 0;
      while (end + 1 < bytes.length) {
        const unit = codeUnit(bytes, end);
        const startsPair = replaceInvalid ? unit >= 0xd800 && unit < 0xdc00 : unit >= 0xd800 && unit < 0xe000;
        if (startsPair) {
          if (end + 3 >= bytes.length) break;
          const next = codeUnit(bytes, end + 2);
          end += !replaceInvalid || (next >= 0xdc00 && next < 0xe000) ? 4 : 2;
        } else end += 2;
      }
      // SQLite ignores a final odd byte. Let SQLite, not a second decoder, handle the terminal fragment.
      if (!options?.stream) end = bytes.length;
      pending = Buffer.from(bytes.subarray(end));
      if (end === 0) return '';
      const result = convert.get(bytes.subarray(0, end));
      if (typeof result?.value !== 'string') throw new InvoiceContentRevisionIntegrityError();
      return result.value;
    },
  };
}
