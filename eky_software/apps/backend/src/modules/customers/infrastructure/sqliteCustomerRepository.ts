import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CustomerRow, NewCustomerRow } from '../../../database/schema.js';
import type { Customer } from '../domain/customer.js';
import { CustomerValidationError } from '../domain/customerRules.js';
import type { CustomerRepository } from '../ports/customerRepository.js';

type CustomerInsertParameters = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

function toCustomerRow(customer: Customer): NewCustomerRow {
  return {
    id: customer.id,
    company_id: customer.companyId,
    customer_number: customer.customerNumber,
    name: customer.name,
    customer_type: customer.customerType,
    business_id: customer.businessId,
    street_address: customer.streetAddress,
    postal_code: customer.postalCode,
    city: customer.city,
    email: customer.email,
    phone: customer.phone,
    comment: customer.comment,
    status: customer.status,
    created_at: customer.createdAt,
    updated_at: customer.updatedAt,
  };
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    companyId: row.company_id,
    customerNumber: row.customer_number,
    name: row.name,
    customerType: row.customer_type as Customer['customerType'],
    businessId: row.business_id,
    streetAddress: row.street_address,
    postalCode: row.postal_code,
    city: row.city,
    email: row.email,
    phone: row.phone,
    comment: row.comment,
    status: row.status as Customer['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export class SqliteCustomerRepository implements CustomerRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async create(customer: Customer): Promise<Customer> {
    const row = toCustomerRow(customer);

    try {
      this.database
        .prepare<CustomerInsertParameters>(
          `
            INSERT INTO customers (
              id,
              company_id,
              customer_number,
              name,
              customer_type,
              business_id,
              street_address,
              postal_code,
              city,
              email,
              phone,
              comment,
              status,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          row.id,
          row.company_id,
          row.customer_number,
          row.name,
          row.customer_type,
          row.business_id,
          row.street_address,
          row.postal_code,
          row.city,
          row.email,
          row.phone,
          row.comment,
          row.status,
          row.created_at,
          row.updated_at,
        );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new CustomerValidationError('Customer number already exists.');
      }

      throw error;
    }

    return customer;
  }

  async listByCompanyId(companyId: string): Promise<Customer[]> {
    const rows = this.database
      .prepare<[string], CustomerRow>(
        `
          SELECT
            id,
            company_id,
            customer_number,
            name,
            customer_type,
            business_id,
            street_address,
            postal_code,
            city,
            email,
            phone,
            comment,
            status,
            created_at,
            updated_at
          FROM customers
          WHERE company_id = ?
          ORDER BY created_at DESC
        `,
      )
      .all(companyId);

    return rows.map(toCustomer);
  }
}
