import type { Kysely } from 'kysely';

import type { DatabaseSchema, CustomerRow, NewCustomerRow } from '../../../database/schema.js';
import type { Customer } from '../domain/customer.js';
import type { CustomerRepository } from '../ports/customerRepository.js';

function toCustomerRow(customer: Customer): NewCustomerRow {
  return {
    id: customer.id,
    company_id: customer.companyId,
    name: customer.name,
    created_at: customer.createdAt,
    updated_at: customer.updatedAt,
  };
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteCustomerRepository implements CustomerRepository {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async create(customer: Customer): Promise<Customer> {
    await this.database.insertInto('customers').values(toCustomerRow(customer)).execute();

    return customer;
  }

  async listByCompanyId(companyId: string): Promise<Customer[]> {
    const rows = await this.database
      .selectFrom('customers')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(toCustomer);
  }
}
