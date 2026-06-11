import { describe, expect, it } from 'vitest';

import { calculateInvoiceLine } from './calculateInvoiceLine.js';
import type {
  InvoiceLineCalculationInput,
  PriceInputMode,
} from './invoiceCalculation.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';
import { roundHalfUp } from './roundHalfUp.js';

function createLineInput(
  overrides: Partial<InvoiceLineCalculationInput> = {},
): InvoiceLineCalculationInput {
  return {
    quantityHundredths: 100,
    unitPriceCents: 10_000,
    vatRateBasisPoints: 2550,
    priceInputMode: 'net',
    discount: { type: 'none' },
    ...overrides,
  };
}

describe('roundHalfUp', () => {
  it('rounds an exact half upward', () => {
    expect(roundHalfUp(5n, 2n)).toBe(3);
  });

  it('rounds values below an exact half downward', () => {
    expect(roundHalfUp(4n, 3n)).toBe(1);
  });
});

describe('calculateInvoiceLine', () => {
  it('calculates a net-priced line without a discount', () => {
    expect(calculateInvoiceLine(createLineInput())).toMatchObject({
      baseCents: 10_000,
      discountCents: 0,
      netCents: 10_000,
      vatCents: 2550,
      grossCents: 12_550,
    });
  });

  it('calculates a gross-priced line without a discount', () => {
    expect(
      calculateInvoiceLine(
        createLineInput({
          unitPriceCents: 12_550,
          priceInputMode: 'gross',
        }),
      ),
    ).toMatchObject({
      baseCents: 12_550,
      discountCents: 0,
      netCents: 10_000,
      vatCents: 2550,
      grossCents: 12_550,
    });
  });

  it('supports quantities with two decimal places', () => {
    expect(
      calculateInvoiceLine(
        createLineInput({
          quantityHundredths: 150,
          unitPriceCents: 1000,
          vatRateBasisPoints: 0,
        }),
      ).netCents,
    ).toBe(1500);
  });

  it.each([
    [0, 0],
    [1000, 1000],
    [1350, 1350],
    [2550, 2550],
  ])(
    'calculates VAT rate %i basis points',
    (vatRateBasisPoints, expectedVatCents) => {
      expect(
        calculateInvoiceLine(
          createLineInput({ vatRateBasisPoints }),
        ).vatCents,
      ).toBe(expectedVatCents);
    },
  );

  it('does not hardcode VAT calculation to the current test rates', () => {
    expect(
      calculateInvoiceLine(
        createLineInput({ vatRateBasisPoints: 1400 }),
      ).vatCents,
    ).toBe(1400);
  });

  it('applies a percentage discount before VAT in net mode', () => {
    expect(
      calculateInvoiceLine(
        createLineInput({
          discount: { type: 'percentage', basisPoints: 500 },
        }),
      ),
    ).toMatchObject({
      baseCents: 10_000,
      discountCents: 500,
      netCents: 9500,
      vatCents: 2423,
      grossCents: 11_923,
    });
  });

  it('applies a fixed discount according to gross input mode', () => {
    expect(
      calculateInvoiceLine(
        createLineInput({
          unitPriceCents: 12_550,
          priceInputMode: 'gross',
          discount: { type: 'fixed', amountCents: 1255 },
        }),
      ),
    ).toMatchObject({
      baseCents: 12_550,
      discountCents: 1255,
      netCents: 9000,
      vatCents: 2295,
      grossCents: 11_295,
    });
  });

  it('allows a zero-priced line', () => {
    expect(
      calculateInvoiceLine(createLineInput({ unitPriceCents: 0 })),
    ).toMatchObject({
      baseCents: 0,
      discountCents: 0,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    });
  });

  it('allows a discount that reduces the line to zero', () => {
    expect(
      calculateInvoiceLine(
        createLineInput({
          discount: { type: 'fixed', amountCents: 10_000 },
        }),
      ),
    ).toMatchObject({
      discountCents: 10_000,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    });
  });

  it('rejects a discount that exceeds the line value', () => {
    expect(() =>
      calculateInvoiceLine(
        createLineInput({
          discount: { type: 'fixed', amountCents: 10_001 },
        }),
      ),
    ).toThrow(InvoiceCalculationError);

    expect(() =>
      calculateInvoiceLine(
        createLineInput({
          discount: { type: 'percentage', basisPoints: 10_001 },
        }),
      ),
    ).toThrow(InvoiceCalculationError);
  });

  it.each([
    ['quantity', { quantityHundredths: -1 }],
    ['unit price', { unitPriceCents: -1 }],
    ['VAT rate', { vatRateBasisPoints: -1 }],
    ['percentage discount', { discount: { type: 'percentage', basisPoints: -1 } }],
    ['fixed discount', { discount: { type: 'fixed', amountCents: -1 } }],
  ])('rejects a negative %s', (_fieldName, overrides) => {
    expect(() =>
      calculateInvoiceLine(
        createLineInput(overrides as Partial<InvoiceLineCalculationInput>),
      ),
    ).toThrow(InvoiceCalculationError);
  });

  it('rejects values that are not safe integers', () => {
    expect(() =>
      calculateInvoiceLine(createLineInput({ quantityHundredths: 100.5 })),
    ).toThrow(InvoiceCalculationError);

    expect(() =>
      calculateInvoiceLine(
        createLineInput({ unitPriceCents: Number.MAX_SAFE_INTEGER }),
      ),
    ).toThrow(InvoiceCalculationError);
  });

  it('rejects an invalid price input mode at runtime', () => {
    expect(() =>
      calculateInvoiceLine(
        createLineInput({ priceInputMode: 'invalid' as PriceInputMode }),
      ),
    ).toThrow(InvoiceCalculationError);
  });
});
