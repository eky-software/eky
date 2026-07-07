import type {
  UpdateInvoicePaymentSettingsRequest,
} from './invoicePaymentSettingsTypes.js';

export function serializeInvoicePaymentSettingsInput(
  input: UpdateInvoicePaymentSettingsRequest,
): UpdateInvoicePaymentSettingsRequest {
  return {
    defaultLatePaymentInterestBasisPoints:
      input.defaultLatePaymentInterestBasisPoints,
    defaultReminderPeriodDays: input.defaultReminderPeriodDays,
  };
}
