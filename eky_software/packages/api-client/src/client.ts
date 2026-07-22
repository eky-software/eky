import {
  createCompanySettingsApi,
  type CompanySettingsApi,
} from './companySettings/index.js';
import {
  createApprovedInvoicesApi,
  type ApprovedInvoicesApi,
} from './invoicing/approvedInvoices/index.js';
import {
  createCustomersApi,
  type CustomersApi,
} from './customers/index.js';
import { normalizeBaseUrl, type EkyApiClientOptions } from './http.js';
import {
  createInvoiceDraftsApi,
  type InvoiceDraftsApi,
} from './invoicing/invoiceDrafts/index.js';
import {
  createInvoiceNumberingSettingsApi,
  type InvoiceNumberingSettingsApi,
} from './invoicing/invoiceNumbering/index.js';
import {
  createInvoicePaymentSettingsApi,
  type InvoicePaymentSettingsApi,
} from './invoicing/invoicePaymentSettings/index.js';
import {
  createInvoiceVatRatesApi,
  type InvoiceVatRatesApi,
} from './invoicing/invoiceVatRates/index.js';

export interface EkyApiClient
  extends
    CustomersApi,
    CompanySettingsApi,
    ApprovedInvoicesApi,
    InvoiceDraftsApi,
    InvoiceNumberingSettingsApi,
    InvoicePaymentSettingsApi,
    InvoiceVatRatesApi {}

export function createEkyApiClient(options: EkyApiClientOptions): EkyApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? fetch;

  return {
    ...createCustomersApi(fetchImplementation, baseUrl),
    ...createCompanySettingsApi(fetchImplementation, baseUrl),
    ...createApprovedInvoicesApi(fetchImplementation, baseUrl),
    ...createInvoiceDraftsApi(fetchImplementation, baseUrl),
    ...createInvoiceNumberingSettingsApi(fetchImplementation, baseUrl),
    ...createInvoicePaymentSettingsApi(fetchImplementation, baseUrl),
    ...createInvoiceVatRatesApi(fetchImplementation, baseUrl),
  };
}

export type { EkyApiClientOptions } from './http.js';
