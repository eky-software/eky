import { describe, expect, it } from 'vitest';

import {
  hasInvoiceNumberingSettingsValidationErrors,
  initialInvoiceNumberingSettingsForm,
  toInvoiceNumberingSettingsForm,
  toUpdateInvoiceNumberingSettingsRequest,
  validateInvoiceNumberingSettingsForm,
} from './invoiceNumberingSettingsFormModel.js';

const validationMessages = {
  firstSequenceNumberInvalid: 'First sequence number invalid.',
  fiscalYearStartMonthInvalid: 'Fiscal year start month invalid.',
  modeInvalid: 'Mode invalid.',
  sequencePaddingInvalid: 'Sequence padding invalid.',
};

describe('invoiceNumberingSettingsFormModel', () => {
  it('maps API settings to form strings', () => {
    expect(
      toInvoiceNumberingSettingsForm({
        firstSequenceNumber: 1001,
        fiscalYearStartMonth: 4,
        hasUsedNumbering: false,
        isPersisted: true,
        mode: 'fiscalYearSequence',
        sequencePadding: 5,
        seriesKey: 'default',
      }),
    ).toEqual({
      firstSequenceNumber: '1001',
      fiscalYearStartMonth: '4',
      mode: 'fiscalYearSequence',
      sequencePadding: '5',
    });
  });

  it('creates an update request with only user-editable fields', () => {
    const request = toUpdateInvoiceNumberingSettingsRequest({
      firstSequenceNumber: '2026001',
      fiscalYearStartMonth: '1',
      mode: 'calendarYearSequence',
      sequencePadding: '3',
    });

    expect(request).toEqual({
      firstSequenceNumber: 2026001,
      fiscalYearStartMonth: 1,
      mode: 'calendarYearSequence',
      sequencePadding: 3,
    });
    expect(request).not.toHaveProperty('companyId');
    expect(request).not.toHaveProperty('seriesKey');
    expect(request).not.toHaveProperty('hasUsedNumbering');
    expect(request).not.toHaveProperty('isPersisted');
  });

  it('accepts the boundary values used by the UI', () => {
    const errors = validateInvoiceNumberingSettingsForm(
      {
        ...initialInvoiceNumberingSettingsForm,
        firstSequenceNumber: '1',
        fiscalYearStartMonth: '12',
        sequencePadding: '0',
      },
      validationMessages,
    );

    expect(hasInvoiceNumberingSettingsValidationErrors(errors)).toBe(false);
  });

  it('rejects values outside the UI validation limits', () => {
    expect(
      validateInvoiceNumberingSettingsForm(
        {
          ...initialInvoiceNumberingSettingsForm,
          firstSequenceNumber: '0',
          fiscalYearStartMonth: '13',
          sequencePadding: '13',
        },
        validationMessages,
      ),
    ).toEqual({
      firstSequenceNumber: validationMessages.firstSequenceNumberInvalid,
      fiscalYearStartMonth: validationMessages.fiscalYearStartMonthInvalid,
      sequencePadding: validationMessages.sequencePaddingInvalid,
    });
  });

  it('rejects non-integer input', () => {
    expect(
      validateInvoiceNumberingSettingsForm(
        {
          ...initialInvoiceNumberingSettingsForm,
          firstSequenceNumber: '1.5',
          fiscalYearStartMonth: 'tammi',
          sequencePadding: '-1',
        },
        validationMessages,
      ),
    ).toEqual({
      firstSequenceNumber: validationMessages.firstSequenceNumberInvalid,
      fiscalYearStartMonth: validationMessages.fiscalYearStartMonthInvalid,
      sequencePadding: validationMessages.sequencePaddingInvalid,
    });
  });
});
