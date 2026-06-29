export interface InvoicePaymentSettingsView {
  defaultLatePaymentInterestBasisPoints: number;
  defaultReminderPeriodDays: number;
  isPersisted: boolean;
}

export interface UpdateInvoicePaymentSettingsRequest {
  defaultLatePaymentInterestBasisPoints: number;
  defaultReminderPeriodDays: number;
}

export interface InvoicePaymentSettingsApi {
  getInvoicePaymentSettings(): Promise<InvoicePaymentSettingsView>;
  updateInvoicePaymentSettings(
    input: UpdateInvoicePaymentSettingsRequest,
  ): Promise<InvoicePaymentSettingsView>;
}
