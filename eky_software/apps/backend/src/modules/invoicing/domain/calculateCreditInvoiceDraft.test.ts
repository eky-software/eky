import { describe, expect, it } from 'vitest';

import type { CreditSourceLine } from './calculateCreditInvoice.js';
import { calculateInvoiceLine } from './calculateInvoiceLine.js';
import { calculateInvoiceTotals } from './calculateInvoiceTotals.js';
import type { InvoiceLineCalculationInput } from './invoiceCalculation.js';
import {
  calculateCreditInvoiceDraft,
  calculateRemainingCreditTotals,
  type PreviousCreditAllocation,
} from './calculateCreditInvoiceDraft.js';

describe('calculateCreditInvoiceDraft', () => {
  const roundingCases = [
    { priceInputMode: 'net', unitPriceCents: 1, lineVatCents: 0, net: 2, vat: 1, gross: 3 },
    { priceInputMode: 'net', unitPriceCents: 2, lineVatCents: 2, net: 4, vat: 1, gross: 5 },
    { priceInputMode: 'gross', unitPriceCents: 2, lineVatCents: 0, net: 3, vat: 1, gross: 4 },
    { priceInputMode: 'gross', unitPriceCents: 3, lineVatCents: 2, net: 5, vat: 1, gross: 6 },
  ] as const;

  it.each(roundingCases)(
    'uses invoice group capacity for two $unitPriceCents-cent $priceInputMode lines',
    ({ priceInputMode, unitPriceCents, lineVatCents, net, vat, gross }) => {
      const source = createCalculatedSources(Array.from({ length: 2 }, () => ({
        quantityHundredths: 100,
        unitPriceCents,
        vatRateBasisPoints: 2550,
        priceInputMode,
        discount: { type: 'none' },
      })));
      const snapshot = structuredClone(source);
      const totals = calculateInvoiceTotals(source);

      expect(source.reduce((sum, line) => sum + line.vatCents, 0)).toBe(lineVatCents);
      expect(totals).toEqual({
        netTotalCents: net,
        vatTotalCents: vat,
        grossTotalCents: gross,
        vatBreakdown: [{ vatRateBasisPoints: 2550, netCents: net, vatCents: vat, grossCents: gross }],
      });
      expect(calculateRemainingCreditTotals(source, [])).toEqual(totals);

      const full = calculateCreditInvoiceDraft(
        source,
        [],
        source.map((line) => ({ sourceInvoiceLineId: line.id, quantityHundredths: 100 })),
        [],
      );
      expect(full.totals).toEqual(totals);

      const previous: PreviousCreditAllocation[] = [];
      for (const line of source) {
        const credit = calculateCreditInvoiceDraft(
          source,
          previous,
          [{ sourceInvoiceLineId: line.id, quantityHundredths: 100 }],
          [],
        );
        previous.push(...credit.lines.map(toPreviousAllocation));
        expect(calculateRemainingCreditTotals(source, previous)).toMatchObject({
          netTotalCents: net - previous.reduce((sum, row) => sum + row.netCents, 0),
          vatTotalCents: vat - previous.reduce((sum, row) => sum + row.vatCents, 0),
          grossTotalCents: gross - previous.reduce((sum, row) => sum + row.grossCents, 0),
        });
      }
      expect(calculateRemainingCreditTotals(source, previous)).toEqual({
        netTotalCents: 0,
        vatTotalCents: 0,
        grossTotalCents: 0,
        vatBreakdown: [{ vatRateBasisPoints: 2550, netCents: 0, vatCents: 0, grossCents: 0 }],
      });
      expect(source).toEqual(snapshot);
    },
  );

  it.each(roundingCases)(
    'shares $priceInputMode group capacity between source and manual credits at $unitPriceCents cents',
    ({ priceInputMode, unitPriceCents }) => {
      const source = createCalculatedSources(Array.from({ length: 2 }, () => ({
        quantityHundredths: 100,
        unitPriceCents,
        vatRateBasisPoints: 2550,
        priceInputMode,
        discount: { type: 'none' },
      })));
      const first = calculateCreditInvoiceDraft(source, [], [
        { sourceInvoiceLineId: 'line-1', quantityHundredths: 100 },
      ], []);
      const previous = first.lines.map(toPreviousAllocation);
      const remaining = calculateRemainingCreditTotals(source, previous);
      const manual = {
        lineKey: 'manual-1', quantityHundredths: 100, unitPriceCents, vatRateBasisPoints: 2550,
      };
      const last = calculateCreditInvoiceDraft(source, previous, [], [manual]);

      expect(last.totals).toEqual(remaining);
      expect(() => calculateCreditInvoiceDraft(source, previous, [], [
        { ...manual, unitPriceCents: unitPriceCents + 1 },
      ])).toThrow('Credit amount exceeds the remaining source invoice amount.');
      expect(calculateRemainingCreditTotals(source, [
        ...previous, ...last.lines.map(toPreviousAllocation),
      ])).toMatchObject({ netTotalCents: 0, vatTotalCents: 0, grossTotalCents: 0 });
    },
  );

  it.each(['net', 'gross'] as const)(
    'preserves discounts and final cents across multiple %s VAT groups',
    (priceInputMode) => {
      const source = createCalculatedSources([2550, 1350, 1000].flatMap((vatRateBasisPoints) => [
        {
          quantityHundredths: 300,
          unitPriceCents: 101,
          vatRateBasisPoints,
          priceInputMode,
          discount: { type: 'fixed', amountCents: 100 } as const,
        },
        {
          quantityHundredths: 300,
          unitPriceCents: 101,
          vatRateBasisPoints,
          priceInputMode,
          discount: { type: 'percentage', basisPoints: 2500 } as const,
        },
      ]));
      const totals = calculateInvoiceTotals(source);
      const full = calculateCreditInvoiceDraft(source, [], source.map((line) => ({
        sourceInvoiceLineId: line.id, quantityHundredths: 300,
      })), []);
      expect(full.totals).toEqual(totals);

      const previous: PreviousCreditAllocation[] = [];
      for (let part = 0; part < 3; part += 1) {
        const remaining = calculateRemainingCreditTotals(source, previous);
        const credit = calculateCreditInvoiceDraft(source, previous, source.map((line) => ({
          sourceInvoiceLineId: line.id, quantityHundredths: 100,
        })), []);
        if (part === 2) {
          expect(credit.totals).toEqual(remaining);
        }
        previous.push(...credit.lines.map(toPreviousAllocation));
      }

      for (const line of source) {
        const allocations = previous.filter((row) => row.sourceInvoiceLineId === line.id);
        expect(allocations.reduce((sum, row) => sum + row.quantityHundredths, 0)).toBe(300);
        expect(allocations.reduce((sum, row) => sum + row.baseCents, 0)).toBe(line.baseCents);
        expect(allocations.reduce((sum, row) => sum + row.discountCents, 0)).toBe(line.discountCents);
      }
      for (const group of totals.vatBreakdown) {
        const allocations = previous.filter((row) => row.vatRateBasisPoints === group.vatRateBasisPoints);
        expect(allocations.reduce((sum, row) => sum + row.netCents, 0)).toBe(group.netCents);
        expect(allocations.reduce((sum, row) => sum + row.vatCents, 0)).toBe(group.vatCents);
        expect(allocations.reduce((sum, row) => sum + row.grossCents, 0)).toBe(group.grossCents);
      }
      expect(calculateRemainingCreditTotals(source, previous)).toMatchObject({
        netTotalCents: 0, vatTotalCents: 0, grossTotalCents: 0,
      });
      expect(() => calculateCreditInvoiceDraft(source, previous, [
        { sourceInvoiceLineId: 'line-1', quantityHundredths: 1 },
      ], [])).toThrow('Credit quantity exceeds the remaining source line quantity.');
    },
  );

  it('preserves source validation and safe integer guards when building capacity', () => {
    expect(() => calculateRemainingCreditTotals([
      createSourceLine({ grossCents: 12_551 }),
    ], [])).toThrow('Source invoice line amounts are invalid.');
    expect(() => calculateRemainingCreditTotals([
      createSourceLine(), createSourceLine({ id: 'line-2', priceInputMode: 'gross' }),
    ], [])).toThrow('Source invoice VAT rate must use one price input mode.');
    const maximum = createSourceLine({
      baseCents: Number.MAX_SAFE_INTEGER,
      netCents: Number.MAX_SAFE_INTEGER,
      vatCents: 0,
      grossCents: Number.MAX_SAFE_INTEGER,
      vatRateBasisPoints: 0,
    });
    expect(() => calculateRemainingCreditTotals([
      maximum, { ...maximum, id: 'line-2' },
    ], [])).toThrow('Credit invoice amount exceeds the safe integer range.');
    expect(() => calculateRemainingCreditTotals([
      { ...maximum, vatRateBasisPoints: 1 },
    ], [])).toThrow('Credit invoice amount exceeds the safe integer range.');
  });

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

function createCalculatedSources(inputs: InvoiceLineCalculationInput[]) {
  return inputs.map((input, index) => ({
    ...calculateInvoiceLine(input),
    id: `line-${index + 1}`,
    lineOrder: index + 1,
  }));
}

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
  if (line.vatRateBasisPoints === null) {
    throw new Error('Normal VAT test line requires a VAT rate.');
  }

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
