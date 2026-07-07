import { describe, expect, it } from 'vitest';

import { calculateInvoiceLine } from './calculateInvoiceLine.js';
import { calculateInvoiceTotals } from './calculateInvoiceTotals.js';
import type {
  CalculatedInvoiceLine,
  InvoiceLineCalculationInput,
} from './invoiceCalculation.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';

function calculateLine(
  overrides: Partial<InvoiceLineCalculationInput> = {},
) {
  return calculateInvoiceLine({
    quantityHundredths: 100,
    unitPriceCents: 10_000,
    vatRateBasisPoints: 2550,
    priceInputMode: 'net',
    discount: { type: 'none' },
    ...overrides,
  });
}

describe('calculateInvoiceTotals', () => {
  it('returns zero totals for an invoice without lines', () => {
    expect(calculateInvoiceTotals([])).toEqual({
      netTotalCents: 0,
      vatTotalCents: 0,
      grossTotalCents: 0,
      vatBreakdown: [],
    });
  });

  it('sums multiple already rounded invoice lines', () => {
    const totals = calculateInvoiceTotals([
      calculateLine(),
      calculateLine({ vatRateBasisPoints: 1350 }),
      calculateLine({
        unitPriceCents: 11_000,
        vatRateBasisPoints: 1000,
        priceInputMode: 'gross',
      }),
    ]);

    expect(totals).toMatchObject({
      netTotalCents: 30_000,
      vatTotalCents: 4900,
      grossTotalCents: 34_900,
    });
  });

  it('groups VAT breakdown values by VAT rate', () => {
    const totals = calculateInvoiceTotals([
      calculateLine(),
      calculateLine({
        quantityHundredths: 50,
      }),
      calculateLine({
        vatRateBasisPoints: 1350,
      }),
    ]);

    expect(totals.vatBreakdown).toEqual([
      {
        vatRateBasisPoints: 1350,
        netCents: 10_000,
        vatCents: 1350,
        grossCents: 11_350,
      },
      {
        vatRateBasisPoints: 2550,
        netCents: 15_000,
        vatCents: 3825,
        grossCents: 18_825,
      },
    ]);
    expect(totals).toMatchObject({
      netTotalCents: 25_000,
      vatTotalCents: 5175,
      grossTotalCents: 30_175,
    });
  });

  it('calculates VAT from VAT-rate totals instead of summing rounded line VAT', () => {
    const lines = [
      calculateLine({ unitPriceCents: 5500 }),
      ...Array.from({ length: 25 }, () => calculateLine({ unitPriceCents: 100 })),
      ...Array.from({ length: 4 }, () => calculateLine({ unitPriceCents: 1100 })),
    ];

    const lineVatSum = lines.reduce((sum, line) => sum + line.vatCents, 0);
    const totals = calculateInvoiceTotals(lines);

    expect(lineVatSum).toBe(3177);
    expect(totals).toEqual({
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

  it('rejects calculated lines whose amounts do not reconcile', () => {
    const invalidLine: CalculatedInvoiceLine = {
      ...calculateLine(),
      grossCents: 12_549,
    };

    expect(() => calculateInvoiceTotals([invalidLine])).toThrow(
      InvoiceCalculationError,
    );
  });

  it('rejects calculated lines with unsafe or negative values', () => {
    const invalidLine: CalculatedInvoiceLine = {
      ...calculateLine(),
      netCents: -1,
    };

    expect(() => calculateInvoiceTotals([invalidLine])).toThrow(
      InvoiceCalculationError,
    );
  });
});
