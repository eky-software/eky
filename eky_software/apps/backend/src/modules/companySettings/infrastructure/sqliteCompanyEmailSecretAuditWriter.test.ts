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
  it('updates one non-secret audit operation from pending to succeeded', async () => {
    database = new Database(':memory:');
    await runMigrations(database);
    const writer = new SqliteCompanyEmailSecretAuditWriter(database);
    const operationId = '47a8881e-e9b8-4f40-b5c7-8fe2c9f2ed5e';

    await writer.startCompanyEmailSecretAuditOperation({
      action: 'set',
      actorId: 'local-user',
      companyId: 'example-company',
      completedAt: null,
      failureCode: null,
      operationId,
      startedAt: '2026-07-14T20:00:00.000Z',
      status: 'pending',
    });
    await writer.completeCompanyEmailSecretAuditOperation({
      completedAt: '2026-07-14T20:00:01.000Z',
      failureCode: null,
      operationId,
      status: 'succeeded',
    });

    expect(
      database
        .prepare('SELECT * FROM company_email_secret_audit_events')
        .get(),
    ).toEqual({
      action: 'set',
      actor_id: 'local-user',
      company_id: 'example-company',
      completed_at: '2026-07-14T20:00:01.000Z',
      failure_code: null,
      operation_id: operationId,
      started_at: '2026-07-14T20:00:00.000Z',
      status: 'succeeded',
    });

    const columns = database
      .prepare('PRAGMA table_info(company_email_secret_audit_events)')
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).not.toContain('secret');
    expect(columns.map((column) => column.name)).not.toContain('secret_hash');
    expect(columns.map((column) => column.name)).not.toContain('secret_length');
  });

  it('does not complete an unknown or already completed operation', async () => {
    database = new Database(':memory:');
    await runMigrations(database);
    const writer = new SqliteCompanyEmailSecretAuditWriter(database);

    await expect(
      writer.completeCompanyEmailSecretAuditOperation({
        completedAt: '2026-07-14T20:00:01.000Z',
        failureCode: null,
        operationId: '47a8881e-e9b8-4f40-b5c7-8fe2c9f2ed5e',
        status: 'succeeded',
      }),
    ).rejects.toThrow('cannot be completed');
  });
});
