import type { Customer } from '../domain/customer.js';

export interface CustomerDetailReader {
  findById(companyId: string, customerId: string): Promise<Customer | undefined>;
}
