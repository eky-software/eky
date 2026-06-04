import {
  createCompanySettingsApi,
  type CompanySettingsApi,
} from './companySettings.js';
import { createCustomersApi, type CustomersApi } from './customers.js';
import { normalizeBaseUrl, type EkyApiClientOptions } from './http.js';

export interface EkyApiClient extends CustomersApi, CompanySettingsApi {}

export function createEkyApiClient(options: EkyApiClientOptions): EkyApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? fetch;

  return {
    ...createCustomersApi(fetchImplementation, baseUrl),
    ...createCompanySettingsApi(fetchImplementation, baseUrl),
  };
}

export type { EkyApiClientOptions } from './http.js';
