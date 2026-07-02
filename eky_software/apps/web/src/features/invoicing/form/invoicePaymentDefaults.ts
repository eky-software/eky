import type { InvoicePaymentSettingsView } from '@eky/api-client';

import type { NewInvoiceFormState } from './newInvoiceFormState.js';

export function applyInvoicePaymentDefaults(
  form: NewInvoiceFormState,
  settings: InvoicePaymentSettingsView,
): NewInvoiceFormState {
  return {
    ...form,
    latePaymentInterestPercent:
      form.latePaymentInterestPercent.trim() === ''
        ? formatBasisPointsInput(settings.defaultLatePaymentInterestBasisPoints)
        : form.latePaymentInterestPercent,
    reminderPeriodDays:
      form.reminderPeriodDays.trim() === ''
        ? String(settings.defaultReminderPeriodDays)
        : form.reminderPeriodDays,
  };
}

function formatBasisPointsInput(basisPoints: number): string {
  const wholePart = Math.floor(basisPoints / 100);
  const decimalPart = String(basisPoints % 100).padStart(2, '0');

  return `${wholePart},${decimalPart}`;
}
