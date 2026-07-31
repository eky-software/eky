import { describe, expect, it } from 'vitest';

import { requireInvoicePaymentDate } from './invoicePaymentDate.js';

describe('requireInvoicePaymentDate', () => {
  it('accepts an exact valid ISO calendar date', () => {
    expect(requireInvoicePaymentDate('2026-07-31')).toBe('2026-07-31');
    expect(requireInvoicePaymentDate('2024-02-29')).toBe('2024-02-29');
  });

  it.each([
    '',
    '2026-7-31',
    '2026-02-29',
    '2026-13-01',
    '2026-00-01',
    'not-a-date',
    null,
  ])('rejects invalid payment date %j', (value) => {
    expect(() => requireInvoicePaymentDate(value)).toThrow();
  });
});
