import { describe, expect, it } from 'vitest';

import {
  calculateMinimumSafeInvoiceSequenceNumber,
  validateInvoiceNumberingSeriesFirstSequenceNumber,
  type InvoiceNumberingSeriesCandidate,
} from './calculateMinimumSafeInvoiceSequenceNumber.js';
import { InvoiceNumberingError } from './invoiceNumberingError.js';

const calendarTarget: InvoiceNumberingSeriesCandidate = {
  mode: 'calendarYearSequence',
  fiscalYearStartMonth: 1,
  sequencePadding: 4,
};

describe('calculateMinimumSafeInvoiceSequenceNumber', () => {
  it.each([
    ['fiscal to calendar', calendarTarget],
    [
      'calendar to fiscal',
      {
        mode: 'fiscalYearSequence',
        fiscalYearStartMonth: 2,
        sequencePadding: 4,
      },
    ],
  ] as const)('finds later year-based collisions for %s', (_label, target) => {
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers: ['20260005', '20270042'],
        target,
      }),
    ).toMatchObject({
      capacity: 'available',
      minimumSafeFirstSequenceNumber: 43,
    });
  });

  it('finds collisions when changing from plain to calendar numbering', () => {
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers: ['20260005'],
        target: calendarTarget,
      }).minimumSafeFirstSequenceNumber,
    ).toBe(6);
  });

  it('finds collisions when changing from plain to fiscal numbering', () => {
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers: ['20270017'],
        target: {
          mode: 'fiscalYearSequence',
          fiscalYearStartMonth: 7,
          sequencePadding: 4,
        },
      }).minimumSafeFirstSequenceNumber,
    ).toBe(18);
  });

  it.each([
    ['calendar to plain', ['20260005'], 20260006],
    ['fiscal to plain', ['20270042'], 20270043],
    ['plain to plain', ['0007', '0012'], 13],
  ])('finds collisions for %s', (_label, existingInvoiceNumbers, expected) => {
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers,
        target: {
          mode: 'plainSequence',
          fiscalYearStartMonth: 1,
          sequencePadding: 4,
        },
      }).minimumSafeFirstSequenceNumber,
    ).toBe(expected);
  });

  it('does not treat a free first preview as proof when a later number collides', () => {
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers: ['20260005'],
        target: calendarTarget,
      }).minimumSafeFirstSequenceNumber,
    ).toBe(6);
  });

  it('checks every supported year prefix, including backdated fiscal prefixes', () => {
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers: ['99990009', '0007'],
        target: {
          mode: 'fiscalYearSequence',
          fiscalYearStartMonth: 2,
          sequencePadding: 4,
        },
      }).minimumSafeFirstSequenceNumber,
    ).toBe(10);
  });

  it('handles leading zeroes according to the target padding', () => {
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers: ['1', '0002', '00003'],
        target: {
          mode: 'plainSequence',
          fiscalYearStartMonth: 1,
          sequencePadding: 4,
        },
      }).minimumSafeFirstSequenceNumber,
    ).toBe(3);
  });

  it('starts at one when history is empty or cannot be produced by the target', () => {
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers: [],
        target: calendarTarget,
      }).minimumSafeFirstSequenceNumber,
    ).toBe(1);
    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers: ['7'],
        target: calendarTarget,
      }).minimumSafeFirstSequenceNumber,
    ).toBe(1);
  });

  it('uses the 15-digit year-based capacity imposed by the 19-digit reference base', () => {
    const result = calculateMinimumSafeInvoiceSequenceNumber({
      existingInvoiceNumbers: ['9999999999999999999'],
      target: {
        ...calendarTarget,
        sequencePadding: 12,
      },
    });

    expect(result).toEqual({
      capacity: 'exhausted',
      maximumSequenceNumber: 999_999_999_999_999,
      minimumSafeFirstSequenceNumber: null,
    });
  });

  it('uses Number.MAX_SAFE_INTEGER as the tighter plain sequence capacity', () => {
    const result = calculateMinimumSafeInvoiceSequenceNumber({
      existingInvoiceNumbers: [String(Number.MAX_SAFE_INTEGER)],
      target: {
        mode: 'plainSequence',
        fiscalYearStartMonth: 1,
        sequencePadding: 0,
      },
    });

    expect(result).toEqual({
      capacity: 'exhausted',
      maximumSequenceNumber: Number.MAX_SAFE_INTEGER,
      minimumSafeFirstSequenceNumber: null,
    });
  });

  it('rejects malformed, non-numeric and overlong invoice history', () => {
    for (const invoiceNumber of ['', '2026-A', '1'.repeat(20)]) {
      expect(() =>
        calculateMinimumSafeInvoiceSequenceNumber({
          existingInvoiceNumbers: [invoiceNumber],
          target: calendarTarget,
        }),
      ).toThrow(InvoiceNumberingError);
    }
  });

  it('handles a large mixed history without converting invoice numbers to Number', () => {
    const existingInvoiceNumbers = Array.from(
      { length: 5_000 },
      (_, index) => `${2020 + (index % 10)}${String(index + 1).padStart(6, '0')}`,
    );

    expect(
      calculateMinimumSafeInvoiceSequenceNumber({
        existingInvoiceNumbers,
        target: {
          ...calendarTarget,
          sequencePadding: 6,
        },
      }).minimumSafeFirstSequenceNumber,
    ).toBe(5_001);
  });
});

describe('validateInvoiceNumberingSeriesFirstSequenceNumber', () => {
  const result = calculateMinimumSafeInvoiceSequenceNumber({
    existingInvoiceNumbers: ['20260005'],
    target: calendarTarget,
  });

  it('allows the backend minimum or a greater value within capacity', () => {
    expect(() =>
      validateInvoiceNumberingSeriesFirstSequenceNumber(6, result),
    ).not.toThrow();
    expect(() =>
      validateInvoiceNumberingSeriesFirstSequenceNumber(100, result),
    ).not.toThrow();
  });

  it('rejects a lower value, unsafe value and exhausted capacity', () => {
    expect(() =>
      validateInvoiceNumberingSeriesFirstSequenceNumber(5, result),
    ).toThrow(InvoiceNumberingError);
    expect(() =>
      validateInvoiceNumberingSeriesFirstSequenceNumber(
        Number.MAX_SAFE_INTEGER + 1,
        result,
      ),
    ).toThrow(InvoiceNumberingError);
    expect(() =>
      validateInvoiceNumberingSeriesFirstSequenceNumber(1, {
        capacity: 'exhausted',
        maximumSequenceNumber: 1,
        minimumSafeFirstSequenceNumber: null,
      }),
    ).toThrow(InvoiceNumberingError);
  });
});
