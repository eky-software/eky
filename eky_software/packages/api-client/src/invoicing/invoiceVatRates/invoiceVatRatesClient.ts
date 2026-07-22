import { requestJson } from '../../http.js';
import { readInvoiceVatRatesResponse } from './invoiceVatRatesResponse.js';
import { serializeInvoiceVatRatesInput } from './invoiceVatRatesSerialization.js';
import type {
  InvoiceVatRatesApi,
  InvoiceVatRatesView,
  UpdateInvoiceVatRatesRequest,
} from './invoiceVatRatesTypes.js';

export function createInvoiceVatRatesApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): InvoiceVatRatesApi {
  return {
    async getInvoiceVatRates(): Promise<InvoiceVatRatesView> {
      return readInvoiceVatRatesResponse(
        await requestJson(
          fetchImplementation,
          baseUrl,
          '/invoice-vat-rates',
        ),
      );
    },

    async updateInvoiceVatRates(
      input: UpdateInvoiceVatRatesRequest,
    ): Promise<InvoiceVatRatesView> {
      return readInvoiceVatRatesResponse(
        await requestJson(
          fetchImplementation,
          baseUrl,
          '/invoice-vat-rates',
          {
            body: JSON.stringify(serializeInvoiceVatRatesInput(input)),
            headers: { 'Content-Type': 'application/json' },
            method: 'PUT',
          },
        ),
      );
    },
  };
}
