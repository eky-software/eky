import type { Customer } from '../domain/customer.js';
import type { CustomerRepository } from '../ports/customerRepository.js';

export interface ListCustomersInput {
  companyId: string;
}

export async function listCustomers(
  input: ListCustomersInput,
  customerRepository: CustomerRepository,
): Promise<Customer[]> {
  return customerRepository.listByCompanyId(input.companyId);
}
