import { describe, expect, it } from 'vitest';

import { applyInvoicePaymentDefaults } from './invoicePaymentDefaults.js';
import { createInitialNewInvoiceForm } from './newInvoiceFormState.js';

describe('invoicePaymentDefaults', () => {
  it('fills empty late payment interest and reminder period from settings', () => {
    const form = createInitialNewInvoiceForm(
      new Date('2026-07-02T00:00:00.000Z'),
    );

    expect(
      applyInvoicePaymentDefaults(form, {
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: 8,
        isPersisted: true,
      }),
    ).toMatchObject({
      latePaymentInterestPercent: '9,50',
      reminderPeriodDays: '8',
    });
  });

  it('does not overwrite values already set on the form', () => {
    const form = {
      ...createInitialNewInvoiceForm(new Date('2026-07-02T00:00:00.000Z')),
      latePaymentInterestPercent: '12,00',
      reminderPeriodDays: '4',
    };

    expect(
      applyInvoicePaymentDefaults(form, {
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: 8,
        isPersisted: true,
      }),
    ).toMatchObject({
      latePaymentInterestPercent: '12,00',
      reminderPeriodDays: '4',
    });
  });
});
