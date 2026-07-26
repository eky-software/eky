import { describe, expect, it } from 'vitest';

import {
  calculateRemainingReverseChargeCreditTotals,
  calculateReverseChargeCreditInvoiceDraft,
  type ReverseChargeCreditSourceLine,
  type ReverseChargePreviousCreditAllocation,
} from './calculateReverseChargeCreditInvoiceDraft.js';

describe('calculateReverseChargeCreditInvoiceDraft', () => {
  it('credits a reverse charge source line without creating VAT', () => {
    const result = calculateReverseChargeCreditInvoiceDraft(
      [createSourceLine()],
      [],
      [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 300 }],
      [],
    );

    expect(result).toEqual({
      lines: [
        {
          lineKey: 'line-1',
          sourceInvoiceLineId: 'line-1',
          quantityHundredths: 300,
          unitPriceCents: null,
          priceInputMode: 'net',
          vatRateBasisPoints: null,
          baseCents: 10_000,
          discountCents: 1_000,
          netCents: 9_000,
          vatCents: 0,
          grossCents: 9_000,
        },
      ],
      totals: {
        netTotalCents: 9_000,
        vatTotalCents: 0,
        grossTotalCents: 9_000,
        vatBreakdown: [],
      },
    });
  });

  it('allocates partial credits cumulatively without rounding drift', () => {
    const source = [
      createSourceLine({
        baseCents: 100,
        discountCents: 10,
        netCents: 90,
        grossCents: 90,
      }),
    ];
    const first = calculateReverseChargeCreditInvoiceDraft(
      source,
      [],
      [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 100 }],
      [],
    );
    const second = calculateReverseChargeCreditInvoiceDraft(
      source,
      first.lines.map(toPreviousAllocation),
      [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 200 }],
      [],
    );

    expect(first.totals.netTotalCents).toBe(30);
    expect(second.totals.netTotalCents).toBe(60);
    expect(
      first.totals.netTotalCents + second.totals.netTotalCents,
    ).toBe(90);
  });

  it('calculates a manual reverse charge credit in net mode', () => {
    const result = calculateReverseChargeCreditInvoiceDraft(
      [createSourceLine()],
      [],
      [],
      [
        {
          lineKey: 'manual-1',
          quantityHundredths: 150,
          unitPriceCents: 2_000,
        },
      ],
    );

    expect(result.lines[0]).toMatchObject({
      sourceInvoiceLineId: null,
      priceInputMode: 'net',
      vatRateBasisPoints: null,
      netCents: 3_000,
      vatCents: 0,
      grossCents: 3_000,
    });
  });

  it('includes prior manual credits in the remaining invoice capacity', () => {
    expect(
      calculateRemainingReverseChargeCreditTotals(
        [createSourceLine()],
        [
          createPreviousAllocation({
            sourceInvoiceLineId: null,
            quantityHundredths: 100,
            baseCents: 2_000,
            discountCents: 0,
            netCents: 2_000,
            grossCents: 2_000,
          }),
        ],
      ),
    ).toEqual({
      netTotalCents: 7_000,
      vatTotalCents: 0,
      grossTotalCents: 7_000,
      vatBreakdown: [],
    });
  });

  it('rejects crediting more than the remaining source quantity', () => {
    expect(() =>
      calculateReverseChargeCreditInvoiceDraft(
        [createSourceLine()],
        [
          createPreviousAllocation({
            quantityHundredths: 200,
            baseCents: 6_667,
            discountCents: 667,
            netCents: 6_000,
            grossCents: 6_000,
          }),
        ],
        [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 101 }],
        [],
      ),
    ).toThrow(
      'Credit quantity exceeds the remaining source line quantity.',
    );
  });

  it('rejects a synthetic VAT rate in reverse charge source data', () => {
    expect(() =>
      calculateReverseChargeCreditInvoiceDraft(
        [
          {
            ...createSourceLine(),
            vatRateBasisPoints: 0,
          } as unknown as ReverseChargeCreditSourceLine,
        ],
        [],
        [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 100 }],
        [],
      ),
    ).toThrow('Reverse charge source invoice line is invalid.');
  });

  it('rejects internally inconsistent previous credit allocations', () => {
    expect(() =>
      calculateReverseChargeCreditInvoiceDraft(
        [createSourceLine()],
        [
          createPreviousAllocation({
            baseCents: 1_000,
            discountCents: 0,
            netCents: 900,
            grossCents: 900,
          }),
        ],
        [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 100 }],
        [],
      ),
    ).toThrow('Previous reverse charge credit allocation is invalid.');
  });
});

function createSourceLine(
  overrides: Partial<ReverseChargeCreditSourceLine> = {},
): ReverseChargeCreditSourceLine {
  return {
    id: 'line-1',
    lineOrder: 1,
    quantityHundredths: 300,
    priceInputMode: 'net',
    vatRateBasisPoints: null,
    baseCents: 10_000,
    discountCents: 1_000,
    netCents: 9_000,
    vatCents: 0,
    grossCents: 9_000,
    ...overrides,
  };
}

function createPreviousAllocation(
  overrides: Partial<ReverseChargePreviousCreditAllocation> = {},
): ReverseChargePreviousCreditAllocation {
  return {
    sourceInvoiceLineId: 'line-1',
    quantityHundredths: 100,
    priceInputMode: 'net',
    vatRateBasisPoints: null,
    baseCents: 3_333,
    discountCents: 333,
    netCents: 3_000,
    vatCents: 0,
    grossCents: 3_000,
    ...overrides,
  };
}

function toPreviousAllocation(
  line: ReturnType<
    typeof calculateReverseChargeCreditInvoiceDraft
  >['lines'][number],
): ReverseChargePreviousCreditAllocation {
  if (line.vatRateBasisPoints !== null || line.vatCents !== 0) {
    throw new Error('Reverse charge test line must not contain VAT.');
  }

  return {
    sourceInvoiceLineId: line.sourceInvoiceLineId,
    quantityHundredths: line.quantityHundredths,
    priceInputMode: 'net',
    vatRateBasisPoints: null,
    baseCents: line.baseCents,
    discountCents: line.discountCents,
    netCents: line.netCents,
    vatCents: 0,
    grossCents: line.grossCents,
  };
}
