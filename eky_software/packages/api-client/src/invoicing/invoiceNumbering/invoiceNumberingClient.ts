import { requestJson } from '../../http.js';
import {
  readInvoiceNumberingSeriesActivationPreviewResponse,
  readInvoiceNumberingSeriesOverviewResponse,
  readInvoiceNumberingSettingsResponse,
} from './invoiceNumberingResponse.js';
import {
  serializeActivateInvoiceNumberingSeriesInput,
  serializeInvoiceNumberingSeriesActivationPreviewQuery,
  serializeInvoiceNumberingSettingsInput,
} from './invoiceNumberingSerialization.js';
import type {
  ActivateInvoiceNumberingSeriesRequest,
  InvoiceNumberingSettingsApi,
  InvoiceNumberingSettingsView,
  InvoiceNumberingSeriesActivationPreviewQuery,
  InvoiceNumberingSeriesActivationPreviewView,
  InvoiceNumberingSeriesOverviewView,
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

    async getInvoiceNumberingSeriesOverview(): Promise<InvoiceNumberingSeriesOverviewView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoice-numbering-series',
      );

      return readInvoiceNumberingSeriesOverviewResponse(responseBody);
    },

    async previewInvoiceNumberingSeriesActivation(
      query: InvoiceNumberingSeriesActivationPreviewQuery,
    ): Promise<InvoiceNumberingSeriesActivationPreviewView> {
      const queryString =
        serializeInvoiceNumberingSeriesActivationPreviewQuery(query);
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-numbering-series/activation-preview?${queryString}`,
      );

      return readInvoiceNumberingSeriesActivationPreviewResponse(responseBody);
    },

    async activateInvoiceNumberingSeries(
      input: ActivateInvoiceNumberingSeriesRequest,
    ): Promise<InvoiceNumberingSeriesOverviewView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoice-numbering-series/activate',
        {
          body: JSON.stringify(
            serializeActivateInvoiceNumberingSeriesInput(input),
          ),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      return readInvoiceNumberingSeriesOverviewResponse(responseBody);
    },
  };
}
