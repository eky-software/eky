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
    const reader = new SqliteCompanySettingsActivityReader(database);

    await expect(
      reader.listCompanySettingsActivity('company-1', 10),
    ).resolves.toEqual([
      {
        action: 'companySettings.updated',
        id: 'event-1',
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
