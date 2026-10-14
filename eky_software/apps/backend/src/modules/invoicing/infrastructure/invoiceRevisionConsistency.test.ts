import { describe, expect, it } from 'vitest';

import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import {
  addInvoiceRevisionVatGroup,
  validateInvoiceRevisionHeaderFacts,
  validateInvoiceRevisionLineFacts,
  validateInvoiceRevisionTotals,
  type InvoiceRevisionHeaderFacts,
  type InvoiceRevisionLineFacts,
} from './invoiceRevisionConsistency.js';
import {
  revisionIdentifier,
  revisionInteger,
  revisionMember,
  revisionNullableIdentifier,
  revisionNullableText,
  revisionText,
} from './invoiceRevisionStoredValues.js';

const header: InvoiceRevisionHeaderFacts = {
  invoiceKind: 'standard', taxTreatment: 'normalVat', priceInputMode: 'net',
  totalNetCents: 100, totalVatCents: 25, totalGrossCents: 125,
  creditSourcePresent: [false, false, false, false], creditedInvoiceIsSelf: false,
  referenceNumberPresent: true, referenceNumberTypePresent: true,
  performancePeriodValid: true, taxSnapshotMatches: true,
};
const line: InvoiceRevisionLineFacts = {
  vatRateBasisPoints: 2500, netCents: 100, vatCents: 25, grossCents: 125,
  invoiceMatches: true, duplicateLineId: false, duplicateLineOrder: false,
  trimmedUnitLength: 3, sourceLinePresent: false, sourceRevisionPresent: false,
  sourceRevisionMatchesCredit: false,
};
const context = { invoiceKind: 'standard', taxTreatment: 'normalVat', origin: 'approval' } as const;
const totalsFacts = {
  hasLines: true, hasVatGroups: true, vatRatesMatch: true,
  vatTotals: { netCents: 100n, vatCents: 25n, grossCents: 125n },
};

describe('shared stored invoice revision consistency', () => {
  it.each(Array.from({ length: 16 }, (_, mask) => mask))('preserves all credit-source presence combinations: %i', (mask) => {
    const creditSourcePresent: InvoiceRevisionHeaderFacts['creditSourcePresent'] = [
      Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4), Boolean(mask & 8),
    ];
    for (const invoiceKind of ['standard', 'credit'] as const) {
      const check = () => validateInvoiceRevisionHeaderFacts({ ...header, invoiceKind, creditSourcePresent });
      if (mask === (invoiceKind === 'standard' ? 0 : 15)) expect(check).not.toThrow();
      else expect(check).toThrow(InvoiceContentRevisionIntegrityError);
    }
  });

  it.each([
    { referenceNumberPresent: false }, { referenceNumberTypePresent: false },
    { performancePeriodValid: false }, { taxSnapshotMatches: false },
  ])('rejects an inconsistent header fact %j', (change) => {
    expect(() => validateInvoiceRevisionHeaderFacts({ ...header, ...change }))
      .toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('allows absent reference pairs but not a self-referencing credit', () => {
    expect(() => validateInvoiceRevisionHeaderFacts({
      ...header, referenceNumberPresent: false, referenceNumberTypePresent: false,
    })).not.toThrow();
    expect(() => validateInvoiceRevisionHeaderFacts({
      ...header, invoiceKind: 'credit', creditSourcePresent: [true, true, true, true], creditedInvoiceIsSelf: true,
    })).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('requires the stored reverse-charge header, without recalculating it', () => {
    const reverse: InvoiceRevisionHeaderFacts = {
      ...header, taxTreatment: 'reverseChargeConstruction', totalVatCents: 0, totalGrossCents: 100,
    };
    expect(() => validateInvoiceRevisionHeaderFacts(reverse)).not.toThrow();
    for (const change of [{ priceInputMode: 'gross' as const }, { totalVatCents: 1 }, { totalGrossCents: 101 }]) {
      expect(() => validateInvoiceRevisionHeaderFacts({ ...reverse, ...change }))
        .toThrow(InvoiceContentRevisionIntegrityError);
    }
  });

  it.each([
    { invoiceMatches: false }, { duplicateLineId: true }, { duplicateLineOrder: true },
    { trimmedUnitLength: 9 }, { sourceLinePresent: true }, { sourceRevisionPresent: true },
    { vatRateBasisPoints: null }, { grossCents: 126 },
  ])('rejects an inconsistent line fact %j', (change) => {
    expect(() => validateInvoiceRevisionLineFacts(context, { ...line, ...change }))
      .toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('retains optional source lines, exact source revisions and the eight-code-unit boundary', () => {
    const credit = { ...context, invoiceKind: 'credit' as const };
    const sourceLine = { ...line, sourceLinePresent: true, sourceRevisionPresent: true, sourceRevisionMatchesCredit: true };
    expect(() => validateInvoiceRevisionLineFacts(credit, line)).not.toThrow();
    expect(() => validateInvoiceRevisionLineFacts(credit, { ...sourceLine, trimmedUnitLength: 8 })).not.toThrow();
    expect(() => validateInvoiceRevisionLineFacts(context, sourceLine)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(() => validateInvoiceRevisionLineFacts(credit, { ...sourceLine, sourceRevisionMatchesCredit: false }))
      .toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('does not repair or newly reject historical legacy line totals', () => {
    const oldLine = { ...line, grossCents: 999 };
    expect(() => validateInvoiceRevisionLineFacts({ ...context, origin: 'legacySnapshot' }, oldLine)).not.toThrow();
    expect(() => validateInvoiceRevisionLineFacts({ ...context, origin: 'validatedLegacySnapshot' }, oldLine))
      .toThrow(InvoiceContentRevisionIntegrityError);
    expect(() => validateInvoiceRevisionLineFacts({ ...context, origin: 'legacySnapshot' }, { ...oldLine, invoiceMatches: false }))
      .toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('preserves reverse-charge line checks even for legacy content', () => {
    const reverse = { ...context, origin: 'legacySnapshot' as const, taxTreatment: 'reverseChargeConstruction' as const };
    const reverseLine = { ...line, vatRateBasisPoints: null, vatCents: 0, grossCents: 100 };
    expect(() => validateInvoiceRevisionLineFacts(reverse, reverseLine)).not.toThrow();
    for (const change of [{ vatRateBasisPoints: 0 }, { vatCents: 1 }, { grossCents: 101 }]) {
      expect(() => validateInvoiceRevisionLineFacts(reverse, { ...reverseLine, ...change }))
        .toThrow(InvoiceContentRevisionIntegrityError);
    }
  });

  it('keeps exact VAT accumulation past Number precision and rejects before changing totals', () => {
    const totals = { netCents: 0n, vatCents: 0n, grossCents: 0n };
    const group = { vatRateBasisPoints: 0, netCents: Number.MAX_SAFE_INTEGER, vatCents: 0, grossCents: Number.MAX_SAFE_INTEGER };
    addInvoiceRevisionVatGroup(totals, group, false);
    addInvoiceRevisionVatGroup(totals, { ...group, vatRateBasisPoints: 1 }, false);
    expect(totals).toEqual({ netCents: 18014398509481982n, vatCents: 0n, grossCents: 18014398509481982n });
    const before = { ...totals };
    expect(() => addInvoiceRevisionVatGroup(totals, group, true)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(() => addInvoiceRevisionVatGroup(totals, { ...group, grossCents: 0 }, false))
      .toThrow(InvoiceContentRevisionIntegrityError);
    expect(totals).toEqual(before);
  });

  it.each([
    { hasLines: false }, { hasVatGroups: false }, { vatRatesMatch: false },
    { vatTotals: { netCents: 99n, vatCents: 25n, grossCents: 125n } },
    { vatTotals: { netCents: 100n, vatCents: 24n, grossCents: 125n } },
    { vatTotals: { netCents: 100n, vatCents: 25n, grossCents: 124n } },
  ])('rejects inconsistent authoritative totals #%#', (change) => {
    expect(() => validateInvoiceRevisionTotals({ ...header, vatBreakdownState: 'authoritative' }, { ...totalsFacts, ...change }))
      .toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('preserves authoritative, reverse-charge and unavailable total branches', () => {
    expect(() => validateInvoiceRevisionTotals({ ...header, vatBreakdownState: 'authoritative' }, totalsFacts)).not.toThrow();
    expect(() => validateInvoiceRevisionTotals({ ...header, totalGrossCents: 126, vatBreakdownState: 'authoritative' }, totalsFacts))
      .toThrow(InvoiceContentRevisionIntegrityError);
    const empty = { hasLines: false, hasVatGroups: false, vatRatesMatch: false, vatTotals: { netCents: 0n, vatCents: 0n, grossCents: 0n } };
    expect(() => validateInvoiceRevisionTotals({ ...header, totalGrossCents: 999, vatBreakdownState: 'unavailable' }, empty)).not.toThrow();
    const reverse = { ...header, taxTreatment: 'reverseChargeConstruction' as const, totalVatCents: 0, totalGrossCents: 100, vatBreakdownState: 'authoritative' as const };
    expect(() => validateInvoiceRevisionTotals(reverse, { ...empty, hasLines: true })).not.toThrow();
    expect(() => validateInvoiceRevisionTotals(reverse, empty)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(() => validateInvoiceRevisionTotals(reverse, totalsFacts)).toThrow(InvoiceContentRevisionIntegrityError);
  });
});

describe('stored revision scalar rules', () => {
  it.each([null, undefined, false, '1', 1n, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects non-integer storage #%#', (value) => {
    expect(() => revisionInteger(value)).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('keeps exact current integer bounds', () => {
    expect(revisionInteger(0)).toBe(0);
    expect(revisionInteger(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(revisionInteger(1, 1)).toBe(1);
    expect(() => revisionInteger(0, 1)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(revisionInteger(365, 0, 365)).toBe(365);
    expect(() => revisionInteger(366, 0, 365)).toThrow(InvoiceContentRevisionIntegrityError);
    expect(revisionInteger(100000, 0, 100000)).toBe(100000);
    expect(() => revisionInteger(100001, 0, 100000)).toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('does not normalize text or impose a new text limit or encoding rule', () => {
    for (const text of ['', ' ', '\uFEFF', '\u0000', '\uFFFD', '\uD83D\uDE00', 'a'.repeat(100000)]) {
      expect(revisionText(text)).toBe(text);
      expect(revisionNullableText(text)).toBe(text);
      if (text.trim().length === 0) expect(() => revisionIdentifier(text)).toThrow(InvoiceContentRevisionIntegrityError);
      else {
        expect(revisionIdentifier(text)).toBe(text);
        expect(revisionNullableIdentifier(text)).toBe(text);
      }
    }
    expect(revisionNullableText(null)).toBeNull();
    expect(revisionNullableIdentifier(null)).toBeNull();
    for (const invalid of [null, 0, false, undefined, Buffer.from('a')]) {
      expect(() => revisionText(invalid)).toThrow(InvoiceContentRevisionIntegrityError);
      expect(() => revisionIdentifier(invalid)).toThrow(InvoiceContentRevisionIntegrityError);
    }
  });

  it('keeps strict enum membership without coercion', () => {
    const allowed = ['normalVat', 'reverseChargeConstruction'] as const;
    expect(revisionMember('normalVat', allowed)).toBe('normalVat');
    for (const invalid of ['NormalVat', 'normalVat ', null, 0]) {
      expect(() => revisionMember(invalid, allowed)).toThrow(InvoiceContentRevisionIntegrityError);
    }
  });
});
