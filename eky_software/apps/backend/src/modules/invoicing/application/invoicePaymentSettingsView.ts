import type {
  InvoicePaymentSettings,
  StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';

export interface InvoicePaymentSettingsView extends InvoicePaymentSettings {
  isPersisted: boolean;
}

export const defaultInvoicePaymentSettings: InvoicePaymentSettings = {
  defaultLatePaymentInterestBasisPoints: 0,
  defaultReminderPeriodDays: 8,
};

export function toInvoicePaymentSettingsView(
  settings: StoredInvoicePaymentSettings | undefined,
): InvoicePaymentSettingsView {
  if (settings === undefined) {
    return {
      ...defaultInvoicePaymentSettings,
      isPersisted: false,
    };
  }

  return {
    defaultLatePaymentInterestBasisPoints:
      settings.defaultLatePaymentInterestBasisPoints,
    defaultReminderPeriodDays: settings.defaultReminderPeriodDays,
    isPersisted: true,
  };
}
