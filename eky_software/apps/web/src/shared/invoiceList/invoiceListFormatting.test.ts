import { describe, expect, it } from 'vitest';

import {
  formatInvoiceListCurrency,
  formatInvoiceListDate,
} from './invoiceListFormatting.js';

describe('invoiceListFormatting', () => {
  it('formats Finnish invoice dates and euro amounts consistently', () => {
    expect(formatInvoiceListDate('2026-07-31')).toBe('31.07.2026');
    expect(formatInvoiceListDate('2026-07-31T12:00:00.000Z')).toBe(
      '31.07.2026',
    );
    expect(formatInvoiceListCurrency(12_345)).toMatch(/123,45/);
    expect(formatInvoiceListCurrency(-12_345)).toMatch(/−?-\s?123,45|−123,45/);
  });

  it('keeps an unknown date value visible instead of hiding it', () => {
    expect(formatInvoiceListDate('unknown')).toBe('unknown');
  });
});
