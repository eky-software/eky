import {
  createCompanySettingsApi,
  type CompanySettingsApi,
} from './companySettings/index.js';
import {
  createCustomersApi,
  type CustomersApi,
} from './customers/index.js';
import { normalizeBaseUrl, type EkyApiClientOptions } from './http.js';
import {
  createInvoiceDraftsApi,
  type InvoiceDraftsApi,
} from './invoiceDrafts/index.js';
import {
  createInvoiceNumberingSettingsApi,
  type InvoiceNumberingSettingsApi,
} from './invoiceNumbering/index.js';

export interface EkyApiClient
  extends
    CustomersApi,
    CompanySettingsApi,
    InvoiceDraftsApi,
    InvoiceNumberingSettingsApi {}

export function createEkyApiClient(options: EkyApiClientOptions): EkyApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? fetch;

  return {
    ...createCustomersApi(fetchImplementation, baseUrl),
    ...createCompanySettingsApi(fetchImplementation, baseUrl),
    ...createInvoiceDraftsApi(fetchImplementation, baseUrl),
    ...createInvoiceNumberingSettingsApi(fetchImplementation, baseUrl),
  };
}

export type { EkyApiClientOptions } from './http.js';
