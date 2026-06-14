import { EkyApiError, isRecord, requestJson } from '../http.js';
import type {
  Customer,
  CustomersApi,
  CustomerStatus,
  CustomerType,
} from './customersTypes.js';

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

function parseCustomer(value: unknown): Customer {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.companyId !== 'string' ||
    typeof value.customerNumber !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.customerType !== 'string' ||
    typeof value.businessId !== 'string' ||
    typeof value.streetAddress !== 'string' ||
    typeof value.postalCode !== 'string' ||
    typeof value.city !== 'string' ||
    typeof value.email !== 'string' ||
    typeof value.managedByCustomerId !== 'string' ||
    typeof value.phone !== 'string' ||
    typeof value.comment !== 'string' ||
    !isNullableNumber(value.hourlyRateOverrideCents) ||
    typeof value.status !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new EkyApiError('Invalid customer response.', {
      responseBody: value,
    });
  }

  return {
    id: value.id,
    companyId: value.companyId,
    customerNumber: value.customerNumber,
    name: value.name,
    customerType: parseCustomerType(value.customerType),
    businessId: value.businessId,
    streetAddress: value.streetAddress,
    postalCode: value.postalCode,
    city: value.city,
    email: value.email,
    managedByCustomerId: value.managedByCustomerId,
    phone: value.phone,
    comment: value.comment,
    hourlyRateOverrideCents: value.hourlyRateOverrideCents,
    status: parseCustomerStatus(value.status),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function parseCustomerStatus(value: string): CustomerStatus {
  if (value === 'active' || value === 'inactive') {
    return value;
  }

  throw new EkyApiError('Invalid customer response.', { responseBody: value });
}

function parseCustomerType(value: string): CustomerType {
  if (
    value === 'company' ||
    value === 'housingCompany' ||
    value === 'other' ||
    value === 'privatePerson' ||
    value === 'propertyManager'
  ) {
    return value;
  }

  throw new EkyApiError('Invalid customer response.', { responseBody: value });
}
