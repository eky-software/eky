import { describe, expect, it } from 'vitest';

import {
  calculateReverseChargeInvoice,
  calculateReverseChargeInvoiceLine,
} from './calculateReverseChargeInvoice.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';

describe('calculateReverseChargeInvoice', () => {
  it('calculates net-only lines without seller VAT or a VAT breakdown', () => {
    const result = calculateReverseChargeInvoice([
      {
        quantityHundredths: 150,
        unitPriceCents: 10_000,
        priceInputMode: 'net',
        discount: { type: 'percentage', basisPoints: 500 },
      },
      {
        quantityHundredths: 200,
        unitPriceCents: 2500,
        priceInputMode: 'net',
        discount: { type: 'fixed', amountCents: 500 },
      },
    ]);

    expect(result.lines).toEqual([
      {
        quantityHundredths: 150,
        unitPriceCents: 10_000,
        vatRateBasisPoints: null,
        priceInputMode: 'net',
        baseCents: 15_000,
        discountCents: 750,
        netCents: 14_250,
        vatCents: 0,
        grossCents: 14_250,
      },
      {
        quantityHundredths: 200,
        unitPriceCents: 2500,
        vatRateBasisPoints: null,
        priceInputMode: 'net',
        baseCents: 5000,
        discountCents: 500,
        netCents: 4500,
        vatCents: 0,
        grossCents: 4500,
      },
    ]);
    expect(result.totals).toEqual({
      netTotalCents: 18_750,
      vatTotalCents: 0,
      grossTotalCents: 18_750,
      vatBreakdown: [],
    });
  });

  it('rejects gross price input', () => {
    expect(() =>
      calculateReverseChargeInvoiceLine({
        quantityHundredths: 100,
        unitPriceCents: 12_550,
        priceInputMode: 'gross',
        discount: { type: 'none' },
      }),
    ).toThrow(InvoiceCalculationError);
  });

  it('uses the same safe integer and discount boundaries as normal lines', () => {
    expect(() =>
      calculateReverseChargeInvoiceLine({
        quantityHundredths: -1,
        unitPriceCents: 1000,
        priceInputMode: 'net',
        discount: { type: 'none' },
      }),
    ).toThrow(InvoiceCalculationError);

    expect(() =>
      calculateReverseChargeInvoiceLine({
        quantityHundredths: 100,
        unitPriceCents: 1000,
        priceInputMode: 'net',
        discount: { type: 'fixed', amountCents: 1001 },
      }),
    ).toThrow(InvoiceCalculationError);
  });
});
