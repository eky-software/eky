import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { SqliteCustomerActivityReader } from './sqliteCustomerActivityReader.js';

describe('SqliteCustomerActivityReader', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
  });

  afterEach(() => database.close());

  it('returns only same-company activity with customer numbers', async () => {
    insertCustomer(database, 'customer-1', 'company-1', '1001');
    insertCustomer(database, 'customer-2', 'company-2', '2001');
    insertAudit(database, 'event-1', 'company-1', 'customer-1');
    insertAudit(database, 'event-2', 'company-2', 'customer-2');

    const reader = new SqliteCustomerActivityReader(database);

    await expect(reader.listCustomerActivity('company-1', 10)).resolves.toEqual([
      {
        action: 'customer.updated',
        customerNumber: '1001',
        id: 'event-1',
        occurredAt: '2026-07-27T10:00:00.000Z',
      },
    ]);
  });
});

function insertCustomer(
  database: DatabaseConnection,
  id: string,
  companyId: string,
  customerNumber: string,
): void {
  database
    .prepare(
      `
        INSERT INTO customers (
          id, company_id, name, created_at, updated_at, customer_number
        ) VALUES (?, ?, 'Synthetic Customer', ?, ?, ?)
      `,
    )
    .run(
      id,
      companyId,
      '2026-07-27T09:00:00.000Z',
      '2026-07-27T10:00:00.000Z',
      customerNumber,
    );
}

function insertAudit(
  database: DatabaseConnection,
  id: string,
  companyId: string,
  customerId: string,
): void {
  database
    .prepare(
      `
        INSERT INTO customer_audit_events (
          id, company_id, actor_user_id, customer_id, action,
          changed_field_categories, outcome, occurred_at
        ) VALUES (?, ?, 'actor-1', ?, 'customer.updated', '["status"]',
          'success', '2026-07-27T10:00:00.000Z')
      `,
    )
    .run(id, companyId, customerId);
}
