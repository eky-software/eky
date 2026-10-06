import { describe, expect, it } from 'vitest';

import { InvoiceCalculationError } from './invoiceCalculationError.js';
import type { InvoiceContentRevisionLine } from './invoiceContentRevision.js';
import { validateLegacyInvoiceRevisionTotals } from './validateLegacyInvoiceRevisionTotals.js';

function line(overrides: Partial<InvoiceContentRevisionLine> = {}): InvoiceContentRevisionLine {
  return {
    lineId: 'line-1', invoiceId: 'invoice-1', sourceInvoiceLineId: null, sourceRevisionId: null,
    lineOrder: 1, code: '', description: 'Synthetic line', quantityHundredths: 100,
    unit: 'h', unitPriceCents: 2, vatRateBasisPoints: 2550,
    discountType: 'none', discountValue: 0, baseCents: 2, discountCents: 0,
    netCents: 2, vatCents: 1, grossCents: 3, createdAt: '2026-07-01T00:00:00Z', ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof validateLegacyInvoiceRevisionTotals>[0]> = {}) {
  return {
    origin: 'legacySnapshot' as const, vatBreakdownState: 'unavailable' as const, vatBreakdown: null,
    invoiceKind: 'standard' as const, priceInputMode: 'net' as const, taxTreatment: 'normalVat' as const,
    totalNetCents: 4, totalVatCents: 1, totalGrossCents: 5,
    lines: [line(), line({ lineId: 'line-2', lineOrder: 2 })], ...overrides,
  };
}

describe('validateLegacyInvoiceRevisionTotals', () => {
  it.each([
    ['net', 4, 1, 5], ['gross', 5, 1, 6],
  ] as const)('preserves standard %s group rounding without summing line taxes', (mode, net, vat, gross) => {
    const price = mode === 'gross' ? 3 : 2;
    const revision = input({
      priceInputMode: mode, totalNetCents: net, totalVatCents: vat, totalGrossCents: gross,
      lines: [line({ unitPriceCents: price, baseCents: price }),
        line({ lineId: 'line-2', lineOrder: 2, unitPriceCents: price, baseCents: price })],
    });
    const before = structuredClone(revision);
    expect(validateLegacyInvoiceRevisionTotals(revision)).toEqual({
      netTotalCents: net, vatTotalCents: vat, grossTotalCents: gross,
      vatBreakdown: [{ vatRateBasisPoints: 2550, netCents: net, vatCents: vat, grossCents: gross }],
    });
    expect(revision).toEqual(before);
  });

  it.each(['net', 'gross'] as const)('keeps allocated credit cents in %s mode across VAT groups and discounts', mode => {
    const revision = input({
      invoiceKind: 'credit', priceInputMode: mode, totalNetCents: 102, totalVatCents: 10, totalGrossCents: 112,
      lines: [
        line({ sourceInvoiceLineId: 'source-line', sourceRevisionId: 'source-revision', vatCents: 0, grossCents: 2 }),
        line({ lineId: 'free-line', lineOrder: 2, vatRateBasisPoints: 1000,
          baseCents: mode === 'gross' ? 210 : 200, discountCents: 100, discountType: 'fixed', discountValue: 100,
          netCents: 100, vatCents: 10, grossCents: 110 }),
      ],
    });
    const before = structuredClone(revision);
    expect(validateLegacyInvoiceRevisionTotals(revision).vatBreakdown).toEqual([
      { vatRateBasisPoints: 1000, netCents: 100, vatCents: 10, grossCents: 110 },
      { vatRateBasisPoints: 2550, netCents: 2, vatCents: 0, grossCents: 2 },
    ]);
    expect(revision).toEqual(before);
  });

  it.each(['standard', 'credit'] as const)('validates reverse charge %s from stored cents with an empty breakdown', invoiceKind => {
    expect(validateLegacyInvoiceRevisionTotals(input({
      invoiceKind, taxTreatment: 'reverseChargeConstruction', totalNetCents: 2, totalVatCents: 0, totalGrossCents: 2,
      lines: [line({ vatRateBasisPoints: null, vatCents: 0, grossCents: 2 })],
    }))).toEqual({ netTotalCents: 2, vatTotalCents: 0, grossTotalCents: 2, vatBreakdown: [] });
  });

  it.each(['totalNetCents', 'totalVatCents', 'totalGrossCents'] as const)('rejects a mismatching stored %s', field => {
    const revision = input();
    expect(() => validateLegacyInvoiceRevisionTotals({ ...revision, [field]: revision[field] + 1 }))
      .toThrow(InvoiceCalculationError);
  });

  it.each([
    { lines: [] }, { lines: [line({ vatRateBasisPoints: null })] },
    { lines: [line({ netCents: -1 })] }, { lines: [line({ vatCents: 0 })] },
    { totalNetCents: Number.MAX_SAFE_INTEGER + 1 },
    { origin: 'approval' as const, vatBreakdownState: 'authoritative' as const, vatBreakdown: [] },
    { origin: 'validatedLegacySnapshot' as const, vatBreakdownState: 'authoritative' as const, vatBreakdown: [] },
  ])('rejects invalid or already authoritative content %#', overrides => {
    expect(() => validateLegacyInvoiceRevisionTotals(input(overrides))).toThrow(InvoiceCalculationError);
  });

  it.each(['standard', 'credit'] as const)('rejects %s overflow while summing valid individual lines', invoiceKind => {
    const huge = line({ unitPriceCents: Number.MAX_SAFE_INTEGER, vatRateBasisPoints: 0, baseCents: Number.MAX_SAFE_INTEGER,
      netCents: Number.MAX_SAFE_INTEGER, vatCents: 0, grossCents: Number.MAX_SAFE_INTEGER });
    expect(() => validateLegacyInvoiceRevisionTotals(input({ invoiceKind, lines: [huge, huge] })))
      .toThrow();
  });

  it.each([
    { priceInputMode: 'gross' as const }, { totalNetCents: 3, totalGrossCents: 3 },
    { lines: [line({ vatRateBasisPoints: 0, vatCents: 0, grossCents: 2 })] },
    { lines: [line({ vatRateBasisPoints: null })] },
  ])('rejects inconsistent reverse charge content %#', overrides => {
    expect(() => validateLegacyInvoiceRevisionTotals(input({
      taxTreatment: 'reverseChargeConstruction', totalNetCents: 2, totalVatCents: 0, totalGrossCents: 2,
      lines: [line({ vatRateBasisPoints: null, vatCents: 0, grossCents: 2 })], ...overrides,
    }))).toThrow(InvoiceCalculationError);
  });

  it.each(['baseCents', 'discountCents', 'netCents', 'vatCents', 'grossCents'] as const)(
    'rejects a standard normal-VAT stored %s that differs from line calculation', field => {
      const stored = line();
      expect(() => validateLegacyInvoiceRevisionTotals(input({
        totalNetCents: 2, totalVatCents: 1, totalGrossCents: 3,
        lines: [{ ...stored, [field]: stored[field] + 1 }],
      }))).toThrow(InvoiceCalculationError);
    },
  );

  it('rejects normal-VAT line corruption even when group and header sums still reconcile', () => {
    expect(() => validateLegacyInvoiceRevisionTotals(input({
      totalNetCents: 3, totalVatCents: 1, totalGrossCents: 4,
      lines: [line({ netCents: 3, grossCents: 4 })],
    }))).toThrow(InvoiceCalculationError);
  });

  it.each(['normalVat', 'reverseChargeConstruction'] as const)(
    'checks standard %s quantity and discount inputs against stored monetary fields', taxTreatment => {
      const stored = taxTreatment === 'normalVat' ? line() : line({ vatRateBasisPoints: null, vatCents: 0, grossCents: 2 });
      for (const overrides of [
        { quantityHundredths: 200 }, { unitPriceCents: 3 },
        { discountType: 'fixed' as const, discountValue: 1 },
        { discountType: 'percentage' as const, discountValue: 5000 },
      ]) {
        expect(() => validateLegacyInvoiceRevisionTotals(input({
          taxTreatment, totalNetCents: 2, totalVatCents: stored.vatCents, totalGrossCents: stored.grossCents,
          lines: [{ ...stored, ...overrides }],
        }))).toThrow(InvoiceCalculationError);
      }
    },
  );

  it.each(['fixed', 'percentage'] as const)('accepts a correctly snapshotted standard %s discount', discountType => {
    expect(validateLegacyInvoiceRevisionTotals(input({
      totalNetCents: 2, totalVatCents: 1, totalGrossCents: 3,
      lines: [line({ unitPriceCents: 4, baseCents: 4, discountCents: 2,
        discountType, discountValue: discountType === 'fixed' ? 2 : 5000 })],
    })).netTotalCents).toBe(2);
  });

  it.each(['baseCents', 'discountCents', 'netCents', 'vatCents', 'grossCents'] as const)(
    'rejects a reverse-charge standard stored %s that differs from line calculation', field => {
      const stored = line({ vatRateBasisPoints: null, vatCents: 0, grossCents: 2 });
      expect(() => validateLegacyInvoiceRevisionTotals(input({
        taxTreatment: 'reverseChargeConstruction', totalNetCents: 2, totalVatCents: 0, totalGrossCents: 2,
        lines: [{ ...stored, [field]: stored[field] + 1 }],
      }))).toThrow(InvoiceCalculationError);
    },
  );

  it.each(['net', 'gross'] as const)('rejects credit %s base/discount inconsistencies without repricing', priceInputMode => {
    for (const amounts of [{ baseCents: 1, discountCents: 2 }, { baseCents: 3, discountCents: 0 }]) {
      expect(() => validateLegacyInvoiceRevisionTotals(input({
        invoiceKind: 'credit', priceInputMode, totalNetCents: 2, totalVatCents: 0, totalGrossCents: 2,
        lines: [line({ vatCents: 0, grossCents: 2, ...amounts })],
      }))).toThrow(InvoiceCalculationError);
    }
  });

  it('preserves a reverse-charge cumulative credit allocation which cannot be repriced from quantity', () => {
    const revision = input({
      invoiceKind: 'credit', taxTreatment: 'reverseChargeConstruction', totalNetCents: 2, totalVatCents: 0, totalGrossCents: 2,
      lines: [line({ sourceInvoiceLineId: 'source-line', sourceRevisionId: 'source-revision',
        quantityHundredths: 1, unitPriceCents: 100, vatRateBasisPoints: null,
        baseCents: 3, discountCents: 1, vatCents: 0, grossCents: 2 })],
    });
    const before = structuredClone(revision);
    expect(validateLegacyInvoiceRevisionTotals(revision)).toEqual({
      netTotalCents: 2, vatTotalCents: 0, grossTotalCents: 2, vatBreakdown: [],
    });
    expect(revision).toEqual(before);
    expect(() => validateLegacyInvoiceRevisionTotals({
      ...revision, lines: [{ ...revision.lines[0]!, discountCents: 0 }],
    })).toThrow(InvoiceCalculationError);
  });
});
