import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoicePaymentSettingsRow,
  NewInvoicePaymentSettingsRow,
} from '../../../database/schema.js';
import {
  validateInvoicePaymentSettings,
  type StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';
import { InvoicePaymentSettingsError } from '../domain/invoicePaymentSettingsError.js';
import type {
  InvoicePaymentSettingsRepository,
} from '../ports/invoicePaymentSettingsRepository.js';

type InvoicePaymentSettingsSaveParameters = [
  string,
  number,
  number,
  string,
  string,
];

function requireCompanyId(companyId: string): void {
  if (companyId.trim().length === 0) {
    throw new InvoicePaymentSettingsError('Company id must not be empty.');
  }
}

function validateStoredInvoicePaymentSettings(
  settings: StoredInvoicePaymentSettings,
): void {
  requireCompanyId(settings.companyId);
  validateInvoicePaymentSettings(settings);
}

function toInvoicePaymentSettingsRow(
  settings: StoredInvoicePaymentSettings,
): NewInvoicePaymentSettingsRow {
  return {
    company_id: settings.companyId,
    default_late_payment_interest_basis_points:
      settings.defaultLatePaymentInterestBasisPoints,
    default_reminder_period_days: settings.defaultReminderPeriodDays,
    created_at: settings.createdAt,
    updated_at: settings.updatedAt,
  };
}

function toStoredInvoicePaymentSettings(
  row: InvoicePaymentSettingsRow,
): StoredInvoicePaymentSettings {
  return {
    companyId: row.company_id,
    defaultLatePaymentInterestBasisPoints:
      row.default_late_payment_interest_basis_points,
    defaultReminderPeriodDays: row.default_reminder_period_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteInvoicePaymentSettingsRepository
  implements InvoicePaymentSettingsRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async getSettings(
    companyId: string,
  ): Promise<StoredInvoicePaymentSettings | undefined> {
    const row = this.database
      .prepare<[string], InvoicePaymentSettingsRow>(
        `
          SELECT
            company_id,
            default_late_payment_interest_basis_points,
            default_reminder_period_days,
            created_at,
            updated_at
          FROM invoice_payment_settings
          WHERE company_id = ?
        `,
      )
      .get(companyId);

    return row === undefined ? undefined : toStoredInvoicePaymentSettings(row);
  }

  async saveSettings(
    settings: StoredInvoicePaymentSettings,
  ): Promise<StoredInvoicePaymentSettings> {
    validateStoredInvoicePaymentSettings(settings);

    const row = toInvoicePaymentSettingsRow(settings);

    this.database
      .prepare<InvoicePaymentSettingsSaveParameters>(
        `
          INSERT INTO invoice_payment_settings (
            company_id,
            default_late_payment_interest_basis_points,
            default_reminder_period_days,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(company_id) DO UPDATE SET
            default_late_payment_interest_basis_points =
              excluded.default_late_payment_interest_basis_points,
            default_reminder_period_days =
              excluded.default_reminder_period_days,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        row.company_id,
        row.default_late_payment_interest_basis_points,
        row.default_reminder_period_days,
        row.created_at,
        row.updated_at,
      );

    const savedSettings = await this.getSettings(settings.companyId);

    if (savedSettings === undefined) {
      throw new InvoicePaymentSettingsError('Saved invoice payment settings were not found.');
    }

    return savedSettings;
  }
}
