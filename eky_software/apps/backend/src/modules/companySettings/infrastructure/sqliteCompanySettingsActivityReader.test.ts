import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { SqliteCompanySettingsActivityReader } from './sqliteCompanySettingsActivityReader.js';

describe('SqliteCompanySettingsActivityReader', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
  });

  afterEach(() => database.close());

  it('returns only same-company settings activity without field values', async () => {
    insertAudit(database, 'event-1', 'company-1');
    insertAudit(database, 'event-2', 'company-2');
    insertEmailSecretAudit(database, 'secret-1', 'company-1', 'set');
    const reader = new SqliteCompanySettingsActivityReader(database);

    await expect(
      reader.listCompanySettingsActivity({
        companyId: 'company-1',
        limit: 10,
        occurredAtFrom: '2026-07-01T00:00:00.000Z',
        occurredAtTo: '2026-08-01T00:00:00.000Z',
      }),
    ).resolves.toEqual([
      {
        action: 'companyEmailSecret.configured',
        id: 'emailSecret:secret-1',
        occurredAt: '2026-07-27T11:00:00.000Z',
      },
      {
        action: 'companySettings.updated',
        id: 'settings:event-1',
        occurredAt: '2026-07-27T10:00:00.000Z',
      },
    ]);
  });
});

function insertAudit(
  database: DatabaseConnection,
  id: string,
  companyId: string,
): void {
  database
    .prepare(
      `
        INSERT INTO company_settings_audit_events (
          id, company_id, actor_user_id, action, changed_field_categories,
          outcome, occurred_at
        ) VALUES (?, ?, 'actor-1', 'companySettings.updated', '["contact"]',
          'success', '2026-07-27T10:00:00.000Z')
      `,
    )
    .run(id, companyId);
}

function insertEmailSecretAudit(
  database: DatabaseConnection,
  operationId: string,
  companyId: string,
  action: 'remove' | 'set',
): void {
  database
    .prepare(
      `
        INSERT INTO company_email_secret_audit_events (
          operation_id, company_id, actor_id, action, status, started_at,
          completed_at, failure_code
        ) VALUES (
          ?, ?, 'actor-1', ?, 'succeeded', '2026-07-27T10:59:00.000Z',
          '2026-07-27T11:00:00.000Z', NULL
        )
      `,
    )
    .run(operationId, companyId, action);
}
