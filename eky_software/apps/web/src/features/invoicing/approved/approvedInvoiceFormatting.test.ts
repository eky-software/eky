import { describe, expect, it } from 'vitest';

import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
  formatApprovedInvoiceDiscount,
  formatApprovedInvoiceIban,
  formatApprovedInvoicePercent,
  formatApprovedInvoiceQuantity,
} from './approvedInvoiceFormatting.js';

describe('approvedInvoiceFormatting', () => {
  it('formats cents as Finnish euro text', () => {
    expect(formatApprovedInvoiceCurrency(45_430)).toBe('454,30\u00a0€');
  });

  it('formats ISO dates as Finnish dates', () => {
    expect(formatApprovedInvoiceDate('2026-06-30')).toBe('30.06.2026');
  });

  it('formats quantity hundredths with two decimals', () => {
    expect(formatApprovedInvoiceQuantity(1350)).toBe('13,50');
  });

  it('formats basis points as percent text', () => {
    expect(formatApprovedInvoicePercent(950)).toBe('9,50 %');
  });

  it('formats IBAN for easier reading', () => {
    expect(formatApprovedInvoiceIban('FI2112345600000785')).toBe(
      'FI21 1234 5600 0007 85',
    );
  });

  it('hides missing discounts and formats explicit discounts', () => {
    expect(formatApprovedInvoiceDiscount({ type: 'none' })).toBeNull();
    expect(
      formatApprovedInvoiceDiscount({ basisPoints: 500, type: 'percentage' }),
    ).toBe('5,00 %');
    expect(
      formatApprovedInvoiceDiscount({ amountCents: 10_000, type: 'fixed' }),
    ).toBe('100,00\u00a0€');
  });
});
