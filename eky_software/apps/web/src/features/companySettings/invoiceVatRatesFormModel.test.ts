import { describe, expect, it } from 'vitest';

import {
  createEmptyInvoiceVatRateFormRow,
  hasInvoiceVatRatesValidationErrors,
  toUpdateInvoiceVatRatesRequest,
  validateInvoiceVatRatesForm,
} from './invoiceVatRatesFormModel.js';

const messages = {
  collectionInvalid: 'collection',
  defaultInvalid: 'default',
  duplicateRate: 'duplicate',
  labelInvalid: 'label',
  rateInvalid: 'rate',
};

describe('invoice VAT rates form model', () => {
  it('maps decimal percentages to basis points without floating point arithmetic', () => {
    expect(
      toUpdateInvoiceVatRatesRequest([
        {
          ...createEmptyInvoiceVatRateFormRow('rate-1'),
          ratePercent: '25,50',
          label: 'Yleinen 25,5 %',
          isDefault: true,
        },
      ]),
    ).toEqual({
      vatRates: [
        {
          rateBasisPoints: 2550,
          label: 'Yleinen 25,5 %',
          isActive: true,
          isDefault: true,
          sortOrder: 0,
        },
      ],
    });
  });

  it('rejects duplicate rates and a missing active default', () => {
    const errors = validateInvoiceVatRatesForm(
      [
        { ...createEmptyInvoiceVatRateFormRow('rate-1'), ratePercent: '10', label: '10 %' },
        { ...createEmptyInvoiceVatRateFormRow('rate-2'), ratePercent: '10,00', label: 'Ten' },
      ],
      messages,
    );

    expect(hasInvoiceVatRatesValidationErrors(errors)).toBe(true);
    expect(errors.rows['rate-2']?.ratePercent).toBe('duplicate');
    expect(errors.form).toBe('default');
  });
});
