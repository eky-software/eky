import { describe, expect, it } from 'vitest';

import type { CreditSourceLine } from './calculateCreditInvoice.js';
import {
  calculateCreditInvoiceDraft,
  calculateRemainingCreditTotals,
  type PreviousCreditAllocation,
} from './calculateCreditInvoiceDraft.js';

describe('calculateCreditInvoiceDraft', () => {
  it('calculates a manual net credit with the source VAT rate', () => {
    const result = calculateCreditInvoiceDraft(
      [createSourceLine()],
      [],
      [],
      [
        {
          lineKey: 'manual-1',
          quantityHundredths: 100,
          unitPriceCents: 10_000,
          vatRateBasisPoints: 2550,
        },
      ],
    );

    expect(result.lines[0]).toMatchObject({
      sourceInvoiceLineId: null,
      netCents: 10_000,
      vatCents: 2550,
      grossCents: 12_550,
    });
  });

  it('reconciles VAT cumulatively across source and manual credits', () => {
    const source = [
      createSourceLine({
        quantityHundredths: 300,
        baseCents: 100,
        netCents: 100,
        vatCents: 26,
        grossCents: 126,
      }),
    ];
    const first = calculateCreditInvoiceDraft(
      source,
      [],
      [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 100 }],
      [],
    );
    const previous = first.lines.map(toPreviousAllocation);
    const second = calculateCreditInvoiceDraft(
      source,
      previous,
      [],
      [
        {
          lineKey: 'manual-1',
          quantityHundredths: 100,
          unitPriceCents: 67,
          vatRateBasisPoints: 2550,
        },
      ],
    );

    expect(first.totals).toMatchObject({
      netTotalCents: 33,
      vatTotalCents: 8,
      grossTotalCents: 41,
    });
    expect(second.totals).toMatchObject({
      netTotalCents: 67,
      vatTotalCents: 18,
      grossTotalCents: 85,
    });
  });

  it('rejects a VAT rate not present on the source invoice', () => {
    expect(() =>
      calculateCreditInvoiceDraft(
        [createSourceLine()],
        [],
        [],
        [
          {
            lineKey: 'manual-1',
            quantityHundredths: 100,
            unitPriceCents: 1000,
            vatRateBasisPoints: 1350,
          },
        ],
      ),
    ).toThrow(
      'Manual credit line VAT rate is not present on the source invoice.',
    );
  });

  it('rejects source and manual credits exceeding remaining capacity', () => {
    expect(() =>
      calculateCreditInvoiceDraft(
        [createSourceLine()],
        [],
        [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 100 }],
        [
          {
            lineKey: 'manual-1',
            quantityHundredths: 100,
            unitPriceCents: 1,
            vatRateBasisPoints: 2550,
          },
        ],
      ),
    ).toThrow('Credit amount exceeds the remaining source invoice amount.');
  });

  it('rejects a manual credit above the amount left after earlier credits', () => {
    expect(() =>
      calculateCreditInvoiceDraft(
        [createSourceLine()],
        [
          {
            sourceInvoiceLineId: null,
            quantityHundredths: 100,
            priceInputMode: 'net',
            vatRateBasisPoints: 2550,
            baseCents: 9000,
            discountCents: 0,
            netCents: 9000,
            vatCents: 2295,
            grossCents: 11_295,
          },
        ],
        [],
        [
          {
            lineKey: 'manual-1',
            quantityHundredths: 100,
            unitPriceCents: 1001,
            vatRateBasisPoints: 2550,
          },
        ],
      ),
    ).toThrow('Credit amount exceeds the remaining source invoice amount.');
  });

  it('reports remaining totals including manual previous credits', () => {
    expect(
      calculateRemainingCreditTotals(
        [createSourceLine()],
        [
          {
            sourceInvoiceLineId: null,
            quantityHundredths: 100,
            priceInputMode: 'net',
            vatRateBasisPoints: 2550,
            baseCents: 4000,
            discountCents: 0,
            netCents: 4000,
            vatCents: 1020,
            grossCents: 5020,
          },
        ],
      ),
    ).toEqual({
      netTotalCents: 6000,
      vatTotalCents: 1530,
      grossTotalCents: 7530,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 6000,
          vatCents: 1530,
          grossCents: 7530,
        },
      ],
    });
  });
});

function createSourceLine(
  overrides: Partial<CreditSourceLine> = {},
): CreditSourceLine {
  return {
    id: 'line-1',
    lineOrder: 1,
    quantityHundredths: 100,
    priceInputMode: 'net',
    vatRateBasisPoints: 2550,
    baseCents: 10_000,
    discountCents: 0,
    netCents: 10_000,
    vatCents: 2550,
    grossCents: 12_550,
    ...overrides,
  };
}

function toPreviousAllocation(
  line: ReturnType<typeof calculateCreditInvoiceDraft>['lines'][number],
): PreviousCreditAllocation {
  return {
    sourceInvoiceLineId: line.sourceInvoiceLineId,
    quantityHundredths: line.quantityHundredths,
    priceInputMode: line.priceInputMode,
    vatRateBasisPoints: line.vatRateBasisPoints,
    baseCents: line.baseCents,
    discountCents: line.discountCents,
    netCents: line.netCents,
    vatCents: line.vatCents,
    grossCents: line.grossCents,
  };
}
