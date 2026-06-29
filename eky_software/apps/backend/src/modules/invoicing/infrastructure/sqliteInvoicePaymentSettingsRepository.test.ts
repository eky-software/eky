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
import { SqliteInvoicePaymentSettingsRepository } from './sqliteInvoicePaymentSettingsRepository.js';

const migrationSql = readFileSync(
  new URL(
    '../../../database/migrations/012_create_invoice_payment_settings.sql',
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

    await expect(repository.saveSettings(settings)).resolves.toEqual(settings);
    await expect(repository.getSettings('dev-company')).resolves.toEqual(settings);
    await expect(repository.getSettings('other-company')).resolves.toBeUndefined();
    await expect(repository.getSettings("dev-company' OR 1=1 --")).resolves.toBeUndefined();
  });

  it('updates settings while preserving their createdAt timestamp', async () => {
    const repository = new SqliteInvoicePaymentSettingsRepository(database);

    await repository.saveSettings(createSettings());
    await expect(
      repository.saveSettings(
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
      repository.saveSettings(
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
});
