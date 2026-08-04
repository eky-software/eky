import { describe, expect, it } from 'vitest';

import { ekyBusinessTimeZone } from '../../../shared/date/businessTimeZone.js';
import { getHelsinkiPaymentDate } from './invoicePaymentForm.js';

describe('getHelsinkiPaymentDate', () => {
  it('uses the Helsinki calendar date at the UTC day boundary', () => {
    expect(ekyBusinessTimeZone).toBe('Europe/Helsinki');
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
