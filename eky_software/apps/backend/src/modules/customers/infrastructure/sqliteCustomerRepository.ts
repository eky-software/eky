import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CustomerRow, NewCustomerRow } from '../../../database/schema.js';
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
  constructor(private readonly database: DatabaseConnection) {}

  async create(customer: Customer): Promise<Customer> {
    const row = toCustomerRow(customer);

    this.database
      .prepare<[string, string, string, string, string]>(
        `
          INSERT INTO customers (id, company_id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(row.id, row.company_id, row.name, row.created_at, row.updated_at);

    return customer;
  }

  async listByCompanyId(companyId: string): Promise<Customer[]> {
    const rows = this.database
      .prepare<[string], CustomerRow>(
        `
          SELECT id, company_id, name, created_at, updated_at
          FROM customers
          WHERE company_id = ?
          ORDER BY created_at DESC
        `,
      )
      .all(companyId);

    return rows.map(toCustomer);
  }
}
