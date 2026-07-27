import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { SqliteCompanySettingsAuditRetention } from './sqliteCompanySettingsAuditRetention.js';

describe('SqliteCompanySettingsAuditRetention', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
  });

  afterEach(() => database.close());

  it('deletes expired settings and completed secret events but keeps pending events', async () => {
    insertSettingsAudit(database, 'old', '2018-12-31T23:59:59.999Z');
    insertSettingsAudit(database, 'boundary', '2019-01-01T00:00:00.000Z');
    insertSecretAudit(database, 'completed', 'succeeded', '2018-12-31T23:59:59.999Z');
    insertSecretAudit(database, 'pending', 'pending', null);

    const retention = new SqliteCompanySettingsAuditRetention(database);

    await expect(
      retention.deleteCompanySettingsAuditEventsBefore(
        '2019-01-01T00:00:00.000Z',
      ),
    ).resolves.toBe(2);
    expect(readIds(database, 'company_settings_audit_events', 'id')).toEqual([
      'boundary',
    ]);
    expect(
      readIds(
        database,
        'company_email_secret_audit_events',
        'operation_id',
      ),
    ).toEqual(['pending']);
  });

  it('rolls back all company settings audit deletes when one delete fails', async () => {
    insertSettingsAudit(database, 'old', '2018-12-31T23:59:59.999Z');
    insertSecretAudit(database, 'completed', 'succeeded', '2018-12-31T23:59:59.999Z');
    database.exec(`
      CREATE TRIGGER reject_secret_audit_delete
      BEFORE DELETE ON company_email_secret_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'test delete failure');
      END;
    `);

    const retention = new SqliteCompanySettingsAuditRetention(database);

    await expect(
      retention.deleteCompanySettingsAuditEventsBefore(
        '2019-01-01T00:00:00.000Z',
      ),
    ).rejects.toThrow();
    expect(readIds(database, 'company_settings_audit_events', 'id')).toEqual([
      'old',
    ]);
  });
});

function insertSettingsAudit(
  database: DatabaseConnection,
  id: string,
  occurredAt: string,
): void {
  database
    .prepare(
      `
        INSERT INTO company_settings_audit_events (
          id, company_id, actor_user_id, action,
          changed_field_categories, outcome, occurred_at
        ) VALUES (?, 'company-1', 'actor-1', 'companySettings.updated',
          '["identity"]', 'success', ?)
      `,
    )
    .run(id, occurredAt);
}

function insertSecretAudit(
  database: DatabaseConnection,
  operationId: string,
  status: 'pending' | 'succeeded',
  completedAt: string | null,
): void {
  database
    .prepare(
      `
        INSERT INTO company_email_secret_audit_events (
          operation_id, company_id, actor_id, action, status,
          started_at, completed_at, failure_code
        ) VALUES (?, 'company-1', 'actor-1', 'set', ?,
          '2018-01-01T00:00:00.000Z', ?, NULL)
      `,
    )
    .run(operationId, status, completedAt);
}

function readIds(
  database: DatabaseConnection,
  table: string,
  idColumn: string,
): string[] {
  return database
    .prepare(`SELECT ${idColumn} AS id FROM ${table} ORDER BY id`)
    .all()
    .map((row) => (row as { id: string }).id);
}
