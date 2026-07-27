import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoicePaymentSettingsRow,
} from '../../../database/schema.js';
import type {
  StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';
import { InvoicePaymentSettingsError } from '../domain/invoicePaymentSettingsError.js';
import type { InvoiceSettingsAuditEvent } from '../domain/invoiceSettingsAuditEvent.js';
import { SqliteInvoicePaymentSettingsRepository } from './sqliteInvoicePaymentSettingsRepository.js';

const migrationSql = readFileSync(
  new URL(
    '../../../database/migrations/012_create_invoice_payment_settings.sql',
    import.meta.url,
  ),
  'utf8',
);
const auditMigrationSql = readFileSync(
  new URL(
    '../../../database/migrations/036_create_invoice_settings_audit_events.sql',
    import.meta.url,
  ),
  'utf8',
);

function createSettings(
  overrides: Partial<StoredInvoicePaymentSettings> = {},
): StoredInvoicePaymentSettings {
  return {
    companyId: 'dev-company',
    defaultLatePaymentInterestBasisPoints: 950,
    defaultReminderPeriodDays: 8,
    createdAt: '2026-06-30T10:00:00.000Z',
    updatedAt: '2026-06-30T10:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteInvoicePaymentSettingsRepository', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(migrationSql);
    database.exec(auditMigrationSql);
  });

  afterEach(() => {
    database.close();
  });

  it('creates payment settings table with a company-scoped primary key', () => {
    const table = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get('invoice_payment_settings');

    expect(table?.name).toBe('invoice_payment_settings');

    const insertSettings = database.prepare<
      [string],
      InvoicePaymentSettingsRow
    >(
      `
        INSERT INTO invoice_payment_settings (
          company_id,
          default_late_payment_interest_basis_points,
          default_reminder_period_days,
          created_at,
          updated_at
        )
        VALUES (?, 950, 8, 'created', 'updated')
      `,
    );

    insertSettings.run('dev-company');
    expect(() => insertSettings.run('dev-company')).toThrow();
    expect(() => insertSettings.run('other-company')).not.toThrow();
  });

  it('saves and reads company-scoped payment settings', async () => {
    const repository = new SqliteInvoicePaymentSettingsRepository(database);
    const settings = createSettings();

    await expect(saveSettings(repository, settings)).resolves.toEqual(settings);
    await expect(repository.getSettings('dev-company')).resolves.toEqual(settings);
    await expect(repository.getSettings('other-company')).resolves.toBeUndefined();
    await expect(repository.getSettings("dev-company' OR 1=1 --")).resolves.toBeUndefined();
    expect(readLatestAuditEvent(database)).toMatchObject({
      action: 'invoicePaymentSettings.updated',
      actor_user_id: 'local-owner',
      company_id: 'dev-company',
      outcome: 'success',
    });
  });

  it('updates settings while preserving their createdAt timestamp', async () => {
    const repository = new SqliteInvoicePaymentSettingsRepository(database);

    await saveSettings(repository, createSettings());
    await expect(
      saveSettings(
        repository,
        createSettings({
          defaultLatePaymentInterestBasisPoints: 1050,
          defaultReminderPeriodDays: 14,
          createdAt: '2026-06-30T11:00:00.000Z',
          updatedAt: '2026-06-30T11:00:00.000Z',
        }),
      ),
    ).resolves.toEqual(
      createSettings({
        defaultLatePaymentInterestBasisPoints: 1050,
        defaultReminderPeriodDays: 14,
        createdAt: '2026-06-30T10:00:00.000Z',
        updatedAt: '2026-06-30T11:00:00.000Z',
      }),
    );
  });

  it('rejects invalid settings before writing them', async () => {
    const repository = new SqliteInvoicePaymentSettingsRepository(database);

    await expect(
      saveSettings(
        repository,
        createSettings({ defaultLatePaymentInterestBasisPoints: -1 }),
      ),
    ).rejects.toThrow(InvoicePaymentSettingsError);

    const count = database
      .prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM invoice_payment_settings',
      )
      .get();

    expect(count?.count).toBe(0);
  });

  it('rolls back payment settings when the audit event cannot be written', async () => {
    const repository = new SqliteInvoicePaymentSettingsRepository(database);

    await saveSettings(repository, createSettings());
    database.exec('DROP TABLE invoice_settings_audit_events');

    await expect(
      saveSettings(
        repository,
        createSettings({ defaultReminderPeriodDays: 14 }),
      ),
    ).rejects.toMatchObject({
      code: 'invoice_settings_audit_write_failed',
    });
    await expect(repository.getSettings('dev-company')).resolves.toMatchObject({
      defaultReminderPeriodDays: 8,
    });
  });
});

function saveSettings(
  repository: SqliteInvoicePaymentSettingsRepository,
  settings: StoredInvoicePaymentSettings,
) {
  return repository.saveSettings(
    settings,
    createAuditEvent('invoicePaymentSettings.updated', settings.companyId),
  );
}

function createAuditEvent(
  action: InvoiceSettingsAuditEvent['action'],
  companyId: string,
): InvoiceSettingsAuditEvent {
  return {
    action,
    actorUserId: 'local-owner',
    companyId,
    id: `${action}-${companyId}-${Math.random()}`,
    occurredAt: '2026-07-22T18:00:00.000Z',
    outcome: 'success',
  };
}

function readLatestAuditEvent(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT action, actor_user_id, company_id, outcome
        FROM invoice_settings_audit_events
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get();
}
