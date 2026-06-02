import type { Customer } from '../domain/customer.js';

export interface CustomerRepository {
  create(customer: Customer): Promise<Customer>;
  findById(companyId: string, id: string): Promise<Customer | undefined>;
  getNextCustomerNumber(companyId: string): Promise<string>;
  listByCompanyId(companyId: string): Promise<Customer[]>;
  update(customer: Customer): Promise<Customer>;
}
