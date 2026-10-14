// These are the attested revision-history schema's keys and the approved encoding-policy fields.
// The two older rowid tables permit NULL text IDs; using their real rowid avoids skipping those rows.
export const invoiceHistoryRelationSources = {
  invoices: { keys: ['_rowid_'], fields: ['id', 'company_id'] },
  invoice_lines: { keys: ['_rowid_'], fields: ['id', 'invoice_id', 'source_invoice_line_id'] },
  invoice_content_revisions: {
    keys: ['id'], fields: ['id', 'company_id', 'invoice_id', 'credited_invoice_id', 'credited_revision_id'],
  },
  invoice_revision_lines: {
    keys: ['revision_id', 'line_id'],
    fields: ['company_id', 'invoice_id', 'revision_id', 'line_id', 'source_revision_id', 'source_invoice_line_id'],
  },
  invoice_revision_vat_breakdown: {
    keys: ['revision_id', 'vat_rate_basis_points'], fields: ['company_id', 'invoice_id', 'revision_id'],
  },
  invoice_current_revisions: {
    keys: ['company_id', 'invoice_id'], fields: ['company_id', 'invoice_id', 'revision_id'],
  },
  invoice_documents: {
    keys: ['id'], fields: ['id', 'company_id', 'invoice_id', 'revision_id', 'source_document_id'],
  },
  invoice_delivery_events: {
    keys: ['id'], fields: ['id', 'company_id', 'invoice_id', 'revision_id', 'document_id'],
  },
} as const;

export type InvoiceHistoryRelationSource = keyof typeof invoiceHistoryRelationSources;

// Existing mapper nonblank fields, NOT additions to the strict encoding-policy list above.
export const invoiceRevisionIdentifierFields = {
  invoice_content_revisions: [
    'company_id', 'invoice_id', 'id', 'source_draft_id', 'credited_invoice_id', 'credited_revision_id',
    'series_key', 'sequence_scope', 'customer_id', 'billing_recipient_customer_id',
  ],
  invoice_revision_lines: ['line_id', 'invoice_id', 'source_invoice_line_id', 'source_revision_id', 'description', 'unit'],
} as const;
export type InvoiceRevisionIdentifierSource = keyof typeof invoiceRevisionIdentifierFields;

// Transport allocation, not an accepted identifier-length or history-size limit.
export const invoiceHistoryTextChunkBytes = 16 * 1024;

export interface InvoiceHistoryRelationChunk {
  ordinal: number;
  field_index: number;
  byte_offset: number;
  kind: string;
  byte_length: number;
  part: Buffer | null;
}

export function invoiceHistoryRelationScanSql(source: InvoiceHistoryRelationSource): string {
  if (!Object.hasOwn(invoiceHistoryRelationSources, source)) throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
  const { keys, fields } = invoiceHistoryRelationSources[source];
  return textScanSql(source, keys, fields);
}

export function invoiceRevisionIdentifierScanSql(source: InvoiceRevisionIdentifierSource): string {
  if (!Object.hasOwn(invoiceRevisionIdentifierFields, source)) throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
  return textScanSql(source, invoiceHistoryRelationSources[source].keys, invoiceRevisionIdentifierFields[source]);
}

// Only the two closed selections above can supply identifiers to this query.
function textScanSql(source: InvoiceHistoryRelationSource, keys: readonly string[], fields: readonly string[]): string {
  const keyNames = keys.map((_, index) => `key_${index}`);
  const selection = (alias: string) => `CASE scan.field_index ${fields.map((field, index) =>
    `WHEN ${index} THEN ${alias}.${field}`).join(' ')} END`;
  const value = selection('current_row');
  const moreBytes = `(typeof(${value}) = 'text' AND scan.byte_offset + @chunkBytes < length(CAST(${value} AS BLOB)))`;
  const keepRow = `(${moreBytes} OR scan.field_index < ${fields.length - 1})`;
  const keyTuple = (alias: string) => `(${keys.map(key => `${alias}.${key}`).join(', ')})`;
  const scanTuple = `(${keyNames.map(key => `scan.${key}`).join(', ')})`;
  const selectedValue = selection('value');
  // One seed and at most one successor keep traversal keys in SQLite. UNION ALL avoids a visited-row set.
  return `WITH RECURSIVE scan(${keyNames.join(', ')}, ordinal, field_index, byte_offset) AS (
    SELECT ${keyNames.join(', ')}, 0, 0, 0 FROM (
      SELECT ${keys.map((key, index) => `${key} AS ${keyNames[index]}`).join(', ')} FROM ${source} ORDER BY ${keys.join(', ')} LIMIT 1
    )
    UNION ALL
    SELECT ${keys.map((key, index) => `CASE WHEN ${keepRow} THEN scan.${keyNames[index]} ELSE successor.${key} END`).join(', ')},
      scan.ordinal + CASE WHEN ${keepRow} THEN 0 ELSE 1 END,
      CASE WHEN ${moreBytes} THEN scan.field_index WHEN ${keepRow} THEN scan.field_index + 1 ELSE 0 END,
      CASE WHEN ${moreBytes} THEN scan.byte_offset + @chunkBytes ELSE 0 END
    FROM scan
    JOIN ${source} current_row ON ${keyTuple('current_row')} = ${scanTuple}
    LEFT JOIN ${source} successor ON NOT ${keepRow} AND ${keyTuple('successor')} = (
      SELECT ${keys.join(', ')} FROM ${source} next_row
      WHERE ${keyTuple('next_row')} > ${scanTuple} ORDER BY ${keys.join(', ')} LIMIT 1
    )
    WHERE ${keepRow} OR successor.${keys[0]} IS NOT NULL
  )
  SELECT scan.ordinal, scan.field_index, scan.byte_offset,
    typeof(${selectedValue}) AS kind,
    CASE WHEN typeof(${selectedValue}) = 'text' THEN length(CAST(${selectedValue} AS BLOB)) ELSE 0 END AS byte_length,
    CASE WHEN typeof(${selectedValue}) = 'text'
      THEN substr(CAST(${selectedValue} AS BLOB), scan.byte_offset + 1, @chunkBytes) ELSE NULL END AS part
  FROM scan JOIN ${source} value ON ${keyTuple('value')} = ${scanTuple}`;
}
