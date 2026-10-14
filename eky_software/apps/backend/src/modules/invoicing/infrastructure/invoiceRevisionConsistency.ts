import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceVatBreakdown } from '../domain/invoiceCalculation.js';
import type { InvoiceContentRevision, InvoiceContentRevisionLine } from '../domain/invoiceContentRevision.js';

type RevisionAmounts = Pick<InvoiceContentRevision,
  'totalNetCents' | 'totalVatCents' | 'totalGrossCents'>;
type RevisionContext = Pick<InvoiceContentRevision, 'invoiceKind' | 'origin' | 'taxTreatment'>;

export const maximumInvoiceRevisionUnitLength = 8;

export function validateInvoiceRevisionUnitLength(trimmedLength: number): void {
  if (trimmedLength > maximumInvoiceRevisionUnitLength) fail();
}

// Facts contain no historical text or growing collections. Readers retain responsibility
// for scalar validation and for proving each relationship in their own read snapshot.
export interface InvoiceRevisionHeaderFacts extends RevisionAmounts {
  readonly invoiceKind: InvoiceContentRevision['invoiceKind'];
  readonly taxTreatment: InvoiceContentRevision['taxTreatment'];
  readonly priceInputMode: InvoiceContentRevision['priceInputMode'];
  readonly creditSourcePresent: readonly [boolean, boolean, boolean, boolean];
  readonly creditedInvoiceIsSelf: boolean;
  readonly referenceNumberPresent: boolean;
  readonly referenceNumberTypePresent: boolean;
  readonly performancePeriodValid: boolean;
  readonly taxSnapshotMatches: boolean;
}

export interface InvoiceRevisionLineFacts extends Pick<InvoiceContentRevisionLine,
  'vatRateBasisPoints' | 'netCents' | 'vatCents' | 'grossCents'> {
  readonly invoiceMatches: boolean;
  readonly duplicateLineId: boolean;
  readonly duplicateLineOrder: boolean;
  readonly trimmedUnitLength: number;
  readonly sourceLinePresent: boolean;
  readonly sourceRevisionPresent: boolean;
  readonly sourceRevisionMatchesCredit: boolean;
}

export interface InvoiceRevisionVatTotals {
  netCents: bigint;
  vatCents: bigint;
  grossCents: bigint;
}

export function validateInvoiceRevisionHeaderFacts(header: InvoiceRevisionHeaderFacts): void {
  if (header.invoiceKind === 'standard') {
    if (header.creditSourcePresent.some(Boolean)) fail();
  } else if (header.creditSourcePresent.some((present) => !present) || header.creditedInvoiceIsSelf) {
    fail();
  }
  if (header.referenceNumberPresent !== header.referenceNumberTypePresent ||
    !header.performancePeriodValid || !header.taxSnapshotMatches) fail();
  if (header.taxTreatment === 'reverseChargeConstruction' && (
    header.priceInputMode !== 'net' || header.totalVatCents !== 0 ||
    header.totalNetCents !== header.totalGrossCents
  )) fail();
}

export function validateInvoiceRevisionLineFacts(context: RevisionContext, line: InvoiceRevisionLineFacts): void {
  validateInvoiceRevisionUnitLength(line.trimmedUnitLength);
  validateInvoiceRevisionLineRelations(context, line);
}

export function validateInvoiceRevisionLineRelations(
  context: RevisionContext,
  line: Omit<InvoiceRevisionLineFacts, 'trimmedUnitLength'>,
): void {
  if (!line.invoiceMatches || line.duplicateLineId || line.duplicateLineOrder) fail();
  if (line.sourceLinePresent !== line.sourceRevisionPresent) fail();
  if (line.sourceRevisionPresent && (
    context.invoiceKind !== 'credit' || !line.sourceRevisionMatchesCredit
  )) fail();
  if (context.taxTreatment === 'normalVat') {
    if (line.vatRateBasisPoints === null) fail();
  } else if (line.vatRateBasisPoints !== null || line.vatCents !== 0 || line.netCents !== line.grossCents) {
    fail();
  }
  if (context.origin !== 'legacySnapshot' &&
    BigInt(line.netCents) + BigInt(line.vatCents) !== BigInt(line.grossCents)) fail();
}

export function addInvoiceRevisionVatGroup(
  totals: InvoiceRevisionVatTotals,
  group: Readonly<InvoiceVatBreakdown>,
  duplicateRate: boolean,
): void {
  if (duplicateRate || BigInt(group.netCents) + BigInt(group.vatCents) !== BigInt(group.grossCents)) fail();
  totals.netCents += BigInt(group.netCents);
  totals.vatCents += BigInt(group.vatCents);
  totals.grossCents += BigInt(group.grossCents);
}

export function validateInvoiceRevisionTotals(
  revision: RevisionAmounts & Pick<InvoiceContentRevision, 'vatBreakdownState' | 'taxTreatment'>,
  facts: {
    readonly hasLines: boolean;
    readonly hasVatGroups: boolean;
    readonly vatRatesMatch: boolean;
    readonly vatTotals: Readonly<InvoiceRevisionVatTotals>;
  },
): void {
  if (!validateInvoiceRevisionTotalStructure(revision, facts)) return;
  if (!facts.vatRatesMatch) fail();
  validateInvoiceRevisionVatTotals(revision, facts.vatTotals);
}

export function validateInvoiceRevisionTotalStructure(
  revision: RevisionAmounts & Pick<InvoiceContentRevision, 'vatBreakdownState' | 'taxTreatment'>,
  facts: { readonly hasLines: boolean; readonly hasVatGroups: boolean },
): boolean {
  // Legacy totals may reflect an old calculation; unavailable is not a zero VAT value.
  if (revision.vatBreakdownState === 'unavailable') return false;
  if (!facts.hasLines ||
    BigInt(revision.totalNetCents) + BigInt(revision.totalVatCents) !== BigInt(revision.totalGrossCents)) fail();
  if (revision.taxTreatment === 'reverseChargeConstruction') {
    if (facts.hasVatGroups) fail();
    return false;
  }
  if (!facts.hasVatGroups) fail();
  return true;
}

export function validateInvoiceRevisionVatTotals(
  revision: RevisionAmounts,
  totals: Readonly<InvoiceRevisionVatTotals>,
): void {
  if (totals.netCents !== BigInt(revision.totalNetCents) ||
    totals.vatCents !== BigInt(revision.totalVatCents) ||
    totals.grossCents !== BigInt(revision.totalGrossCents)) fail();
}

function fail(): never {
  throw new InvoiceContentRevisionIntegrityError();
}
