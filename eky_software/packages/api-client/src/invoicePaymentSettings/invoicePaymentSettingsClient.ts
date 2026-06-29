import { requestJson } from '../http.js';
import { readInvoicePaymentSettingsResponse } from './invoicePaymentSettingsResponse.js';
import { serializeInvoicePaymentSettingsInput } from './invoicePaymentSettingsSerialization.js';
import type {
  InvoicePaymentSettingsApi,
  InvoicePaymentSettingsView,
  UpdateInvoicePaymentSettingsRequest,
} from './invoicePaymentSettingsTypes.js';

export function createInvoicePaymentSettingsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): InvoicePaymentSettingsApi {
  return {
    async getInvoicePaymentSettings(): Promise<InvoicePaymentSettingsView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoice-payment-settings',
      );

      return readInvoicePaymentSettingsResponse(responseBody);
    },

    async updateInvoicePaymentSettings(
      input: UpdateInvoicePaymentSettingsRequest,
    ): Promise<InvoicePaymentSettingsView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoice-payment-settings',
        {
          body: JSON.stringify(serializeInvoicePaymentSettingsInput(input)),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'PUT',
        },
      );

      return readInvoicePaymentSettingsResponse(responseBody);
    },
  };
}
