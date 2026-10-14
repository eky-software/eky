import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { invoiceKinds } from '../domain/invoiceKind.js';
import { fromInvoicePerformancePeriodColumns } from '../domain/invoicePerformancePeriod.js';
import { getInvoiceTaxTreatmentSnapshot, invoiceTaxTreatments } from '../domain/invoiceTaxTreatment.js';
import {
  addInvoiceRevisionVatGroup, validateInvoiceRevisionHeaderFacts, validateInvoiceRevisionLineRelations,
  validateInvoiceRevisionTotalStructure, validateInvoiceRevisionVatTotals,
} from './invoiceRevisionConsistency.js';
import { invoiceRevisionHeaderScanSql, invoiceRevisionLineScanSql, invoiceRevisionVatScanSql } from './invoiceRevisionScalarScanSql.js';
import {
  revisionDiscountTypes, revisionInteger as integer, revisionMember as member, revisionNullableText as nullableText,
  revisionNumberingModes, revisionOrigins, revisionPriceInputModes, revisionProvenance, revisionReferenceTypes,
} from './invoiceRevisionStoredValues.js';

type Facts = Record<string, unknown>;

// Schema, relation encoding and identifier/unit validation must precede these scans
// in the owning read transaction. No revision keys or unbounded strings reach JS.
export function validateInvoiceRevisionScalars(database: DatabaseConnection): void {
  if (!database.inTransaction) fail();
  scan(database, invoiceRevisionHeaderScanSql, validateHeader);
  scan(database, invoiceRevisionLineScanSql, validateLine);
  let totals = emptyTotals();
  let pendingGroup = false;
  scan(database, invoiceRevisionVatScanSql, row => {
    requireTrue(row.scope_matches);
    requireTrue(row.rate_has_line);
    // The attested (revision_id, rate) primary key prevents duplicate groups.
    addInvoiceRevisionVatGroup(totals, {
      vatRateBasisPoints: integer(row.vat_rate_basis_points),
      netCents: integer(row.net_cents), vatCents: integer(row.vat_cents), grossCents: integer(row.gross_cents),
    }, false);
    pendingGroup = true;
    if (flag(row.last_group)) {
      validateInvoiceRevisionVatTotals(amounts(row), totals);
      totals = emptyTotals();
      pendingGroup = false;
    }
  });
  if (pendingGroup) fail();
}

function validateHeader(row: Facts): void {
  requireTrue(row.text_types_valid);
  requireTrue(row.date_types_valid);
  integer(row.sequence_number, 1);
  integer(row.payment_term_days);
  integer(row.reminder_period_days, 0, 365);
  integer(row.late_payment_interest_basis_points, 0, 100000);
  member(row.numbering_mode, revisionNumberingModes);
  const referenceTypePresent = flag(row.reference_type_present);
  if (referenceTypePresent) member(row.reference_number_type, revisionReferenceTypes);
  const taxTreatment = member(row.tax_treatment, invoiceTaxTreatments);
  const expectedTax = getInvoiceTaxTreatmentSnapshot(taxTreatment);
  const hasVatGroups = flag(row.has_vat_groups);
  const provenance = revisionProvenance(row.origin, row.vat_breakdown_state, hasVatGroups);
  let performancePeriodValid = true;
  try {
    fromInvoicePerformancePeriodColumns({
      performanceDate: nullableText(row.performance_date),
      performancePeriodStart: nullableText(row.performance_period_start),
      performancePeriodEnd: nullableText(row.performance_period_end),
    });
  } catch { performancePeriodValid = false; }
  const totals = amounts(row);
  validateInvoiceRevisionHeaderFacts({
    ...totals,
    invoiceKind: member(row.invoice_kind, invoiceKinds),
    taxTreatment,
    priceInputMode: member(row.price_input_mode, revisionPriceInputModes),
    creditSourcePresent: [flag(row.credit_invoice_present), flag(row.credit_revision_present),
      flag(row.credit_number_present), flag(row.credit_date_present)],
    creditedInvoiceIsSelf: flag(row.credit_is_self),
    referenceNumberPresent: flag(row.reference_present),
    referenceNumberTypePresent: referenceTypePresent,
    performancePeriodValid,
    taxSnapshotMatches: row.tax_treatment_label_snapshot === expectedTax.label && row.tax_legal_basis_snapshot === expectedTax.legalBasis,
  });
  if (validateInvoiceRevisionTotalStructure({ ...totals, taxTreatment, ...provenance }, {
    hasLines: flag(row.has_lines), hasVatGroups,
  })) requireTrue(row.line_rates_have_groups);
}

function validateLine(row: Facts): void {
  requireTrue(row.text_types_valid);
  integer(row.line_order, 1);
  integer(row.quantity_hundredths);
  integer(row.unit_price_cents);
  integer(row.discount_value);
  integer(row.base_cents);
  integer(row.discount_cents);
  member(row.discount_type, revisionDiscountTypes);
  validateInvoiceRevisionLineRelations({
    invoiceKind: member(row.invoice_kind, invoiceKinds),
    origin: member(row.origin, revisionOrigins),
    taxTreatment: member(row.tax_treatment, invoiceTaxTreatments),
  }, {
    vatRateBasisPoints: flag(row.vat_rate_absent) ? null : integer(row.vat_rate_basis_points),
    netCents: integer(row.net_cents), vatCents: integer(row.vat_cents), grossCents: integer(row.gross_cents),
    invoiceMatches: flag(row.scope_matches),
    // Attested primary/unique keys enforce both per-revision uniqueness rules.
    duplicateLineId: false, duplicateLineOrder: false,
    sourceLinePresent: flag(row.source_line_present), sourceRevisionPresent: flag(row.source_revision_present),
    sourceRevisionMatchesCredit: flag(row.source_matches_credit),
  });
}

function amounts(row: Facts) {
  return { totalNetCents: integer(row.total_net_cents), totalVatCents: integer(row.total_vat_cents),
    totalGrossCents: integer(row.total_gross_cents) };
}
function emptyTotals() { return { netCents: 0n, vatCents: 0n, grossCents: 0n }; }
function flag(value: unknown): boolean { if (value !== 0 && value !== 1) fail(); return value === 1; }
function requireTrue(value: unknown): void { if (!flag(value)) fail(); }

function scan(database: DatabaseConnection, sql: string, validate: (row: Facts) => void): void {
  const statement = database.prepare<[], Facts>(sql);
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
    try {
      cursor.return?.();
      if (statement.busy) fail();
    } catch (error) { if (!failed) { failed = true; firstError = error; } }
  }
  if (failed) throw firstError;
}

function fail(): never { throw new InvoiceContentRevisionIntegrityError(); }
