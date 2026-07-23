import { describe, expect, it } from 'vitest';

import {
  calculateCreditInvoice,
  type CreditSourceLine,
  type PreviousCreditLineAllocation,
} from './calculateCreditInvoice.js';
import { InvoiceCreditError } from './invoiceCreditError.js';

describe('calculateCreditInvoice', () => {
  it('matches the source invoice totals for a full net credit', () => {
    const result = calculateCreditInvoice(
      [
        createSourceLine({
          id: 'line-1',
          lineOrder: 1,
          quantityHundredths: 100,
          baseCents: 5500,
          netCents: 5500,
          vatCents: 1403,
          grossCents: 6903,
        }),
        createSourceLine({
          id: 'line-2',
          lineOrder: 2,
          quantityHundredths: 100,
          baseCents: 2500,
          netCents: 2500,
          vatCents: 638,
          grossCents: 3138,
        }),
        createSourceLine({
          id: 'line-3',
          lineOrder: 3,
          quantityHundredths: 100,
          baseCents: 4400,
          netCents: 4400,
          vatCents: 1122,
          grossCents: 5522,
        }),
      ],
      [],
      [
        { sourceInvoiceLineId: 'line-1', quantityHundredths: 100 },
        { sourceInvoiceLineId: 'line-2', quantityHundredths: 100 },
        { sourceInvoiceLineId: 'line-3', quantityHundredths: 100 },
      ],
    );

    expect(result.totals).toEqual({
      netTotalCents: 12_400,
      vatTotalCents: 3162,
      grossTotalCents: 15_562,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 12_400,
          vatCents: 3162,
          grossCents: 15_562,
        },
      ],
    });
  });

  it('allocates a fixed discount only once across partial credits', () => {
    const source = [
      createSourceLine({
        quantityHundredths: 300,
        baseCents: 30_000,
        discountCents: 5000,
        netCents: 25_000,
        vatCents: 6375,
        grossCents: 31_375,
      }),
    ];

    const first = calculateCreditInvoice(source, [], [
      { sourceInvoiceLineId: 'line-1', quantityHundredths: 100 },
    ]);
    const second = calculateCreditInvoice(
      source,
      first.lines,
      [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 100 }],
    );
    const third = calculateCreditInvoice(
      source,
      [...first.lines, ...second.lines],
      [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 100 }],
    );

    expect(
      [...first.lines, ...second.lines, ...third.lines].reduce(
        (sum, line) => sum + line.discountCents,
        0,
      ),
    ).toBe(5000);
    expect(
      [...first.lines, ...second.lines, ...third.lines].reduce(
        (sum, line) => sum + line.grossCents,
        0,
      ),
    ).toBe(31_375);
  });

  it('gives the final partial credit the remaining rounding cents', () => {
    const source = [
      createSourceLine({
        quantityHundredths: 300,
        baseCents: 100,
        netCents: 100,
        vatCents: 26,
        grossCents: 126,
      }),
    ];
    const first = calculateCreditInvoice(source, [], [
      { sourceInvoiceLineId: 'line-1', quantityHundredths: 100 },
    ]);
    const second = calculateCreditInvoice(
      source,
      first.lines,
      [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 200 }],
    );

    expect(first.lines[0]).toMatchObject({
      netCents: 33,
      vatCents: 8,
      grossCents: 41,
    });
    expect(second.lines[0]).toMatchObject({
      netCents: 67,
      vatCents: 18,
      grossCents: 85,
    });
  });

  it('preserves gross-mode capacity and reconciles VAT', () => {
    const source = [
      createSourceLine({
        priceInputMode: 'gross',
        quantityHundredths: 200,
        baseCents: 20_000,
        discountCents: 2000,
        netCents: 14_343,
        vatCents: 3657,
        grossCents: 18_000,
      }),
    ];

    const result = calculateCreditInvoice(source, [], [
      { sourceInvoiceLineId: 'line-1', quantityHundredths: 100 },
    ]);

    expect(result.lines[0]).toMatchObject({
      baseCents: 10_000,
      discountCents: 1000,
      netCents: 7171,
      vatCents: 1829,
      grossCents: 9000,
    });
  });

  it('rejects duplicate, unknown and excessive source quantities', () => {
    const source = [createSourceLine()];

    expect(() =>
      calculateCreditInvoice(source, [], [
        { sourceInvoiceLineId: 'line-1', quantityHundredths: 50 },
        { sourceInvoiceLineId: 'line-1', quantityHundredths: 50 },
      ]),
    ).toThrow(InvoiceCreditError);
    expect(() =>
      calculateCreditInvoice(source, [], [
        { sourceInvoiceLineId: 'unknown', quantityHundredths: 1 },
      ]),
    ).toThrow(InvoiceCreditError);
    expect(() =>
      calculateCreditInvoice(
        source,
        [createPreviousAllocation({ quantityHundredths: 75 })],
        [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 26 }],
      ),
    ).toThrow(
      'Credit quantity exceeds the remaining source line quantity.',
    );
  });

  it('ignores zero-value descriptive lines as credit capacity', () => {
    expect(() =>
      calculateCreditInvoice(
        [
          createSourceLine({
            quantityHundredths: 0,
            baseCents: 0,
            netCents: 0,
            vatCents: 0,
            grossCents: 0,
          }),
        ],
        [],
        [{ sourceInvoiceLineId: 'line-1', quantityHundredths: 1 }],
      ),
    ).toThrow('Credit invoice source line is invalid.');
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

function createPreviousAllocation(
  overrides: Partial<PreviousCreditLineAllocation> = {},
): PreviousCreditLineAllocation {
  return {
    sourceInvoiceLineId: 'line-1',
    quantityHundredths: 50,
    baseCents: 5000,
    discountCents: 0,
    netCents: 5000,
    vatCents: 1275,
    grossCents: 6275,
    ...overrides,
  };
}
