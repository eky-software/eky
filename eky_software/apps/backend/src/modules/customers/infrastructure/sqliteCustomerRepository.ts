import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CustomerRow, NewCustomerRow } from '../../../database/schema.js';
import type { Customer } from '../domain/customer.js';
import type {
  CustomerAuditEvent,
  CustomerChangedFieldCategory,
} from '../domain/customerAuditEvent.js';
import { CustomerValidationError } from '../domain/customerRules.js';
import { CustomerAuditWriteError } from '../ports/customerAuditWriteError.js';
import type { CustomerRepository } from '../ports/customerRepository.js';

type CustomerInsertParameters = [
  string, // id
  string, // company_id
  string, // customer_number
  string, // name
  string, // customer_type
  string, // managed_by_customer_id
  string, // business_id
  string, // street_address
  string, // postal_code
  string, // city
  string, // email
  string, // phone
  string, // comment
  number | null, // hourly_rate_override_cents
  string, // status
  string, // created_at
  string, // updated_at
];

type CustomerUpdateParameters = [
  string, // customer_number
  string, // name
  string, // customer_type
  string, // managed_by_customer_id
  string, // business_id
  string, // street_address
  string, // postal_code
  string, // city
  string, // email
  string, // phone
  string, // comment
  number | null, // hourly_rate_override_cents
  string, // status
  string, // updated_at
  string, // company_id
  string, // id
];

interface CustomerNumberRow {
  customer_number: string;
}

const customerAuditCategories = new Set<CustomerChangedFieldCategory>([
  'billing',
  'contact',
  'identity',
  'pricing',
  'status',
]);

function toCustomerRow(customer: Customer): NewCustomerRow {
  return {
    id: customer.id,
    company_id: customer.companyId,
    customer_number: customer.customerNumber,
    name: customer.name,
    customer_type: customer.customerType,
    managed_by_customer_id: customer.managedByCustomerId,
    business_id: customer.businessId,
    street_address: customer.streetAddress,
    postal_code: customer.postalCode,
    city: customer.city,
    email: customer.email,
    phone: customer.phone,
    comment: customer.comment,
    hourly_rate_override_cents: customer.hourlyRateOverrideCents,
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
    managedByCustomerId: row.managed_by_customer_id,
    businessId: row.business_id,
    streetAddress: row.street_address,
    postalCode: row.postal_code,
    city: row.city,
    email: row.email,
    phone: row.phone,
    comment: row.comment,
    hourlyRateOverrideCents: row.hourly_rate_override_cents,
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

  async create(
    customer: Customer,
    auditEvent: CustomerAuditEvent,
  ): Promise<Customer> {
    const row = toCustomerRow(customer);
    this.assertAuditEventMatchesCustomer(auditEvent, customer);

    try {
      this.database.transaction(() => {
        this.insertCustomer(row);
        this.insertAuditEvent(auditEvent);
      })();
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
            managed_by_customer_id,
            business_id,
            street_address,
            postal_code,
            city,
            email,
            phone,
            comment,
            hourly_rate_override_cents,
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

  async findById(companyId: string, id: string): Promise<Customer | undefined> {
    const row = this.database
      .prepare<[string, string], CustomerRow>(
        `
          SELECT
            id,
            company_id,
            customer_number,
            name,
            customer_type,
            managed_by_customer_id,
            business_id,
            street_address,
            postal_code,
            city,
            email,
            phone,
            comment,
            hourly_rate_override_cents,
            status,
            created_at,
            updated_at
          FROM customers
          WHERE company_id = ? AND id = ?
        `,
      )
      .get(companyId, id);

    return row === undefined ? undefined : toCustomer(row);
  }

  async getNextCustomerNumber(companyId: string): Promise<string> {
    const rows = this.database
      .prepare<[string], CustomerNumberRow>(
        `
          SELECT customer_number
          FROM customers
          WHERE company_id = ?
        `,
      )
      .all(companyId);
    const highestNumber = rows.reduce((currentHighestNumber, row) => {
      if (!/^\d+$/.test(row.customer_number)) {
        return currentHighestNumber;
      }

      return Math.max(currentHighestNumber, Number(row.customer_number));
    }, 1000);

    return String(highestNumber + 1);
  }

  async update(
    customer: Customer,
    auditEvent: CustomerAuditEvent,
  ): Promise<Customer> {
    const row = toCustomerRow(customer);
    this.assertAuditEventMatchesCustomer(auditEvent, customer);

    try {
      this.database.transaction(() => {
        this.updateCustomer(row);
        this.insertAuditEvent(auditEvent);
      })();
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new CustomerValidationError('Customer number already exists.');
      }

      throw error;
    }

    return customer;
  }

  private insertAuditEvent(auditEvent: CustomerAuditEvent): void {
    if (
      auditEvent.changedFieldCategories.some(
        (category) => !customerAuditCategories.has(category),
      )
    ) {
      throw new CustomerAuditWriteError();
    }

    try {
      this.database
        .prepare(
          `
            INSERT INTO customer_audit_events (
              id,
              company_id,
              actor_user_id,
              customer_id,
              action,
              changed_field_categories,
              outcome,
              occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          auditEvent.id,
          auditEvent.companyId,
          auditEvent.actorUserId,
          auditEvent.customerId,
          auditEvent.action,
          JSON.stringify(auditEvent.changedFieldCategories),
          auditEvent.outcome,
          auditEvent.occurredAt,
        );
    } catch {
      throw new CustomerAuditWriteError();
    }
  }

  private assertAuditEventMatchesCustomer(
    auditEvent: CustomerAuditEvent,
    customer: Customer,
  ): void {
    if (
      auditEvent.companyId !== customer.companyId ||
      auditEvent.customerId !== customer.id
    ) {
      throw new CustomerAuditWriteError();
    }
  }

  private insertCustomer(row: NewCustomerRow): void {
    this.database
      .prepare<CustomerInsertParameters>(
        `
          INSERT INTO customers (
            id,
            company_id,
            customer_number,
            name,
            customer_type,
            managed_by_customer_id,
            business_id,
            street_address,
            postal_code,
            city,
            email,
            phone,
            comment,
            hourly_rate_override_cents,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        row.id,
        row.company_id,
        row.customer_number,
        row.name,
        row.customer_type,
        row.managed_by_customer_id,
        row.business_id,
        row.street_address,
        row.postal_code,
        row.city,
        row.email,
        row.phone,
        row.comment,
        row.hourly_rate_override_cents,
        row.status,
        row.created_at,
        row.updated_at,
      );
  }

  private updateCustomer(row: NewCustomerRow): void {
    this.database
      .prepare<CustomerUpdateParameters>(
        `
          UPDATE customers
          SET
            customer_number = ?,
            name = ?,
            customer_type = ?,
            managed_by_customer_id = ?,
            business_id = ?,
            street_address = ?,
            postal_code = ?,
            city = ?,
            email = ?,
            phone = ?,
            comment = ?,
            hourly_rate_override_cents = ?,
            status = ?,
            updated_at = ?
          WHERE company_id = ? AND id = ?
        `,
      )
      .run(
        row.customer_number,
        row.name,
        row.customer_type,
        row.managed_by_customer_id,
        row.business_id,
        row.street_address,
        row.postal_code,
        row.city,
        row.email,
        row.phone,
        row.comment,
        row.hourly_rate_override_cents,
        row.status,
        row.updated_at,
        row.company_id,
        row.id,
      );
  }
}
