import { describe, expect, it } from 'vitest';

import {
  getHelsinkiPaymentDate,
  invoicePaymentBusinessTimeZone,
} from './invoicePaymentForm.js';

describe('getHelsinkiPaymentDate', () => {
  it('uses the Helsinki calendar date at the UTC day boundary', () => {
    expect(invoicePaymentBusinessTimeZone).toBe('Europe/Helsinki');
    expect(
      getHelsinkiPaymentDate(new Date('2026-07-30T20:59:59.999Z')),
    ).toBe('2026-07-30');
    expect(
      getHelsinkiPaymentDate(new Date('2026-07-30T21:00:00.000Z')),
    ).toBe('2026-07-31');
  });

  it('rejects an invalid date', () => {
    expect(() => getHelsinkiPaymentDate(new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});
