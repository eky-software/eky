import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import {
  validateInvoiceEventDocumentBinding, validateInvoiceEventReference, type InvoiceEventDocumentBindingFacts,
} from './invoiceEventDocumentBinding.js';

interface EventFactsRow {
  legacy_original: number;
  legacy_fields_valid: number;
  document_absent: number;
  invoice_exists: number;
  document_kind: InvoiceEventDocumentBindingFacts['documentKind'] | null;
  kind_matches: number;
  revision_matches: number;
  revision_mode_allowed: number;
  preserved_legacy_fields_valid: number;
  evidence_matches: number;
  enums_valid: number;
  delivery_mode_valid: number;
  duplicate_unresolved: number;
}

// Relation encodings and all bounded document metadata have already been checked
// in this snapshot. Native keys stay in SQLite; only fixed-size facts reach JS.
export const invoiceHistoryEventScanSql = `
  SELECT
    event.binding_kind = 'legacyOriginal' AS legacy_original,
    event.revision_id IS NULL AND event.send_mode = 'legacyUnknown'
      AND event.document_sha256 IS NULL AND event.document_size_bytes IS NULL AS legacy_fields_valid,
    event.document_id IS NULL AS document_absent,
    EXISTS(SELECT 1 FROM invoices WHERE company_id = event.company_id AND id = event.invoice_id) AS invoice_exists,
    CASE document.binding_kind WHEN 'revision' THEN 'revision' WHEN 'legacyOriginal' THEN 'legacyOriginal'
      WHEN 'preservedLegacy' THEN 'preservedLegacy' ELSE NULL END AS document_kind,
    COALESCE(document.binding_kind = event.binding_kind, 0) AS kind_matches,
    COALESCE(document.revision_id = event.revision_id, 0) AS revision_matches,
    event.send_mode IN ('customer', 'smtpTest', 'dryRun', 'manual') AS revision_mode_allowed,
    event.revision_id IS NULL AND event.send_mode = 'customer' AS preserved_legacy_fields_valid,
    COALESCE(document.sha256 = event.document_sha256 AND document.size_bytes = event.document_size_bytes
      AND typeof(event.document_size_bytes) IN ('integer', 'real'), 0) AS evidence_matches,
    event.status IN ('prepared', 'attempted', 'succeeded', 'failed', 'outcomeUnknown')
      AND event.delivery_method IN ('email', 'manual', 'print', 'other')
      AND event.provider IN ('dryRun', 'smtp', 'gmail', 'microsoft', 'manual', 'other') AS enums_valid,
    ((event.send_mode IN ('customer', 'smtpTest') AND event.delivery_method = 'email' AND event.provider = 'smtp')
      OR (event.send_mode = 'dryRun' AND event.delivery_method = 'email' AND event.provider = 'dryRun')
      OR (event.send_mode = 'manual' AND event.delivery_method IN ('manual', 'print') AND event.provider = 'manual'))
      AS delivery_mode_valid,
    CASE WHEN event.binding_kind <> 'legacyOriginal' AND event.provider = 'smtp'
      AND event.status IN ('attempted', 'outcomeUnknown') THEN EXISTS (
        SELECT 1 FROM invoice_delivery_events other
        WHERE other.company_id = event.company_id AND other.invoice_id = event.invoice_id
          AND other.binding_kind <> 'legacyOriginal' AND other.provider = 'smtp'
          AND other.status IN ('attempted', 'outcomeUnknown') AND other.id <> event.id
      ) ELSE 0 END AS duplicate_unresolved
  FROM invoice_delivery_events event
  LEFT JOIN invoice_documents document ON document.company_id = event.company_id
    AND document.invoice_id = event.invoice_id AND document.id = event.document_id
`;

export function validateInvoiceHistoryEvents(database: DatabaseConnection): void {
  if (!database.inTransaction) fail();
  const statement = database.prepare<[], EventFactsRow>(invoiceHistoryEventScanSql);
  const cursor = statement.iterate();
  let failed = false;
  let firstError: unknown;
  try {
    while (true) {
      const result = cursor.next();
      if (result.done) break;
      validateEventFacts(result.value);
    }
  } catch (error) { failed = true; firstError = error; }
  finally {
    try {
      cursor.return?.();
      if (statement.busy) fail();
    } catch (error) { if (!failed) { failed = true; firstError = error; } }
  }
  if (failed) throw firstError;
}

function validateEventFacts(row: EventFactsRow): void {
  if (row.enums_valid !== 1) fail();
  const reference = validateInvoiceEventReference({
    legacyOriginal: row.legacy_original === 1,
    legacyFieldsValid: row.legacy_fields_valid === 1,
    documentAbsent: row.document_absent === 1,
  });
  if (reference === 'legacyMissingDocument') {
    if (row.invoice_exists !== 1) fail();
  } else {
    validateInvoiceEventDocumentBinding({
      documentKind: row.document_kind ?? undefined,
      kindMatches: row.kind_matches === 1,
      revisionMatches: row.revision_matches === 1,
      revisionModeAllowed: row.revision_mode_allowed === 1,
      preservedLegacyFieldsValid: row.preserved_legacy_fields_valid === 1,
      evidenceMatches: row.evidence_matches === 1,
    });
  }
  if (row.legacy_original === 1) return;
  if (row.delivery_mode_valid !== 1 || row.duplicate_unresolved !== 0) fail();
}

function fail(): never { throw new InvoiceDocumentIntegrityError(); }
