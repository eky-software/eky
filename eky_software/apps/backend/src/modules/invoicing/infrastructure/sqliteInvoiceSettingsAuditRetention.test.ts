import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { SqliteInvoiceSettingsAuditRetention } from './sqliteInvoiceSettingsAuditRetention.js';

describe('SqliteInvoiceSettingsAuditRetention', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
  });

  afterEach(() => database.close());

  it('deletes only settings audit events strictly before the cutoff', async () => {
    insertAudit(database, 'old', '2018-12-31T23:59:59.999Z');
    insertAudit(database, 'boundary', '2019-01-01T00:00:00.000Z');

    const retention = new SqliteInvoiceSettingsAuditRetention(database);

    await expect(
      retention.deleteInvoiceSettingsAuditEventsBefore(
        '2019-01-01T00:00:00.000Z',
      ),
    ).resolves.toBe(1);
    expect(
      database
        .prepare('SELECT id FROM invoice_settings_audit_events ORDER BY id')
        .all(),
    ).toEqual([{ id: 'boundary' }]);
  });
});

function insertAudit(
  database: DatabaseConnection,
  id: string,
  occurredAt: string,
): void {
  database
    .prepare(
      `
        INSERT INTO invoice_settings_audit_events (
          id, company_id, actor_user_id, action, outcome, occurred_at
        ) VALUES (?, 'company-1', 'actor-1',
          'invoiceVatRates.updated', 'success', ?)
      `,
    )
    .run(id, occurredAt);
}
