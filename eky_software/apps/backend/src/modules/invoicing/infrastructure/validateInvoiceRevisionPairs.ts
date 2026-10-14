import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { createInvoiceHistoryTextDecoder } from './createInvoiceHistoryTextDecoder.js';
import { invoiceHistoryTextChunkBytes, type InvoiceHistoryRelationChunk } from './invoiceHistoryRelationScan.js';
import { invoiceRevisionPairFieldCount, invoiceRevisionPairScanSql, invoiceRevisionPairSources, type InvoiceRevisionPairSource } from './invoiceRevisionPairScanSql.js';

interface PairChunk extends InvoiceHistoryRelationChunk { number_value: number | null }
type Cursor = IterableIterator<PairChunk>;
type Decoder = ReturnType<typeof createInvoiceHistoryTextDecoder>;

// Relation/scalar checks precede this comparison in the same snapshot. Neither
// stored keys nor an entire text value are returned to the caller.
export function validateInvoiceRevisionPairs(database: DatabaseConnection): void {
  if (!database.inTransaction) fail();
  const encoding = database.pragma('encoding', { simple: true });
  if (encoding !== 'UTF-8' && encoding !== 'UTF-16le' && encoding !== 'UTF-16be') fail();
  for (const source of invoiceRevisionPairSources) compareSource(database, source, encoding);
}

function compareSource(database: DatabaseConnection, source: InvoiceRevisionPairSource, encoding: string): void {
  const readers = ([0, 1] as const).map(side => ({
    statement: database.prepare<{ chunkBytes: number }, PairChunk>(invoiceRevisionPairScanSql(source, side)),
    decoder: createInvoiceHistoryTextDecoder(database, encoding),
    cursor: undefined as Cursor | undefined,
  }));
  let failed = false;
  let firstError: unknown;
  try {
    for (const reader of readers) reader.cursor = reader.statement.iterate({ chunkBytes: invoiceHistoryTextChunkBytes });
    const [left, right] = readers;
    if (!left || !right) fail();
    let ordinal = 0;
    let field = 0;
    while (true) {
      const a = left.cursor!.next();
      const b = right.cursor!.next();
      if (a.done || b.done) {
        if (!a.done || !b.done || field !== 0) fail();
        break;
      }
      for (const chunk of [a.value, b.value]) {
        if (chunk.ordinal !== ordinal || chunk.field_index !== field || chunk.byte_offset !== 0) fail();
      }
      if (a.value.kind === 'text' && b.value.kind === 'text') {
        compareText(left.cursor!, right.cursor!, left.decoder, right.decoder, a.value, b.value);
      } else {
        for (const chunk of [a.value, b.value]) if (chunk.byte_length !== 0 || chunk.part !== null) fail();
        const numeric = (value: PairChunk) => value.kind === 'integer' || value.kind === 'real';
        if (!(a.value.kind === 'null' && b.value.kind === 'null') &&
          !(numeric(a.value) && numeric(b.value) && typeof a.value.number_value === 'number' &&
            a.value.number_value === b.value.number_value)) fail();
      }
      if (++field === invoiceRevisionPairFieldCount(source)) { field = 0; ordinal++; }
    }
  } catch (error) { failed = true; firstError = error; }
  finally {
    // Attempt both owned closes even when the first close fails.
    for (const reader of readers) {
      try {
        reader.cursor?.return?.();
        if (reader.statement.busy) fail();
      } catch (error) { if (!failed) { failed = true; firstError = error; } }
    }
  }
  if (failed) throw firstError;
}

function compareText(left: Cursor, right: Cursor, leftDecoder: Decoder, rightDecoder: Decoder, a: PairChunk, b: PairChunk): void {
  const states = [
    { cursor: left, decoder: leftDecoder, initial: a, next: a, offset: 0, text: '', ended: false },
    { cursor: right, decoder: rightDecoder, initial: b, next: b, offset: 0, text: '', ended: false },
  ];
  while (true) {
    for (const state of states) {
      while (!state.text.length && !state.ended) {
        const chunk = state.next;
        if (chunk.kind !== 'text' || chunk.ordinal !== state.initial.ordinal || chunk.field_index !== state.initial.field_index ||
          chunk.byte_length !== state.initial.byte_length || !Number.isSafeInteger(chunk.byte_length) || chunk.byte_length < 0 ||
          chunk.byte_offset !== state.offset) fail();
        const part = chunk.part === null && chunk.byte_length === 0 ? Buffer.alloc(0) : chunk.part;
        if (!Buffer.isBuffer(part) || part.length !== Math.min(invoiceHistoryTextChunkBytes, chunk.byte_length - state.offset)) fail();
        state.offset += part.length;
        state.text = state.decoder.decode(part, { stream: true });
        state.ended = state.offset === chunk.byte_length;
        if (state.ended) state.text += state.decoder.decode();
        else {
          const next = state.cursor.next();
          if (next.done) fail();
          state.next = next.value;
        }
      }
    }
    const [x, y] = states;
    if (!x || !y) fail();
    const count = Math.min(x.text.length, y.text.length);
    if (x.text.slice(0, count) !== y.text.slice(0, count)) fail();
    x.text = x.text.slice(count);
    y.text = y.text.slice(count);
    if (x.ended && !x.text.length && y.ended && !y.text.length) return;
    if ((x.ended && !x.text.length && y.text.length) || (y.ended && !y.text.length && x.text.length)) fail();
  }
}

function fail(): never { throw new InvoiceContentRevisionIntegrityError(); }
