import { invoiceRevisionHeaderCopyFields, invoiceRevisionLineCopyFields } from './invoiceContentRevisionPersistenceRows.js';

const currentLine = (alias: string) => `EXISTS(SELECT 1 FROM invoice_current_revisions current
  WHERE current.company_id = ${alias}.company_id AND current.invoice_id = ${alias}.invoice_id
    AND current.revision_id = ${alias}.revision_id)`;

// Closed projections only. Derived identities are checked by the relationship
// queries; provenance belongs to the stored revision, not the writer defaults.
const sources = {
  currentHeaders: {
    table: 'invoice_current_revisions', keys: ['_rowid_'],
    filter: (_alias: string) => '1',
    joins: `JOIN invoice_content_revisions stored ON stored.id = r.revision_id
      JOIN invoices live ON live.id = r.invoice_id`,
    fields: invoiceRevisionHeaderCopyFields.map(field => [`stored.${field}`, `live.${field}`]),
  },
  currentLines: {
    table: 'invoice_revision_lines', keys: ['revision_id', 'line_order'], filter: currentLine,
    joins: `JOIN invoice_lines live ON live.invoice_id = r.invoice_id AND live.line_order = r.line_order
      JOIN invoice_content_revisions header ON header.id = r.revision_id`,
    fields: [
      ...invoiceRevisionLineCopyFields.map(field => [`r.${field}`, `live.${field}`]),
      ['r.line_id', 'live.id'],
      ['r.source_revision_id', 'CASE WHEN live.source_invoice_line_id IS NULL THEN NULL ELSE header.credited_revision_id END'],
    ],
  },
  creditSources: {
    table: 'invoice_content_revisions', keys: ['id'],
    filter: (alias: string) => `${alias}.credited_revision_id IS NOT NULL`,
    joins: 'JOIN invoice_content_revisions source ON source.id = r.credited_revision_id',
    fields: [
      ['r.credited_invoice_number_snapshot', 'source.invoice_number'],
      ['r.credited_invoice_date_snapshot', 'source.invoice_date'],
    ],
  },
} as const;

export type InvoiceRevisionPairSource = keyof typeof sources;
export const invoiceRevisionPairSources = Object.keys(sources) as InvoiceRevisionPairSource[];

export function invoiceRevisionPairFieldCount(source: InvoiceRevisionPairSource): number {
  if (!Object.hasOwn(sources, source)) throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
  return sources[source].fields.length;
}

export function invoiceRevisionPairScanSql(source: InvoiceRevisionPairSource, side: 0 | 1): string {
  if (!Object.hasOwn(sources, source) || (side !== 0 && side !== 1)) throw new Error('INVOICE_BACKUP_CATALOG_INVALID');
  const { table, keys, filter, joins, fields } = sources[source];
  const keyNames = keys.map((_, index) => `key_${index}`);
  const tuple = (alias: string) => `(${keys.map(key => `${alias}.${key}`).join(', ')})`;
  const scanTuple = `(${keyNames.map(key => `scan.${key}`).join(', ')})`;
  const value = `CASE scan.field_index ${fields.map((pair, index) => `WHEN ${index} THEN ${pair[side]}`).join(' ')} END`;
  const moreBytes = `(typeof(${value}) = 'text' AND scan.byte_offset + @chunkBytes < length(CAST(${value} AS BLOB)))`;
  const keepRow = `(${moreBytes} OR scan.field_index < ${fields.length - 1})`;
  return `WITH RECURSIVE scan(${keyNames.join(', ')}, ordinal, field_index, byte_offset) AS (
    SELECT ${keyNames.join(', ')}, 0, 0, 0 FROM (
      SELECT ${keys.map((key, index) => `r.${key} AS ${keyNames[index]}`).join(', ')} FROM ${table} r
      WHERE ${filter('r')} ORDER BY ${keys.map(key => `r.${key}`).join(', ')} LIMIT 1
    )
    UNION ALL
    SELECT ${keys.map((key, index) => `CASE WHEN ${keepRow} THEN scan.${keyNames[index]} ELSE successor.${key} END`).join(', ')},
      scan.ordinal + CASE WHEN ${keepRow} THEN 0 ELSE 1 END,
      CASE WHEN ${moreBytes} THEN scan.field_index WHEN ${keepRow} THEN scan.field_index + 1 ELSE 0 END,
      CASE WHEN ${moreBytes} THEN scan.byte_offset + @chunkBytes ELSE 0 END
    FROM scan JOIN ${table} r ON ${tuple('r')} = ${scanTuple} ${joins}
    LEFT JOIN ${table} successor ON NOT ${keepRow} AND ${tuple('successor')} = (
      SELECT ${keys.map(key => `next_row.${key}`).join(', ')} FROM ${table} next_row
      WHERE ${tuple('next_row')} > ${scanTuple} AND ${filter('next_row')}
      ORDER BY ${keys.map(key => `next_row.${key}`).join(', ')} LIMIT 1
    )
    WHERE ${keepRow} OR successor.${keys[0]} IS NOT NULL
  )
  SELECT scan.ordinal, scan.field_index, scan.byte_offset, typeof(${value}) AS kind,
    CASE WHEN typeof(${value}) = 'text' THEN length(CAST(${value} AS BLOB)) ELSE 0 END AS byte_length,
    CASE WHEN typeof(${value}) = 'text' THEN substr(CAST(${value} AS BLOB), scan.byte_offset + 1, @chunkBytes) ELSE NULL END AS part,
    CASE WHEN typeof(${value}) IN ('integer', 'real') THEN ${value} ELSE NULL END AS number_value
  FROM scan JOIN ${table} r ON ${tuple('r')} = ${scanTuple} ${joins}`;
}
