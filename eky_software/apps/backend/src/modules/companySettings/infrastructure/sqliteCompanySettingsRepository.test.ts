import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import type { CompanySettings } from '../domain/companySettings.js';
import {
  createCompanySettingsAuditEvent,
  type CompanySettingsAuditEvent,
} from '../domain/companySettingsAuditEvent.js';
import { CompanySettingsAuditWriteError } from '../ports/companySettingsAuditWriteError.js';
import { SqliteCompanySettingsRepository } from './sqliteCompanySettingsRepository.js';

describe('SqliteCompanySettingsRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
  });

  afterEach(() => {
    database.close();
  });

  it('persists and reads bank details with company settings', async () => {
    const repository = new SqliteCompanySettingsRepository(database);
    const settings = createSettings();

    await repository.upsertCompanySettings(
      settings,
      createAuditEvent(null, settings),
    );

    await expect(repository.findByCompanyId('dev-company')).resolves.toEqual(
      settings,
    );
    expect(readAuditRows(database)).toEqual([
      expect.objectContaining({
        action: 'companySettings.updated',
        actor_user_id: 'local-owner',
        company_id: 'dev-company',
        outcome: 'success',
      }),
    ]);
    expect(JSON.stringify(readAuditRows(database))).not.toContain(
      'info@example.fi',
    );
    expect(JSON.stringify(readAuditRows(database))).not.toContain(
      'FI2112345600000785',
    );
  });

  it('updates bank details without replacing the original created timestamp', async () => {
    const repository = new SqliteCompanySettingsRepository(database);
    const originalSettings = createSettings();

    await repository.upsertCompanySettings(
      originalSettings,
      createAuditEvent(null, originalSettings),
    );
    const updatedSettings = {
      ...originalSettings,
      createdAt: '2026-06-26T00:00:00.000Z',
      hourlyRateShortcut: 'laskutus',
      iban: 'FI5542345670000081',
      bic: 'OKOYFIHH',
      bankName: 'Updated Bank',
      vatNumber: 'FI87654321',
      emailDeliveryProvider: 'dnaSmtp',
      emailSenderName: 'Updated Sender',
      emailSenderAddress: 'sender@example.fi',
      emailSmtpHost: 'smtp.dnamail.fi',
      emailSmtpPort: 465,
      emailSmtpSecurity: 'tls',
      emailUsername: 'sender@example.fi',
      emailTestRecipientOverride: 'test@example.fi',
      updatedAt: '2026-06-26T00:00:00.000Z',
    };
    await repository.upsertCompanySettings(
      updatedSettings,
      createAuditEvent(originalSettings, updatedSettings),
    );

    await expect(repository.findByCompanyId('dev-company')).resolves.toMatchObject({
      createdAt: originalSettings.createdAt,
      hourlyRateShortcut: 'laskutus',
      iban: 'FI5542345670000081',
      bic: 'OKOYFIHH',
      bankName: 'Updated Bank',
      vatNumber: 'FI87654321',
      emailDeliveryProvider: 'dnaSmtp',
      emailSenderName: 'Updated Sender',
      emailSenderAddress: 'sender@example.fi',
      emailSmtpHost: 'smtp.dnamail.fi',
      emailSmtpPort: 465,
      emailSmtpSecurity: 'tls',
      emailUsername: 'sender@example.fi',
      emailTestRecipientOverride: 'test@example.fi',
      emailSecretConfigured: false,
      updatedAt: '2026-06-26T00:00:00.000Z',
    });
  });

  it('rolls back company settings when the mandatory audit write fails', async () => {
    const repository = new SqliteCompanySettingsRepository(database);
    const settings = createSettings();
    database.exec('DROP TABLE company_settings_audit_events;');

    await expect(
      repository.upsertCompanySettings(
        settings,
        createAuditEvent(null, settings),
      ),
    ).rejects.toBeInstanceOf(CompanySettingsAuditWriteError);

    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM company_settings')
        .get(),
    ).toEqual({ count: 0 });
  });
});

function createAuditEvent(
  current: CompanySettings | null,
  updated: CompanySettings,
): CompanySettingsAuditEvent {
  return createCompanySettingsAuditEvent({
    actorUserId: 'local-owner',
    current,
    updated,
  });
}

function readAuditRows(database: DatabaseConnection): unknown[] {
  return database
    .prepare(
      `
        SELECT
          company_id,
          actor_user_id,
          action,
          changed_field_categories,
          outcome,
          occurred_at
        FROM company_settings_audit_events
        ORDER BY occurred_at, id
      `,
    )
    .all();
}

function createSettings(): CompanySettings {
  return {
    businessId: '1234567-8',
    vatNumber: 'FI12345678',
    city: 'Helsinki',
    companyId: 'dev-company',
    companyName: 'Example Builder Oy',
    createdAt: '2026-06-25T00:00:00.000Z',
    defaultHourlyRateCents: 6500,
    email: 'info@example.fi',
    emailDeliveryProvider: 'dryRun',
    emailSenderName: '',
    emailSenderAddress: '',
    emailSmtpHost: '',
    emailSmtpPort: null,
    emailSmtpSecurity: 'tls',
    emailUsername: '',
    emailTestRecipientOverride: '',
    emailSecretConfigured: false,
    hourlyRateShortcut: 'työ',
    website: 'www.example.fi',
    iban: 'FI2112345600000785',
    bic: 'NDEAFIHH',
    bankName: 'Test Bank',
    id: 'settings-1',
    phone: '040 123 4567',
    postalCode: '00100',
    streetAddress: 'Testikatu 1',
    updatedAt: '2026-06-25T00:00:00.000Z',
  };
}
