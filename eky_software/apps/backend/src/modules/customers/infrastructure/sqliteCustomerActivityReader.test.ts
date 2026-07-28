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

    await expect(reader.listCustomerActivity({
      companyId: 'company-1',
      limit: 10,
      occurredAtFrom: '2026-07-01T00:00:00.000Z',
      occurredAtTo: '2026-08-01T00:00:00.000Z',
    })).resolves.toEqual([
      {
        action: 'customer.updated',
        changeCategories: ['status'],
        customerNumber: '1001',
        id: 'event-1',
        occurredAt: '2026-07-27T10:00:00.000Z',
      },
    ]);
  });

  it('uses an inclusive start and exclusive end month boundary', async () => {
    insertCustomer(database, 'customer-1', 'company-1', '1001');
    insertAuditAt(
      database,
      'event-before',
      'company-1',
      'customer-1',
      '2026-06-30T23:59:59.999Z',
    );
    insertAuditAt(
      database,
      'event-start',
      'company-1',
      'customer-1',
      '2026-07-01T00:00:00.000Z',
    );
    insertAuditAt(
      database,
      'event-end',
      'company-1',
      'customer-1',
      '2026-08-01T00:00:00.000Z',
    );
    const reader = new SqliteCustomerActivityReader(database);

    const entries = await reader.listCustomerActivity({
      companyId: 'company-1',
      limit: 10,
      occurredAtFrom: '2026-07-01T00:00:00.000Z',
      occurredAtTo: '2026-08-01T00:00:00.000Z',
    });

    expect(entries.map((entry) => entry.id)).toEqual(['event-start']);
  });

  it('rejects unknown or duplicate audit categories without exposing values', async () => {
    insertCustomer(database, 'customer-1', 'company-1', '1001');
    database
      .prepare(
        `
          INSERT INTO customer_audit_events (
            id, company_id, actor_user_id, customer_id, action,
            changed_field_categories, outcome, occurred_at
          ) VALUES (
            'invalid-event', 'company-1', 'actor-1', 'customer-1',
            'customer.updated', '["contact","contact"]', 'success',
            '2026-07-27T10:00:00.000Z'
          )
        `,
      )
      .run();

    await expect(
      new SqliteCustomerActivityReader(database).listCustomerActivity({
        companyId: 'company-1',
        limit: 10,
        occurredAtFrom: '2026-07-01T00:00:00.000Z',
        occurredAtTo: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('CUSTOMER_ACTIVITY_CHANGE_CATEGORIES_INVALID');
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
  insertAuditAt(
    database,
    id,
    companyId,
    customerId,
    '2026-07-27T10:00:00.000Z',
  );
}

function insertAuditAt(
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
        ) VALUES (?, ?, 'actor-1', ?, 'customer.updated', '["status"]',
          'success', ?)
      `,
    )
    .run(id, companyId, customerId, occurredAt);
}
