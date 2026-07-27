import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { SqliteCustomerAuditRetention } from './sqliteCustomerAuditRetention.js';

describe('SqliteCustomerAuditRetention', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
  });

  afterEach(() => database.close());

  it('deletes only events strictly before the calendar cutoff', async () => {
    insertCustomerAudit(database, 'old', '2018-12-31T23:59:59.999Z');
    insertCustomerAudit(database, 'boundary', '2019-01-01T00:00:00.000Z');

    const retention = new SqliteCustomerAuditRetention(database);

    await expect(
      retention.deleteCustomerAuditEventsBefore(
        '2019-01-01T00:00:00.000Z',
      ),
    ).resolves.toBe(1);
    expect(readIds(database, 'customer_audit_events')).toEqual(['boundary']);
  });
});

function insertCustomerAudit(
  database: DatabaseConnection,
  id: string,
  occurredAt: string,
): void {
  database
    .prepare(
      `
        INSERT INTO customer_audit_events (
          id, company_id, actor_user_id, customer_id, action,
          changed_field_categories, outcome, occurred_at
        ) VALUES (?, 'company-1', 'actor-1', 'customer-1', 'customer.updated',
          '["identity"]', 'success', ?)
      `,
    )
    .run(id, occurredAt);
}

function readIds(database: DatabaseConnection, table: string): string[] {
  return database
    .prepare(`SELECT id FROM ${table} ORDER BY id`)
    .all()
    .map((row) => (row as { id: string }).id);
}
