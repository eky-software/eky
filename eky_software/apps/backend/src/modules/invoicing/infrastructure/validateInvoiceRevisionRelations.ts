import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { invoiceKinds } from '../domain/invoiceKind.js';
import { validateInvoiceRevisionSourceBinding } from './invoiceContentRevisionPersistenceRows.js';

const statuses = ['approved', 'sent', 'cancelled', 'reopened_for_edit'] as const;
function smallText(column: string, values: readonly string[]): string {
  const limit = Math.max(...values.map(value => Math.max(Buffer.byteLength(value), value.length * 2))) + 1;
  return `CASE WHEN typeof(${column}) = 'text' AND length(CAST(${column} AS BLOB)) <= ${limit} THEN ${column} ELSE NULL END`;
}

export const invoiceRevisionRelationQueries = {
  invoices: `SELECT ${smallText('live.status', statuses)} AS status,
    EXISTS(SELECT 1 FROM invoice_content_revisions stored WHERE stored.company_id = live.company_id
      AND stored.invoice_id = live.id) AS has_history,
    EXISTS(SELECT 1 FROM invoice_current_revisions current WHERE current.company_id = live.company_id
      AND current.invoice_id = live.id) AS has_current
    FROM invoices live`,
  headers: `SELECT ${smallText('stored.invoice_kind', invoiceKinds)} AS invoice_kind,
    EXISTS(SELECT 1 FROM invoices live WHERE typeof(live.id) = 'text' AND typeof(live.company_id) = 'text'
      AND live.id = stored.invoice_id AND live.company_id = stored.company_id) AS has_invoice,
    COALESCE(source.company_id = stored.company_id AND source.invoice_id = stored.credited_invoice_id, 0) AS source_matches,
    ${smallText('source.invoice_kind', invoiceKinds)} AS source_kind
    FROM invoice_content_revisions stored
    LEFT JOIN invoice_content_revisions source ON source.id = stored.credited_revision_id`,
  current: `SELECT COALESCE(typeof(current.company_id) = 'text' AND typeof(current.invoice_id) = 'text'
      AND typeof(current.revision_id) = 'text' AND live.id = current.invoice_id
      AND live.company_id = current.company_id AND stored.invoice_id = current.invoice_id
      AND stored.company_id = current.company_id, 0) AS scope_matches
    FROM invoice_current_revisions current
    LEFT JOIN invoices live ON live.id = current.invoice_id
    LEFT JOIN invoice_content_revisions stored ON stored.id = current.revision_id`,
  sourceLines: `SELECT 1 AS invalid FROM invoice_revision_lines line
    WHERE line.source_invoice_line_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM invoice_revision_lines source WHERE source.revision_id = line.source_revision_id
        AND source.line_id = line.source_invoice_line_id) LIMIT 1`,
  currentLines: `SELECT 1 AS invalid FROM invoice_current_revisions current
    JOIN invoice_revision_lines stored ON stored.revision_id = current.revision_id
    WHERE NOT EXISTS(SELECT 1 FROM invoice_lines live WHERE live.invoice_id = current.invoice_id
      AND live.line_order = stored.line_order)
    UNION ALL
    SELECT 1 FROM invoice_current_revisions current JOIN invoice_lines live ON live.invoice_id = current.invoice_id
    WHERE NOT EXISTS(SELECT 1 FROM invoice_revision_lines stored WHERE stored.revision_id = current.revision_id
      AND stored.line_order = live.line_order) LIMIT 1`,
  sourceGuard: `SELECT ${smallText('live.invoice_kind', invoiceKinds)} AS invoice_kind,
    live.credited_invoice_id IS NOT NULL AS credited_invoice_present,
    stored.credited_revision_id IS NOT NULL AS source_present,
    stored.company_id = live.company_id AS source_company_matches
    FROM invoice_current_revisions current
    JOIN invoices live ON live.id = current.invoice_id
    JOIN invoice_content_revisions stored ON stored.id = current.revision_id`,
} as const;

export function validateInvoiceRevisionRelations(database: DatabaseConnection): void {
  if (!database.inTransaction) fail();
  scan(database, invoiceRevisionRelationQueries.invoices, row => {
    if (!statuses.includes(row.status as typeof statuses[number]) || row.has_history !== 1 ||
      row.has_current !== (row.status === 'reopened_for_edit' ? 0 : 1)) fail();
  });
  scan(database, invoiceRevisionRelationQueries.headers, row => {
    if (row.has_invoice !== 1 || (row.invoice_kind === 'credit' &&
      (row.source_matches !== 1 || row.source_kind !== 'standard'))) fail();
  });
  scan(database, invoiceRevisionRelationQueries.current, row => { if (row.scope_matches !== 1) fail(); });
  for (const sql of [invoiceRevisionRelationQueries.sourceLines, invoiceRevisionRelationQueries.currentLines]) {
    if (database.prepare(sql).get() !== undefined) fail();
  }
}

// Call only after the exact current-header pairs passed in the same snapshot:
// credited_invoice_id has been compared as decoded text, NOT SQL byte equality.
export function validateInvoiceRevisionCurrentSourceGuards(database: DatabaseConnection): void {
  if (!database.inTransaction) fail();
  scan(database, invoiceRevisionRelationQueries.sourceGuard, row => {
    validateInvoiceRevisionSourceBinding({
      invoiceKind: row.invoice_kind,
      creditedInvoicePresent: row.credited_invoice_present === 1,
      sourcePresent: row.source_present === 1,
      sourceCompanyMatches: row.source_company_matches === 1,
      sourceInvoiceMatches: row.source_present === 1,
    });
  });
}

function scan(database: DatabaseConnection, sql: string, validate: (row: Record<string, unknown>) => void): void {
  const statement = database.prepare<[], Record<string, unknown>>(sql);
  const cursor = statement.iterate();
  let failed = false;
  let firstError: unknown;
  try {
    while (true) {
      const result = cursor.next();
      if (result.done) break;
      validate(result.value);
    }
  } catch (error) { failed = true; firstError = error; }
  finally {
    try { cursor.return?.(); if (statement.busy) fail(); }
    catch (error) { if (!failed) { failed = true; firstError = error; } }
  }
  if (failed) throw firstError;
}

function fail(): never { throw new InvoiceContentRevisionIntegrityError(); }
