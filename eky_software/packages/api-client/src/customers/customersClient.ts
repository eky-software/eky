import { EkyApiError, isRecord, requestJson } from '../http.js';
import type {
  Customer,
  CustomerActivityPage,
  CustomerActivityQuery,
  CustomersApi,
} from './customersTypes.js';
import {
  parseCustomer,
  parseCustomerActivityPage,
} from './customersResponse.js';

export function createCustomersApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): CustomersApi {
  return {
    async createCustomer(input): Promise<Customer> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/customers',
        {
          body: JSON.stringify(input),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      if (!isRecord(responseBody)) {
        throw new EkyApiError('Invalid customer response.', { responseBody });
      }

      return parseCustomer(responseBody.customer);
    },

    async getCustomer(id): Promise<Customer> {
      const customerId = requireCustomerId(id);
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/customers/${customerId}`,
      );

      if (
        !isRecord(responseBody) ||
        Object.keys(responseBody).some((key) => key !== 'customer')
      ) {
        throw new EkyApiError('Invalid customer response.', { responseBody });
      }

      return parseCustomer(responseBody.customer);
    },

    async listCustomerActivity(id, query = {}): Promise<CustomerActivityPage> {
      const customerId = requireCustomerId(id);
      const queryString = serializeCustomerActivityQuery(query);
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/customers/${customerId}/activity${queryString}`,
      );

      if (
        !isRecord(responseBody) ||
        Object.keys(responseBody).some(
          (key) => key !== 'customerActivityPage',
        )
      ) {
        throw new EkyApiError('Invalid customer activity response.', {
          responseBody,
        });
      }

      return parseCustomerActivityPage(responseBody.customerActivityPage);
    },

    async listCustomers(): Promise<Customer[]> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/customers',
      );

      if (!isRecord(responseBody) || !Array.isArray(responseBody.customers)) {
        throw new EkyApiError('Invalid customers response.', { responseBody });
      }

      return responseBody.customers.map(parseCustomer);
    },

    async updateCustomer(id, input): Promise<Customer> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/customers/${id}`,
        {
          body: JSON.stringify(input),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'PUT',
        },
      );

      if (!isRecord(responseBody)) {
        throw new EkyApiError('Invalid customer response.', { responseBody });
      }

      return parseCustomer(responseBody.customer);
    },
  };
}

function requireCustomerId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new EkyApiError('Customer id is invalid.');
  }

  return value;
}

function serializeCustomerActivityQuery(query: CustomerActivityQuery): string {
  if (
    query.page !== undefined &&
    (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 100)
  ) {
    throw new EkyApiError('Customer activity query is invalid.');
  }
  if (
    query.pageSize !== undefined &&
    query.pageSize !== 20 &&
    query.pageSize !== 50
  ) {
    throw new EkyApiError('Customer activity query is invalid.');
  }

  const searchParameters = new URLSearchParams();

  if (query.page !== undefined) {
    searchParameters.set('page', String(query.page));
  }
  if (query.pageSize !== undefined) {
    searchParameters.set('pageSize', String(query.pageSize));
  }

  const serialized = searchParameters.toString();

  return serialized.length === 0 ? '' : `?${serialized}`;
}
