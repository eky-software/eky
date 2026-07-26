import type {
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from './approvedInvoiceView.js';
import { calculateInvoiceTotals } from './calculateInvoiceTotals.js';
import { calculateReverseChargeInvoice } from './calculateReverseChargeInvoice.js';
import type { PriceInputMode } from './invoiceCalculation.js';
import type { InvoiceDraft, InvoiceDraftLine } from './invoiceDraft.js';

type InvoiceViewLine = InvoiceDraftLine | ApprovedInvoiceViewLine;

export function withCalculatedInvoiceDraftTotals(
  draft: InvoiceDraft,
): InvoiceDraft {
  return {
    ...draft,
    totals:
      draft.taxTreatment === 'reverseChargeConstruction'
        ? calculateReverseChargeInvoice(
            draft.lines.map((line) => ({
              quantityHundredths: line.quantityHundredths,
              unitPriceCents: line.unitPriceCents,
              priceInputMode: line.priceInputMode,
              discount: line.discount,
            })),
          ).totals
        : calculateInvoiceTotals(toNormalCalculatedLines(draft.lines)),
  };
}

export function withCalculatedApprovedInvoiceVatBreakdown(
  invoice: ApprovedInvoiceView,
): ApprovedInvoiceView {
  if (invoice.taxTreatment === 'reverseChargeConstruction') {
    return {
      ...invoice,
      totals: {
        ...invoice.totals,
        vatBreakdown: [],
      },
      vatBreakdown: [],
    };
  }

  const vatBreakdown = calculateInvoiceTotals(
    toNormalCalculatedLines(invoice.lines, invoice.priceInputMode),
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

function toNormalCalculatedLines(
  lines: InvoiceViewLine[],
  fallbackPriceInputMode?: PriceInputMode,
) {
  return lines.map((line) => {
    if (line.vatRateBasisPoints === null) {
      throw new Error('Normal VAT line is missing its VAT rate.');
    }

    return {
      quantityHundredths: line.quantityHundredths,
      unitPriceCents: line.unitPriceCents,
      vatRateBasisPoints: line.vatRateBasisPoints,
      priceInputMode:
        'priceInputMode' in line
          ? line.priceInputMode
          : (fallbackPriceInputMode ?? 'net'),
      baseCents: line.baseCents,
      discountCents: line.discountCents,
      netCents: line.netCents,
      vatCents: line.vatCents,
      grossCents: line.grossCents,
    };
  });
}
