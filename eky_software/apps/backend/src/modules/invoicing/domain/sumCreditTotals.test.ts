import { describe, expect, it } from 'vitest';

import { sumCreditTotals } from './calculateCreditInvoiceDraft.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';
import { InvoiceCreditError } from './invoiceCreditError.js';

function creditLine() {
  return {
    priceInputMode: 'net' as const,
    vatRateBasisPoints: 2550,
    baseCents: 67,
    discountCents: 0,
    netCents: 67,
    vatCents: 18,
    grossCents: 85,
  };
}

describe('sumCreditTotals', () => {
  it('sums allocated cents without rerounding or mutating credit lines', () => {
    const lines = Object.freeze([
      Object.freeze(creditLine()),
      Object.freeze({ ...creditLine(), priceInputMode: 'gross' as const, vatRateBasisPoints: 1400 }),
      Object.freeze(creditLine()),
    ]);

    expect(sumCreditTotals(lines)).toEqual({
      netTotalCents: 201,
      vatTotalCents: 54,
      grossTotalCents: 255,
      vatBreakdown: [
        { vatRateBasisPoints: 1400, netCents: 67, vatCents: 18, grossCents: 85 },
        { vatRateBasisPoints: 2550, netCents: 134, vatCents: 36, grossCents: 170 },
      ],
    });
    expect(lines[0]).toEqual(creditLine());
  });

  it('keeps an empty projection empty', () => {
    expect(sumCreditTotals([])).toEqual({
      netTotalCents: 0, vatTotalCents: 0, grossTotalCents: 0, vatBreakdown: [],
    });
  });

  it.each([
    'vatRateBasisPoints', 'baseCents', 'discountCents', 'netCents', 'vatCents', 'grossCents',
  ] as const)('rejects invalid %s before summing', (field) => {
    for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => sumCreditTotals([{ ...creditLine(), [field]: value }]))
        .toThrow(InvoiceCalculationError);
    }
  });

  it('rejects inconsistent line amounts', () => {
    expect(() => sumCreditTotals([{ ...creditLine(), grossCents: 84 }]))
      .toThrow('Calculated invoice line net, VAT, and gross amounts do not reconcile.');
  });

  it('rejects different input modes within one VAT group', () => {
    expect(() => sumCreditTotals([
      creditLine(), { ...creditLine(), priceInputMode: 'gross' },
    ])).toThrow('Invoice lines with the same VAT rate must use one price input mode.');
  });

  it.each([0, 1400])('rejects total overflow with second rate %s', (secondRate) => {
    const large = {
      ...creditLine(), vatRateBasisPoints: 0,
      baseCents: Number.MAX_SAFE_INTEGER, netCents: Number.MAX_SAFE_INTEGER,
      vatCents: 0, grossCents: Number.MAX_SAFE_INTEGER,
    };
    const small = {
      ...creditLine(), vatRateBasisPoints: secondRate,
      baseCents: 1, netCents: 1, vatCents: 0, grossCents: 1,
    };
    expect(() => sumCreditTotals([large, small])).toThrow(InvoiceCreditError);
  });
});
