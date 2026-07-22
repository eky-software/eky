import { describe, expect, it } from 'vitest';

import {
  defaultInvoiceVatRates,
  validateInvoiceVatRates,
} from './invoiceVatRates.js';

describe('invoice VAT rates', () => {
  it('accepts the current default rate collection', () => {
    expect(() => validateInvoiceVatRates(defaultInvoiceVatRates)).not.toThrow();
  });

  it('requires unique rates and exactly one active default', () => {
    expect(() =>
      validateInvoiceVatRates([
        ...defaultInvoiceVatRates,
        { ...defaultInvoiceVatRates[0]!, sortOrder: 4 },
      ]),
    ).toThrow('Invoice VAT rates must be unique.');

    expect(() =>
      validateInvoiceVatRates(
        defaultInvoiceVatRates.map((vatRate) => ({
          ...vatRate,
          isDefault: false,
        })),
      ),
    ).toThrow('Invoice VAT rates must have exactly one default.');

    expect(() =>
      validateInvoiceVatRates(
        defaultInvoiceVatRates.map((vatRate) => ({
          ...vatRate,
          isActive: vatRate.isDefault ? false : vatRate.isActive,
        })),
      ),
    ).toThrow('Default invoice VAT rate must be active.');
  });

  it('rejects unsafe values and control characters', () => {
    expect(() =>
      validateInvoiceVatRates([
        {
          rateBasisPoints: Number.MAX_SAFE_INTEGER + 1,
          label: 'Invalid',
          isActive: true,
          isDefault: true,
          sortOrder: 0,
        },
      ]),
    ).toThrow('VAT rate is invalid.');

    expect(() =>
      validateInvoiceVatRates([
        {
          rateBasisPoints: 2550,
          label: '25,50 %\nextra',
          isActive: true,
          isDefault: true,
          sortOrder: 0,
        },
      ]),
    ).toThrow('Invoice VAT rate label is invalid.');
  });
});
