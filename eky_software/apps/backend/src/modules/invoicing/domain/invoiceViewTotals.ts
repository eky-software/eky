import type {
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from './approvedInvoiceView.js';
import { calculateInvoiceTotals } from './calculateInvoiceTotals.js';
import type { PriceInputMode } from './invoiceCalculation.js';
import type { InvoiceDraft, InvoiceDraftLine } from './invoiceDraft.js';

type InvoiceViewLine = InvoiceDraftLine | ApprovedInvoiceViewLine;

export function withCalculatedInvoiceDraftTotals(
  draft: InvoiceDraft,
): InvoiceDraft {
  return {
    ...draft,
    totals: calculateInvoiceTotals(draft.lines),
  };
}

export function withCalculatedApprovedInvoiceVatBreakdown(
  invoice: ApprovedInvoiceView,
): ApprovedInvoiceView {
  const vatBreakdown = calculateInvoiceTotals(
    toCalculatedLines(invoice.priceInputMode, invoice.lines),
  ).vatBreakdown;

  return {
    ...invoice,
    totals: {
      ...invoice.totals,
      vatBreakdown,
    },
    vatBreakdown,
  };
}

function toCalculatedLines(
  priceInputMode: PriceInputMode,
  lines: InvoiceViewLine[],
) {
  return lines.map((line) => ({
    quantityHundredths: line.quantityHundredths,
    unitPriceCents: line.unitPriceCents,
    vatRateBasisPoints: line.vatRateBasisPoints,
    priceInputMode,
    baseCents: line.baseCents,
    discountCents: line.discountCents,
    netCents: line.netCents,
    vatCents: line.vatCents,
    grossCents: line.grossCents,
  }));
}
