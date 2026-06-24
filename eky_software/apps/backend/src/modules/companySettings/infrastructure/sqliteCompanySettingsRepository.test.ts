import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CompanySettings } from '../domain/companySettings.js';
import { SqliteCompanySettingsRepository } from './sqliteCompanySettingsRepository.js';

const createTableMigrationSql = readFileSync(
  new URL(
    '../../../database/migrations/004_create_company_settings.sql',
    import.meta.url,
  ),
  'utf8',
);
const addShortcutMigrationSql = readFileSync(
  new URL(
    '../../../database/migrations/007_add_company_settings_hourly_rate_shortcut.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('SqliteCompanySettingsRepository', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = new Database(':memory:');
    database.exec(createTableMigrationSql);
    database.exec(addShortcutMigrationSql);
  });

  afterEach(() => {
    database.close();
  });

  it('persists and reads the hourly rate shortcut with company settings', async () => {
    const repository = new SqliteCompanySettingsRepository(database);
    const settings = createSettings();

    await repository.upsertCompanySettings(settings);

    await expect(repository.findByCompanyId('dev-company')).resolves.toEqual(
      settings,
    );
  });

  it('updates the shortcut without replacing the original created timestamp', async () => {
    const repository = new SqliteCompanySettingsRepository(database);
    const originalSettings = createSettings();

    await repository.upsertCompanySettings(originalSettings);
    await repository.upsertCompanySettings({
      ...originalSettings,
      createdAt: '2026-06-26T00:00:00.000Z',
      hourlyRateShortcut: 'laskutus',
      updatedAt: '2026-06-26T00:00:00.000Z',
    });

    await expect(repository.findByCompanyId('dev-company')).resolves.toMatchObject({
      createdAt: originalSettings.createdAt,
      hourlyRateShortcut: 'laskutus',
      updatedAt: '2026-06-26T00:00:00.000Z',
    });
  });
});

function createSettings(): CompanySettings {
  return {
    businessId: '1234567-8',
    city: 'Helsinki',
    companyId: 'dev-company',
    companyName: 'Example Builder Oy',
    createdAt: '2026-06-25T00:00:00.000Z',
    defaultHourlyRateCents: 6500,
    email: 'info@example.fi',
    hourlyRateShortcut: 'työ',
    id: 'settings-1',
    phone: '040 123 4567',
    postalCode: '00100',
    streetAddress: 'Testikatu 1',
    updatedAt: '2026-06-25T00:00:00.000Z',
  };
}
