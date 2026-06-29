import { describe, expect, it } from 'vitest';

import {
  basisPointsToPercentInput,
  hasInvoicePaymentSettingsValidationErrors,
  initialInvoicePaymentSettingsForm,
  percentInputToBasisPoints,
  toInvoicePaymentSettingsForm,
  toUpdateInvoicePaymentSettingsRequest,
  validateInvoicePaymentSettingsForm,
} from './invoicePaymentSettingsFormModel.js';

const validationMessages = {
  latePaymentInterestInvalid: 'Viivästyskorko on virheellinen.',
  reminderPeriodDaysInvalid: 'Huomautusajan pitää olla välillä 0-365.',
};

describe('invoice payment settings form model', () => {
  it('maps API settings to form values', () => {
    expect(
      toInvoicePaymentSettingsForm({
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: 8,
        isPersisted: true,
      }),
    ).toEqual({
      defaultLatePaymentInterestPercent: '9,50',
      defaultReminderPeriodDays: '8',
    });
  });

  it('maps form values to update request basis points', () => {
    expect(
      toUpdateInvoicePaymentSettingsRequest({
        defaultLatePaymentInterestPercent: '10,5',
        defaultReminderPeriodDays: '14',
      }),
    ).toEqual({
      defaultLatePaymentInterestBasisPoints: 1050,
      defaultReminderPeriodDays: 14,
    });
  });

  it.each([
    ['9', 900],
    ['9,5', 950],
    ['9,50', 950],
    ['10.5', 1050],
    ['0', 0],
  ])('converts percent input %s to basis points', (input, expected) => {
    expect(percentInputToBasisPoints(input)).toBe(expected);
  });

  it('converts basis points to Finnish percent input', () => {
    expect(basisPointsToPercentInput(950)).toBe('9,50');
  });

  it('validates invalid percent and reminder values', () => {
    const errors = validateInvoicePaymentSettingsForm(
      {
        defaultLatePaymentInterestPercent: '9,555',
        defaultReminderPeriodDays: '366',
      },
      validationMessages,
    );

    expect(hasInvoicePaymentSettingsValidationErrors(errors)).toBe(true);
    expect(errors).toEqual({
      defaultLatePaymentInterestPercent:
        validationMessages.latePaymentInterestInvalid,
      defaultReminderPeriodDays:
        validationMessages.reminderPeriodDaysInvalid,
    });
  });

  it('validates the initial form', () => {
    expect(
      validateInvoicePaymentSettingsForm(
        initialInvoicePaymentSettingsForm,
        validationMessages,
      ),
    ).toEqual({});
  });
});
