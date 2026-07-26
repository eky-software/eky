import { describe, expect, it } from 'vitest';

import { calculateInvoiceLine } from './calculateInvoiceLine.js';
import { calculateInvoiceTotals } from './calculateInvoiceTotals.js';

describe('normal VAT characterization', () => {
  it('preserves net and gross input calculations exactly', () => {
    const netLine = calculateInvoiceLine({
      quantityHundredths: 150,
      unitPriceCents: 10_000,
      vatRateBasisPoints: 2550,
      priceInputMode: 'net',
      discount: { type: 'percentage', basisPoints: 500 },
    });
    const grossLine = calculateInvoiceLine({
      quantityHundredths: 100,
      unitPriceCents: 12_550,
      vatRateBasisPoints: 2550,
      priceInputMode: 'gross',
      discount: { type: 'fixed', amountCents: 1255 },
    });

    expect(netLine).toMatchObject({
      baseCents: 15_000,
      discountCents: 750,
      netCents: 14_250,
      vatCents: 3634,
      grossCents: 17_884,
    });
    expect(grossLine).toMatchObject({
      baseCents: 12_550,
      discountCents: 1255,
      netCents: 9000,
      vatCents: 2295,
      grossCents: 11_295,
    });
  });

  it('preserves multiple VAT-rate grouping and invoice-level rounding', () => {
    const lines = [
      calculateInvoiceLine({
        quantityHundredths: 100,
        unitPriceCents: 5500,
        vatRateBasisPoints: 2550,
        priceInputMode: 'net',
        discount: { type: 'none' },
      }),
      ...Array.from({ length: 25 }, () =>
        calculateInvoiceLine({
          quantityHundredths: 100,
          unitPriceCents: 100,
          vatRateBasisPoints: 2550,
          priceInputMode: 'net',
          discount: { type: 'none' },
        }),
      ),
      ...Array.from({ length: 4 }, () =>
        calculateInvoiceLine({
          quantityHundredths: 100,
          unitPriceCents: 1100,
          vatRateBasisPoints: 2550,
          priceInputMode: 'net',
          discount: { type: 'none' },
        }),
      ),
      calculateInvoiceLine({
        quantityHundredths: 100,
        unitPriceCents: 10_000,
        vatRateBasisPoints: 1350,
        priceInputMode: 'net',
        discount: { type: 'none' },
      }),
      calculateInvoiceLine({
        quantityHundredths: 100,
        unitPriceCents: 11_000,
        vatRateBasisPoints: 1000,
        priceInputMode: 'gross',
        discount: { type: 'none' },
      }),
    ];

    expect(calculateInvoiceTotals(lines)).toEqual({
      netTotalCents: 32_400,
      vatTotalCents: 5512,
      grossTotalCents: 37_912,
      vatBreakdown: [
        {
          vatRateBasisPoints: 1000,
          netCents: 10_000,
          vatCents: 1000,
          grossCents: 11_000,
        },
        {
          vatRateBasisPoints: 1350,
          netCents: 10_000,
          vatCents: 1350,
          grossCents: 11_350,
        },
        {
          vatRateBasisPoints: 2550,
          netCents: 12_400,
          vatCents: 3162,
          grossCents: 15_562,
        },
      ],
    });
  });
});
