import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../../database/migration/runMigrations.js';
import { SqliteCompanyEmailSecretAuditWriter } from './sqliteCompanyEmailSecretAuditWriter.js';

let database: Database.Database | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('SqliteCompanyEmailSecretAuditWriter', () => {
  it('stores only non-secret lifecycle audit fields', async () => {
    database = new Database(':memory:');
    await runMigrations(database);
    const writer = new SqliteCompanyEmailSecretAuditWriter(database);

    await writer.appendCompanyEmailSecretAuditEvent({
      actorId: 'local-user',
      companyId: 'example-company',
      eventType: 'company_email_secret_set',
      occurredAt: '2026-07-14T20:00:00.000Z',
    });

    expect(
      database
        .prepare(
          `
            SELECT company_id, actor_id, event_type, occurred_at
            FROM company_email_secret_audit_events
          `,
        )
        .get(),
    ).toEqual({
      actor_id: 'local-user',
      company_id: 'example-company',
      event_type: 'company_email_secret_set',
      occurred_at: '2026-07-14T20:00:00.000Z',
    });

    const columns = database
      .prepare('PRAGMA table_info(company_email_secret_audit_events)')
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).not.toContain('secret');
    expect(columns.map((column) => column.name)).not.toContain('secret_hash');
    expect(columns.map((column) => column.name)).not.toContain('secret_length');
  });
});
