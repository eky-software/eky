import { describe, expect, it } from 'vitest';

import {
  formatInvoiceNumber,
  formatSequenceNumber,
  getFiscalYearForInvoiceDate,
  maxSequencePadding,
  validateInvoiceNumberingSettings,
  validateInvoiceSequenceNumber,
  type InvoiceNumberingSettings,
} from './invoiceNumbering.js';
import { InvoiceNumberingError } from './invoiceNumberingError.js';

const fiscalYearSequenceSettings: InvoiceNumberingSettings = {
  mode: 'fiscalYearSequence',
  fiscalYearStartMonth: 1,
  sequencePadding: 4,
  firstSequenceNumber: 1,
};

describe('getFiscalYearForInvoiceDate', () => {
  it('uses the calendar year when the fiscal year starts in January', () => {
    expect(getFiscalYearForInvoiceDate('2027-01-01', 1)).toBe(2027);
    expect(getFiscalYearForInvoiceDate('2027-12-31', 1)).toBe(2027);
  });

  it('uses the previous year before a February fiscal year start', () => {
    expect(getFiscalYearForInvoiceDate('2027-01-31', 2)).toBe(2026);
    expect(getFiscalYearForInvoiceDate('2027-02-01', 2)).toBe(2027);
    expect(getFiscalYearForInvoiceDate('2028-01-31', 2)).toBe(2027);
    expect(getFiscalYearForInvoiceDate('2028-02-01', 2)).toBe(2028);
  });

  it('uses the previous year before a December fiscal year start', () => {
    expect(getFiscalYearForInvoiceDate('2027-11-30', 12)).toBe(2026);
    expect(getFiscalYearForInvoiceDate('2027-12-01', 12)).toBe(2027);
    expect(getFiscalYearForInvoiceDate('2028-11-30', 12)).toBe(2027);
    expect(getFiscalYearForInvoiceDate('2028-12-01', 12)).toBe(2028);
  });

  it('validates invoice dates without using timezone-sensitive Date parsing', () => {
    expect(() => getFiscalYearForInvoiceDate('2027-02-29', 1)).toThrow(
      InvoiceNumberingError,
    );
    expect(() => getFiscalYearForInvoiceDate('2028-02-29', 1)).not.toThrow();
    expect(() => getFiscalYearForInvoiceDate('2027-13-01', 1)).toThrow(
      InvoiceNumberingError,
    );
    expect(() => getFiscalYearForInvoiceDate('2027-01-00', 1)).toThrow(
      InvoiceNumberingError,
    );
    expect(() => getFiscalYearForInvoiceDate('2027/01/01', 1)).toThrow(
      InvoiceNumberingError,
    );
  });
});

describe('formatSequenceNumber', () => {
  it('formats plain sequence numbers with optional padding', () => {
    expect(formatSequenceNumber(1, 0)).toBe('1');
    expect(formatSequenceNumber(1, 4)).toBe('0001');
    expect(formatSequenceNumber(1000, 0)).toBe('1000');
    expect(formatSequenceNumber(1000, 4)).toBe('1000');
  });

  it('does not truncate a sequence that is longer than the padding', () => {
    expect(formatSequenceNumber(12345, 4)).toBe('12345');
  });
});

describe('formatInvoiceNumber', () => {
  it('formats fiscal year sequence invoice numbers', () => {
    expect(
      formatInvoiceNumber(fiscalYearSequenceSettings, '2027-01-01', 1),
    ).toBe('20270001');
    expect(
      formatInvoiceNumber(
        { ...fiscalYearSequenceSettings, sequencePadding: 6 },
        '2027-01-01',
        1,
      ),
    ).toBe('2027000001');
    expect(
      formatInvoiceNumber(fiscalYearSequenceSettings, '2027-01-01', 1000),
    ).toBe('20271000');
    expect(
      formatInvoiceNumber(fiscalYearSequenceSettings, '2027-01-01', 12345),
    ).toBe('202712345');
  });

  it('formats plain sequence invoice numbers', () => {
    const plainSettings: InvoiceNumberingSettings = {
      mode: 'plainSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 0,
      firstSequenceNumber: 1,
    };

    expect(formatInvoiceNumber(plainSettings, '2027-01-01', 1)).toBe('1');
    expect(
      formatInvoiceNumber(
        { ...plainSettings, sequencePadding: 4 },
        '2027-01-01',
        1,
      ),
    ).toBe('0001');
    expect(formatInvoiceNumber(plainSettings, '2027-01-01', 1000)).toBe('1000');
    expect(
      formatInvoiceNumber(
        { ...plainSettings, sequencePadding: 4 },
        '2027-01-01',
        1000,
      ),
    ).toBe('1000');
  });
});

describe('validateInvoiceNumberingSettings', () => {
  it('accepts valid settings', () => {
    expect(() =>
      validateInvoiceNumberingSettings(fiscalYearSequenceSettings),
    ).not.toThrow();
  });

  it('rejects invalid numbering modes', () => {
    expect(() =>
      validateInvoiceNumberingSettings({
        ...fiscalYearSequenceSettings,
        mode: 'invalid',
      } as unknown as InvoiceNumberingSettings),
    ).toThrow(InvoiceNumberingError);
  });

  it('rejects invalid fiscal year start months', () => {
    expect(() =>
      validateInvoiceNumberingSettings({
        ...fiscalYearSequenceSettings,
        fiscalYearStartMonth: 0,
      }),
    ).toThrow(InvoiceNumberingError);
    expect(() =>
      validateInvoiceNumberingSettings({
        ...fiscalYearSequenceSettings,
        fiscalYearStartMonth: 13,
      }),
    ).toThrow(InvoiceNumberingError);
  });

  it('rejects negative or overly large sequence padding', () => {
    expect(() =>
      validateInvoiceNumberingSettings({
        ...fiscalYearSequenceSettings,
        sequencePadding: -1,
      }),
    ).toThrow(InvoiceNumberingError);
    expect(() =>
      validateInvoiceNumberingSettings({
        ...fiscalYearSequenceSettings,
        sequencePadding: maxSequencePadding + 1,
      }),
    ).toThrow(InvoiceNumberingError);
  });

  it('uses a documented maximum sequence padding to avoid unbounded strings', () => {
    expect(maxSequencePadding).toBe(12);
  });

  it('rejects invalid first sequence numbers', () => {
    expect(() =>
      validateInvoiceNumberingSettings({
        ...fiscalYearSequenceSettings,
        firstSequenceNumber: 0,
      }),
    ).toThrow(InvoiceNumberingError);
  });

  it('rejects decimal, NaN, Infinity, and unsafe integer values', () => {
    const invalidNumbers = [
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (const invalidNumber of invalidNumbers) {
      expect(() =>
        validateInvoiceNumberingSettings({
          ...fiscalYearSequenceSettings,
          firstSequenceNumber: invalidNumber,
        }),
      ).toThrow(InvoiceNumberingError);
      expect(() =>
        validateInvoiceSequenceNumber(invalidNumber),
      ).toThrow(InvoiceNumberingError);
    }
  });
});

describe('validateInvoiceSequenceNumber', () => {
  it('rejects zero sequence numbers', () => {
    expect(() => validateInvoiceSequenceNumber(0)).toThrow(
      InvoiceNumberingError,
    );
  });
});
