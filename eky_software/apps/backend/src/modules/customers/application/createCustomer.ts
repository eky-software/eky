import { randomUUID } from 'node:crypto';

import { createCustomerRecord, type Customer } from '../domain/customer.js';
import {
  normalizeCustomerComment,
  normalizeCustomerName,
  normalizeCustomerNumber,
  normalizeOptionalCustomerField,
  parseCustomerStatus,
  parseCustomerType,
} from '../domain/customerRules.js';
import type { CustomerRepository } from '../ports/customerRepository.js';

export interface CreateCustomerInput {
  businessId: string;
  city: string;
  comment: string;
  companyId: string;
  customerNumber: string;
  customerType: string;
  email: string;
  name: string;
  phone: string;
  postalCode: string;
  status: string;
  streetAddress: string;
}

export async function createCustomer(
  input: CreateCustomerInput,
  customerRepository: CustomerRepository,
): Promise<Customer> {
  const customer = createCustomerRecord({
    id: randomUUID(),
    businessId: normalizeOptionalCustomerField(input.businessId, 'Customer business id'),
    city: normalizeOptionalCustomerField(input.city, 'Customer city'),
    comment: normalizeCustomerComment(input.comment),
    companyId: input.companyId,
    customerNumber: normalizeCustomerNumber(input.customerNumber),
    customerType: parseCustomerType(input.customerType),
    email: normalizeOptionalCustomerField(input.email, 'Customer email'),
    name: normalizeCustomerName(input.name),
    now: new Date().toISOString(),
    phone: normalizeOptionalCustomerField(input.phone, 'Customer phone'),
    postalCode: normalizeOptionalCustomerField(input.postalCode, 'Customer postal code'),
    status: parseCustomerStatus(input.status),
    streetAddress: normalizeOptionalCustomerField(input.streetAddress, 'Customer street address'),
  });

  return customerRepository.create(customer);
}
