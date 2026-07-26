import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import type { Customer } from '../domain/customer.js';
import {
  createCustomerCreatedAuditEvent,
  createCustomerUpdatedAuditEvent,
} from '../domain/customerAuditEvent.js';
import { CustomerAuditWriteError } from '../ports/customerAuditWriteError.js';
import { SqliteCustomerRepository } from './sqliteCustomerRepository.js';

describe('SqliteCustomerRepository business audit', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
  });

  afterEach(() => {
    database.close();
  });

  it('writes the customer and its minimized audit event atomically', async () => {
    const repository = new SqliteCustomerRepository(database);
    const customer = createCustomer();

    await repository.create(
      customer,
      createCustomerCreatedAuditEvent({
        actorUserId: 'local-owner',
        customer,
      }),
    );

    await expect(
      repository.findById(customer.companyId, customer.id),
    ).resolves.toEqual(customer);
    expect(readAuditRows(database)).toEqual([
      expect.objectContaining({
        action: 'customer.created',
        actor_user_id: 'local-owner',
        company_id: 'dev-company',
        customer_id: 'customer-1',
        outcome: 'success',
      }),
    ]);
    const serializedAudit = JSON.stringify(readAuditRows(database));
    expect(serializedAudit).not.toContain(customer.name);
    expect(serializedAudit).not.toContain(customer.email);
    expect(serializedAudit).not.toContain(customer.businessId);
  });

  it('rolls back customer creation when the mandatory audit write fails', async () => {
    const repository = new SqliteCustomerRepository(database);
    const customer = createCustomer();
    database.exec('DROP TABLE customer_audit_events;');

    await expect(
      repository.create(
        customer,
        createCustomerCreatedAuditEvent({
          actorUserId: 'local-owner',
          customer,
        }),
      ),
    ).rejects.toBeInstanceOf(CustomerAuditWriteError);

    expect(
      database.prepare('SELECT COUNT(*) AS count FROM customers').get(),
    ).toEqual({ count: 0 });
  });

  it('rolls back customer updates when the mandatory audit write fails', async () => {
    const repository = new SqliteCustomerRepository(database);
    const customer = createCustomer();
    await repository.create(
      customer,
      createCustomerCreatedAuditEvent({
        actorUserId: 'local-owner',
        customer,
      }),
    );
    const updatedCustomer: Customer = {
      ...customer,
      name: 'Changed Customer Oy',
      updatedAt: '2026-07-28T00:00:00.000Z',
    };
    database.exec('DROP TABLE customer_audit_events;');

    await expect(
      repository.update(
        updatedCustomer,
        createCustomerUpdatedAuditEvent({
          actorUserId: 'local-owner',
          current: customer,
          updated: updatedCustomer,
        }),
      ),
    ).rejects.toBeInstanceOf(CustomerAuditWriteError);

    await expect(
      repository.findById(customer.companyId, customer.id),
    ).resolves.toEqual(customer);
  });
});

function createCustomer(): Customer {
  return {
    businessId: '1234567-8',
    city: 'Helsinki',
    comment: 'Synthetic test note',
    companyId: 'dev-company',
    createdAt: '2026-07-27T00:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'synthetic@example.invalid',
    hourlyRateOverrideCents: 6500,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Synthetic Customer Oy',
    phone: '040 000 0000',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Testikatu 1',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

function readAuditRows(database: DatabaseConnection): unknown[] {
  return database
    .prepare(
      `
        SELECT
          company_id,
          actor_user_id,
          customer_id,
          action,
          changed_field_categories,
          outcome,
          occurred_at
        FROM customer_audit_events
        ORDER BY occurred_at, id
      `,
    )
    .all();
}
