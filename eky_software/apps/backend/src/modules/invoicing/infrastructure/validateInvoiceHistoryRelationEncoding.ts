import { TextDecoder } from 'node:util';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import {
  invoiceHistoryRelationScanSql, invoiceHistoryRelationSources, invoiceHistoryTextChunkBytes,
  type InvoiceHistoryRelationChunk, type InvoiceHistoryRelationSource,
} from './invoiceHistoryRelationScan.js';

export function validateInvoiceHistoryRelationEncoding(database: DatabaseConnection): void {
  if (!database.inTransaction) fail();
  const encoding = database.pragma('encoding', { simple: true });
  if (encoding !== 'UTF-8' && encoding !== 'UTF-16le' && encoding !== 'UTF-16be') fail();
  for (const source of Object.keys(invoiceHistoryRelationSources) as InvoiceHistoryRelationSource[]) {
    validateSource(database, source, encoding);
  }
}

function validateSource(database: DatabaseConnection, source: InvoiceHistoryRelationSource, encoding: string): void {
  const statement = database.prepare<{ chunkBytes: number }, InvoiceHistoryRelationChunk>(invoiceHistoryRelationScanSql(source));
  const cursor = statement.iterate({ chunkBytes: invoiceHistoryTextChunkBytes });
  let ordinal = 0;
  let fieldIndex = 0;
  let offset = 0;
  let byteLength: number | undefined;
  let decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
  let failed = false;
  let firstError: unknown;
  try {
    while (true) {
      const result = cursor.next();
      if (result.done) break;
      const row = result.value;
      if (row.ordinal !== ordinal || row.field_index !== fieldIndex || row.byte_offset !== offset
        || !Number.isSafeInteger(row.byte_length) || row.byte_length < 0
        || (byteLength !== undefined && byteLength !== row.byte_length)) fail();
      byteLength = row.byte_length;
      if (row.kind === 'text') {
        const part = row.byte_length === 0 && row.part === null ? Buffer.alloc(0) : row.part;
        if (!Buffer.isBuffer(part) || part.length !== Math.min(invoiceHistoryTextChunkBytes, row.byte_length - offset)) fail();
        decode(decoder, part, true);
        offset += part.length;
        if (offset !== row.byte_length) continue;
        decode(decoder, undefined, false);
      } else {
        // This guard adds only the approved text-encoding rule. Existing callers still own type/null rules.
        if (offset !== 0 || row.byte_length !== 0 || row.part !== null
          || !['null', 'integer', 'real', 'blob'].includes(row.kind)) fail();
      }
      fieldIndex++;
      if (fieldIndex === invoiceHistoryRelationSources[source].fields.length) { ordinal++; fieldIndex = 0; }
      offset = 0;
      byteLength = undefined;
      decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
    }
    if (byteLength !== undefined || fieldIndex !== 0) fail();
  } catch (error) {
    failed = true;
    firstError = error;
  } finally {
    try {
      cursor.return?.();
      if (statement.busy) fail();
    } catch (error) {
      if (!failed) { failed = true; firstError = error; }
    }
  }
  if (failed) throw firstError;
}

function decode(decoder: TextDecoder, part: Buffer | undefined, stream: boolean): void {
  try { decoder.decode(part, { stream }); } catch (error) {
    if (error instanceof TypeError && 'code' in error && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') fail();
    throw error;
  }
}

function fail(): never { throw new InvoiceContentRevisionIntegrityError(); }
