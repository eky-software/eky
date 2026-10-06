import { sumCreditTotals } from './calculateCreditInvoiceDraft.js';
import { calculateInvoiceLine } from './calculateInvoiceLine.js';
import { calculateInvoiceTotals } from './calculateInvoiceTotals.js';
import { calculateReverseChargeInvoiceLine } from './calculateReverseChargeInvoice.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';
import type { InvoiceLineDiscount, InvoiceTotals } from './invoiceCalculation.js';
import type { InvoiceContentRevision, InvoiceContentRevisionLine } from './invoiceContentRevision.js';

type LegacyRevisionTotalsInput = Pick<InvoiceContentRevision,
  | 'origin' | 'vatBreakdownState' | 'vatBreakdown' | 'invoiceKind' | 'priceInputMode'
  | 'taxTreatment' | 'totalNetCents' | 'totalVatCents' | 'totalGrossCents' | 'lines'
>;

const lineAmountFields = ['baseCents', 'discountCents', 'netCents', 'vatCents', 'grossCents'] as const;

// Validate a one-time promotion; never repair the stored lines or header totals.
export function validateLegacyInvoiceRevisionTotals(revision: LegacyRevisionTotalsInput): InvoiceTotals {
  if (revision.origin !== 'legacySnapshot' || revision.vatBreakdownState !== 'unavailable'
    || revision.vatBreakdown !== null || revision.lines.length === 0
    || !['standard', 'credit'].includes(revision.invoiceKind)
    || !['net', 'gross'].includes(revision.priceInputMode)) fail();
  const stored = [revision.totalNetCents, revision.totalVatCents, revision.totalGrossCents];
  if (stored.some(value => !Number.isSafeInteger(value) || value < 0)) fail();
  for (const line of revision.lines) validateStoredLineAmounts(revision, line);

  let totals: InvoiceTotals;
  if (revision.taxTreatment === 'reverseChargeConstruction') {
    if (revision.priceInputMode !== 'net') fail();
    let net = 0n;
    for (const line of revision.lines) {
      if (line.vatRateBasisPoints !== null || line.vatCents !== 0
        || line.netCents !== line.grossCents) fail();
      net += BigInt(line.netCents);
    }
    if (net > BigInt(Number.MAX_SAFE_INTEGER)) fail();
    totals = { netTotalCents: Number(net), vatTotalCents: 0, grossTotalCents: Number(net), vatBreakdown: [] };
  } else {
    if (revision.taxTreatment !== 'normalVat') fail();
    const lines = revision.lines.map(line => {
      if (line.vatRateBasisPoints === null) fail();
      return {
        quantityHundredths: line.quantityHundredths,
        unitPriceCents: line.unitPriceCents,
        priceInputMode: revision.priceInputMode,
        vatRateBasisPoints: line.vatRateBasisPoints,
        baseCents: line.baseCents,
        discountCents: line.discountCents,
        netCents: line.netCents,
        vatCents: line.vatCents,
        grossCents: line.grossCents,
      };
    });
    totals = revision.invoiceKind === 'credit' ? sumCreditTotals(lines) : calculateInvoiceTotals(lines);
  }
  if (totals.netTotalCents !== revision.totalNetCents || totals.vatTotalCents !== revision.totalVatCents
    || totals.grossTotalCents !== revision.totalGrossCents) fail();
  return totals;
}

function validateStoredLineAmounts(revision: LegacyRevisionTotalsInput, line: InvoiceContentRevisionLine): void {
  if (lineAmountFields.some(field => !Number.isSafeInteger(line[field]) || line[field] < 0)) fail();
  if (revision.invoiceKind === 'credit') {
    // Allocated credit cents are authoritative; quantity/price must not reprice them.
    const inputCents = revision.priceInputMode === 'net' ? line.netCents : line.grossCents;
    if (line.discountCents > line.baseCents || line.baseCents - line.discountCents !== inputCents) fail();
    return;
  }
  const input = {
    quantityHundredths: line.quantityHundredths, unitPriceCents: line.unitPriceCents,
    priceInputMode: revision.priceInputMode, discount: toDiscount(line),
  };
  const calculated = revision.taxTreatment === 'reverseChargeConstruction'
    ? calculateReverseChargeInvoiceLine(input)
    : calculateNormalLine();
  if (lineAmountFields.some(field => line[field] !== calculated[field])) fail();

  function calculateNormalLine() {
    if (revision.taxTreatment !== 'normalVat' || line.vatRateBasisPoints === null) fail();
    return calculateInvoiceLine({ ...input, vatRateBasisPoints: line.vatRateBasisPoints });
  }
}

function toDiscount(line: InvoiceContentRevisionLine): InvoiceLineDiscount {
  switch (line.discountType) {
    case 'none': return { type: 'none' };
    case 'percentage': return { type: 'percentage', basisPoints: line.discountValue };
    case 'fixed': return { type: 'fixed', amountCents: line.discountValue };
    default: return fail();
  }
}

function fail(): never {
  throw new InvoiceCalculationError('Legacy invoice revision totals are inconsistent.');
}
