import { describe, expect, it } from 'vitest';

import {
  getHelsinkiCalendarDate,
  invoicePaymentBusinessTimeZone,
} from './invoicePaymentClock.js';

describe('invoice payment clock', () => {
  it('uses the trusted Helsinki calendar boundary', () => {
    expect(invoicePaymentBusinessTimeZone).toBe('Europe/Helsinki');
    expect(getHelsinkiCalendarDate(new Date('2026-07-30T21:30:00.000Z'))).toBe(
      '2026-07-31',
    );
    expect(getHelsinkiCalendarDate(new Date('2026-12-31T22:30:00.000Z'))).toBe(
      '2027-01-01',
    );
  });
});
