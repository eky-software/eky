import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { createInvoiceHistoryTextDecoder } from './createInvoiceHistoryTextDecoder.js';
import {
  invoiceHistoryTextChunkBytes, invoiceRevisionIdentifierFields, invoiceRevisionIdentifierScanSql,
  type InvoiceHistoryRelationChunk, type InvoiceRevisionIdentifierSource,
} from './invoiceHistoryRelationScan.js';
import { maximumInvoiceRevisionUnitLength, validateInvoiceRevisionUnitLength } from './invoiceRevisionConsistency.js';
import { validateRevisionIdentifierContent } from './invoiceRevisionStoredValues.js';

export function validateInvoiceRevisionIdentifiers(database: DatabaseConnection): void {
  if (!database.inTransaction) fail();
  const encoding = database.pragma('encoding', { simple: true });
  if (encoding !== 'UTF-8' && encoding !== 'UTF-16le' && encoding !== 'UTF-16be') fail();
  validateSource(database, 'invoice_content_revisions', encoding);
  validateSource(database, 'invoice_revision_lines', encoding);
}

function validateSource(database: DatabaseConnection, source: InvoiceRevisionIdentifierSource, encoding: string): void {
  const fields = invoiceRevisionIdentifierFields[source];
  const decoder = createInvoiceHistoryTextDecoder(database, encoding);
  const statement = database.prepare<{ chunkBytes: number }, InvoiceHistoryRelationChunk>(invoiceRevisionIdentifierScanSql(source));
  const cursor = statement.iterate({ chunkBytes: invoiceHistoryTextChunkBytes });
  let ordinal = 0;
  let fieldIndex = 0;
  let offset = 0;
  let byteLength: number | undefined;
  let facts = emptyTextFacts();
  let failed = false;
  let firstError: unknown;
  try {
    while (true) {
      const result = cursor.next();
      if (result.done) break;
      const row = result.value;
      if (row.ordinal !== ordinal || row.field_index !== fieldIndex || row.byte_offset !== offset ||
        !Number.isSafeInteger(row.byte_length) || row.byte_length < 0 ||
        (byteLength !== undefined && byteLength !== row.byte_length)) fail();
      byteLength = row.byte_length;
      const field = fields[fieldIndex];
      if (row.kind === 'text') {
        const part = row.byte_length === 0 && row.part === null ? Buffer.alloc(0) : row.part;
        if (!Buffer.isBuffer(part) || part.length !== Math.min(invoiceHistoryTextChunkBytes, row.byte_length - offset)) fail();
        appendText(facts, decoder.decode(part, { stream: true }));
        offset += part.length;
        if (offset !== row.byte_length) continue;
        appendText(facts, decoder.decode());
        validateRevisionIdentifierContent(facts.hasContent);
        if (field === 'unit') validateInvoiceRevisionUnitLength(facts.trimmedLength);
      } else if (row.kind !== 'null' || offset !== 0 || row.byte_length !== 0 || row.part !== null ||
        !isNullableIdentifier(source, field)) {
        fail();
      }
      fieldIndex++;
      if (fieldIndex === fields.length) { ordinal++; fieldIndex = 0; }
      offset = 0;
      byteLength = undefined;
      facts = emptyTextFacts();
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

function isNullableIdentifier(source: InvoiceRevisionIdentifierSource, field: string | undefined): boolean {
  return source === 'invoice_content_revisions'
    ? field === 'credited_invoice_id' || field === 'credited_revision_id' || field === 'billing_recipient_customer_id'
    : field === 'source_invoice_line_id' || field === 'source_revision_id';
}

function emptyTextFacts() { return { hasContent: false, trimmedLength: 0, pendingWhitespace: 0 }; }

function appendText(facts: ReturnType<typeof emptyTextFacts>, text: string): void {
  const start = facts.hasContent ? 0 : text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  // Saturation distinguishes the existing unit rule's over-limit case; it never caps stored text.
  const overLimit = maximumInvoiceRevisionUnitLength + 1;
  if (end <= start) {
    if (facts.hasContent) facts.pendingWhitespace = Math.min(overLimit, facts.pendingWhitespace + text.length);
    return;
  }
  facts.trimmedLength = Math.min(overLimit, facts.trimmedLength + facts.pendingWhitespace + end - start);
  facts.pendingWhitespace = Math.min(overLimit, text.length - end);
  facts.hasContent = true;
}

function fail(): never { throw new InvoiceContentRevisionIntegrityError(); }
