import type { Customer } from '../domain/customer.js';
import type { CustomerAuditEvent } from '../domain/customerAuditEvent.js';

export interface CustomerRepository {
  create(
    customer: Customer,
    auditEvent: CustomerAuditEvent,
  ): Promise<Customer>;
  findById(companyId: string, id: string): Promise<Customer | undefined>;
  getNextCustomerNumber(companyId: string): Promise<string>;
  listByCompanyId(companyId: string): Promise<Customer[]>;
  update(
    customer: Customer,
    auditEvent: CustomerAuditEvent,
  ): Promise<Customer>;
}
