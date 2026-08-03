import { describe, expect, it } from 'vitest';

import {
  formatInvoiceNumber,
  formatSequenceNumber,
  getCalendarYearForInvoiceDate,
  getFiscalYearForInvoiceDate,
  maxSequencePadding,
  resolveInvoiceNumberSequenceScope,
  validateInvoiceNumberSequenceScope,
  validateInvoiceNumberSeriesKey,
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

const calendarYearSequenceSettings: InvoiceNumberingSettings = {
  mode: 'calendarYearSequence',
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

describe('getCalendarYearForInvoiceDate', () => {
  it('uses the calendar year from the invoice date', () => {
    expect(getCalendarYearForInvoiceDate('2027-01-01')).toBe(2027);
    expect(getCalendarYearForInvoiceDate('2027-12-31')).toBe(2027);
    expect(getCalendarYearForInvoiceDate('2028-01-01')).toBe(2028);
  });

  it('validates invoice dates with the same date parser as fiscal year logic', () => {
    expect(() => getCalendarYearForInvoiceDate('2027-02-29')).toThrow(
      InvoiceNumberingError,
    );
    expect(() => getCalendarYearForInvoiceDate('2028-02-29')).not.toThrow();
    expect(() => getCalendarYearForInvoiceDate('2027/01/01')).toThrow(
      InvoiceNumberingError,
    );
  });
});

describe('resolveInvoiceNumberSequenceScope', () => {
  it('uses one shared plain sequence scope for plain sequence numbering', () => {
    expect(
      resolveInvoiceNumberSequenceScope(
        {
          mode: 'plainSequence',
          fiscalYearStartMonth: 1,
          sequencePadding: 0,
          firstSequenceNumber: 1,
        },
        '2027-01-31',
      ),
    ).toBe('plain');
  });

  it('uses the invoice date calendar year for calendar-year numbering', () => {
    expect(
      resolveInvoiceNumberSequenceScope(
        calendarYearSequenceSettings,
        '2027-01-31',
      ),
    ).toBe('calendar-year:2027');
    expect(
      resolveInvoiceNumberSequenceScope(
        calendarYearSequenceSettings,
        '2028-01-01',
      ),
    ).toBe('calendar-year:2028');
  });

  it('uses the fiscal year for fiscal-year numbering', () => {
    expect(
      resolveInvoiceNumberSequenceScope(
        {
          ...fiscalYearSequenceSettings,
          fiscalYearStartMonth: 2,
        },
        '2027-01-31',
      ),
    ).toBe('fiscal-year:2026');
    expect(
      resolveInvoiceNumberSequenceScope(
        {
          ...fiscalYearSequenceSettings,
          fiscalYearStartMonth: 2,
        },
        '2027-02-01',
      ),
    ).toBe('fiscal-year:2027');
  });

  it('validates the invoice date before resolving a scoped sequence', () => {
    expect(() =>
      resolveInvoiceNumberSequenceScope(
        calendarYearSequenceSettings,
        '2027/01/31',
      ),
    ).toThrow(InvoiceNumberingError);
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

  it('formats calendar year sequence invoice numbers', () => {
    expect(
      formatInvoiceNumber(calendarYearSequenceSettings, '2027-01-01', 1),
    ).toBe('20270001');
    expect(
      formatInvoiceNumber(calendarYearSequenceSettings, '2027-12-31', 42),
    ).toBe('20270042');
    expect(
      formatInvoiceNumber(calendarYearSequenceSettings, '2028-01-01', 1),
    ).toBe('20280001');
  });

  it('keeps year-based invoice number prefixes four digits wide', () => {
    expect(
      formatInvoiceNumber(calendarYearSequenceSettings, '0001-01-01', 1),
    ).toBe('00010001');
    expect(
      formatInvoiceNumber(
        {
          ...fiscalYearSequenceSettings,
          fiscalYearStartMonth: 2,
        },
        '0001-01-01',
        1,
      ),
    ).toBe('00000001');
  });

  it('keeps calendar year sequence independent from fiscal year start month', () => {
    expect(
      formatInvoiceNumber(
        {
          ...calendarYearSequenceSettings,
          fiscalYearStartMonth: 2,
        },
        '2027-01-31',
        1,
      ),
    ).toBe('20270001');
    expect(
      formatInvoiceNumber(
        {
          ...fiscalYearSequenceSettings,
          fiscalYearStartMonth: 2,
        },
        '2027-01-31',
        1,
      ),
    ).toBe('20260001');
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
    expect(() =>
      validateInvoiceNumberingSettings(calendarYearSequenceSettings),
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

describe('invoice numbering identifiers', () => {
  it('accepts bounded series keys and sequence scopes', () => {
    expect(() => validateInvoiceNumberSeriesKey('default')).not.toThrow();
    expect(() =>
      validateInvoiceNumberSeriesKey('domestic-2027'),
    ).not.toThrow();
    expect(() =>
      validateInvoiceNumberSequenceScope('calendar-year:2027'),
    ).not.toThrow();
  });

  it('rejects empty or unsupported identifiers', () => {
    expect(() => validateInvoiceNumberSeriesKey('')).toThrow(
      InvoiceNumberingError,
    );
    expect(() => validateInvoiceNumberSeriesKey('   ')).toThrow(
      InvoiceNumberingError,
    );
    expect(() => validateInvoiceNumberSeriesKey('default;drop')).toThrow(
      InvoiceNumberingError,
    );
    expect(() => validateInvoiceNumberSequenceScope('calendar year 2027')).toThrow(
      InvoiceNumberingError,
    );
  });
});
