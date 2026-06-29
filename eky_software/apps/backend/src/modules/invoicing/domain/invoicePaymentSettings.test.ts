import { describe, expect, it } from 'vitest';

import {
  validateInvoicePaymentSettings,
} from './invoicePaymentSettings.js';
import { InvoicePaymentSettingsError } from './invoicePaymentSettingsError.js';

describe('invoice payment settings domain rules', () => {
  it('accepts late payment interest and reminder defaults', () => {
    expect(() =>
      validateInvoicePaymentSettings({
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: 8,
      }),
    ).not.toThrow();
  });

  it('rejects negative values', () => {
    expect(() =>
      validateInvoicePaymentSettings({
        defaultLatePaymentInterestBasisPoints: -1,
        defaultReminderPeriodDays: 8,
      }),
    ).toThrow(InvoicePaymentSettingsError);
    expect(() =>
      validateInvoicePaymentSettings({
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: -1,
      }),
    ).toThrow(InvoicePaymentSettingsError);
  });

  it('rejects non-integer values', () => {
    expect(() =>
      validateInvoicePaymentSettings({
        defaultLatePaymentInterestBasisPoints: 950.5,
        defaultReminderPeriodDays: 8,
      }),
    ).toThrow(InvoicePaymentSettingsError);
  });

  it('rejects values outside the MVP bounds', () => {
    expect(() =>
      validateInvoicePaymentSettings({
        defaultLatePaymentInterestBasisPoints: 100001,
        defaultReminderPeriodDays: 8,
      }),
    ).toThrow(InvoicePaymentSettingsError);
    expect(() =>
      validateInvoicePaymentSettings({
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: 366,
      }),
    ).toThrow(InvoicePaymentSettingsError);
  });
});
