import type { Customer } from '../domain/customer.js';

export interface CustomerRepository {
  create(customer: Customer): Promise<Customer>;
  listByCompanyId(companyId: string): Promise<Customer[]>;
}
