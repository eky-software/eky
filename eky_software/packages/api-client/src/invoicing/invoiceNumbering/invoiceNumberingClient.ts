import { requestJson } from '../../http.js';
import { readInvoiceNumberingSettingsResponse } from './invoiceNumberingResponse.js';
import { serializeInvoiceNumberingSettingsInput } from './invoiceNumberingSerialization.js';
import type {
  InvoiceNumberingSettingsApi,
  InvoiceNumberingSettingsView,
  UpdateInvoiceNumberingSettingsRequest,
} from './invoiceNumberingTypes.js';

export function createInvoiceNumberingSettingsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): InvoiceNumberingSettingsApi {
  return {
    async getInvoiceNumberingSettings(): Promise<InvoiceNumberingSettingsView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoice-numbering-settings',
      );

      return readInvoiceNumberingSettingsResponse(responseBody);
    },

    async updateInvoiceNumberingSettings(
      input: UpdateInvoiceNumberingSettingsRequest,
    ): Promise<InvoiceNumberingSettingsView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoice-numbering-settings',
        {
          body: JSON.stringify(serializeInvoiceNumberingSettingsInput(input)),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'PUT',
        },
      );

      return readInvoiceNumberingSettingsResponse(responseBody);
    },
  };
}
