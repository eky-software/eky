import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { SqliteCustomerHistoryReader } from './sqliteCustomerHistoryReader.js';

describe('SqliteCustomerHistoryReader', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
  });

  afterEach(() => database.close());

  it('scopes activity by company and customer and orders newest first', async () => {
    insertCustomer(database, 'customer-1', 'company-1');
    insertCustomer(database, 'customer-2', 'company-1');
    insertCustomer(database, 'customer-3', 'company-2');
    insertAudit(database, 'event-old', 'company-1', 'customer-1', '2026-07-01T10:00:00.000Z');
    insertAudit(database, 'event-new', 'company-1', 'customer-1', '2026-07-02T10:00:00.000Z');
    insertAudit(database, 'event-other-customer', 'company-1', 'customer-2', '2026-07-03T10:00:00.000Z');
    insertAudit(database, 'event-other-company', 'company-2', 'customer-3', '2026-07-04T10:00:00.000Z');

    const entries = await new SqliteCustomerHistoryReader(
      database,
    ).listCustomerHistory({
      companyId: 'company-1',
      customerId: 'customer-1',
      limit: 20,
      offset: 0,
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      'event-new',
      'event-old',
    ]);
    expect(JSON.stringify(entries)).not.toContain('Synthetic Customer');
  });

  it('applies limit and offset without returning field values', async () => {
    insertCustomer(database, 'customer-1', 'company-1');
    insertAudit(database, 'event-1', 'company-1', 'customer-1', '2026-07-01T10:00:00.000Z');
    insertAudit(database, 'event-2', 'company-1', 'customer-1', '2026-07-02T10:00:00.000Z');
    insertAudit(database, 'event-3', 'company-1', 'customer-1', '2026-07-03T10:00:00.000Z');

    await expect(
      new SqliteCustomerHistoryReader(database).listCustomerHistory({
        companyId: 'company-1',
        customerId: 'customer-1',
        limit: 1,
        offset: 1,
      }),
    ).resolves.toEqual([
      {
        action: 'customer.updated',
        changeCategories: ['contact'],
        id: 'event-2',
        occurredAt: '2026-07-02T10:00:00.000Z',
      },
    ]);
  });
});

function insertCustomer(
  database: DatabaseConnection,
  id: string,
  companyId: string,
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
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      `${companyId}-${id}`,
    );
}

function insertAudit(
  database: DatabaseConnection,
  id: string,
  companyId: string,
  customerId: string,
  occurredAt: string,
): void {
  database
    .prepare(
      `
        INSERT INTO customer_audit_events (
          id, company_id, actor_user_id, customer_id, action,
          changed_field_categories, outcome, occurred_at
        ) VALUES (?, ?, 'actor-1', ?, 'customer.updated', '["contact"]',
          'success', ?)
      `,
    )
    .run(id, companyId, customerId, occurredAt);
}
