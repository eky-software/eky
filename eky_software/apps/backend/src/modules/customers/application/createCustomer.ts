import { randomUUID } from 'node:crypto';

import { createCustomerRecord, type Customer } from '../domain/customer.js';
import { normalizeCustomerName } from '../domain/customerRules.js';
import type { CustomerRepository } from '../ports/customerRepository.js';

export interface CreateCustomerInput {
  companyId: string;
  name: string;
}

export async function createCustomer(
  input: CreateCustomerInput,
  customerRepository: CustomerRepository,
): Promise<Customer> {
  const customer = createCustomerRecord({
    id: randomUUID(),
    companyId: input.companyId,
    name: normalizeCustomerName(input.name),
    now: new Date().toISOString(),
  });

  return customerRepository.create(customer);
}
