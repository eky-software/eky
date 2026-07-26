import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  CompanySettingsRow,
  NewCompanySettingsRow,
} from '../../../database/schema.js';
import type { CompanySettings } from '../domain/companySettings.js';
import type {
  CompanySettingsAuditEvent,
  CompanySettingsChangedFieldCategory,
} from '../domain/companySettingsAuditEvent.js';
import { dnaSmtpCompatibilityProfile } from '../domain/companyEmailSettings.js';
import { CompanySettingsAuditWriteError } from '../ports/companySettingsAuditWriteError.js';
import type { CompanySettingsRepository } from '../ports/companySettingsRepository.js';

type CompanySettingsUpsertParameters = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  number | null,
  string,
  string,
  string,
  string,
  string,
  string,
  number | null,
  string,
  string,
  string,
];

const companySettingsAuditCategories =
  new Set<CompanySettingsChangedFieldCategory>([
    'address',
    'banking',
    'contact',
    'emailConfiguration',
    'identity',
    'invoicingDefaults',
  ]);

function toCompanySettingsRow(settings: CompanySettings): NewCompanySettingsRow {
  return {
    id: settings.id,
    company_id: settings.companyId,
    company_name: settings.companyName,
    business_id: settings.businessId,
    vat_number: settings.vatNumber,
    street_address: settings.streetAddress,
    postal_code: settings.postalCode,
    city: settings.city,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    email_delivery_provider:
      settings.emailDeliveryProvider === 'dnaSmtp' ? 'smtp' : 'dryRun',
    email_sender_name: settings.emailSenderName,
    email_sender_address: settings.emailSenderAddress,
    email_smtp_host: settings.emailSmtpHost,
    email_smtp_port: settings.emailSmtpPort,
    email_smtp_security: settings.emailSmtpSecurity,
    email_username: settings.emailUsername,
    email_test_recipient_override: settings.emailTestRecipientOverride,
    iban: settings.iban,
    bic: settings.bic,
    bank_name: settings.bankName,
    default_hourly_rate_cents: settings.defaultHourlyRateCents,
    hourly_rate_shortcut: settings.hourlyRateShortcut,
    created_at: settings.createdAt,
    updated_at: settings.updatedAt,
  };
}

function toCompanySettings(row: CompanySettingsRow): CompanySettings {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    businessId: row.business_id,
    vatNumber: row.vat_number,
    streetAddress: row.street_address,
    postalCode: row.postal_code,
    city: row.city,
    email: row.email,
    phone: row.phone,
    website: row.website,
    emailDeliveryProvider:
      row.email_delivery_provider === 'smtp' ? 'dnaSmtp' : 'dryRun',
    emailSenderName: row.email_sender_name,
    emailSenderAddress: row.email_sender_address,
    emailSmtpHost:
      row.email_delivery_provider === 'smtp'
        ? dnaSmtpCompatibilityProfile.host
        : '',
    emailSmtpPort:
      row.email_delivery_provider === 'smtp'
        ? dnaSmtpCompatibilityProfile.port
        : null,
    emailSmtpSecurity: dnaSmtpCompatibilityProfile.security,
    emailUsername: row.email_username,
    emailTestRecipientOverride: row.email_test_recipient_override,
    emailSecretConfigured: false,
    iban: row.iban,
    bic: row.bic,
    bankName: row.bank_name,
    defaultHourlyRateCents: row.default_hourly_rate_cents,
    hourlyRateShortcut: row.hourly_rate_shortcut,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteCompanySettingsRepository implements CompanySettingsRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async findByCompanyId(companyId: string): Promise<CompanySettings | null> {
    const row = this.database
      .prepare<[string], CompanySettingsRow>(
        `
          SELECT
            id,
            company_id,
            company_name,
            business_id,
            vat_number,
            street_address,
            postal_code,
            city,
            email,
            phone,
            website,
            email_delivery_provider,
            email_sender_name,
            email_sender_address,
            email_smtp_host,
            email_smtp_port,
            email_smtp_security,
            email_username,
            email_test_recipient_override,
            iban,
            bic,
            bank_name,
            default_hourly_rate_cents,
            hourly_rate_shortcut,
            created_at,
            updated_at
          FROM company_settings
          WHERE company_id = ?
        `,
      )
      .get(companyId);

    return row === undefined ? null : toCompanySettings(row);
  }

  async upsertCompanySettings(
    settings: CompanySettings,
    auditEvent: CompanySettingsAuditEvent,
  ): Promise<CompanySettings> {
    const row = toCompanySettingsRow(settings);

    if (auditEvent.companyId !== settings.companyId) {
      throw new CompanySettingsAuditWriteError();
    }

    this.database.transaction(() => {
      this.database
        .prepare<CompanySettingsUpsertParameters>(
          `
            INSERT INTO company_settings (
              id,
              company_id,
              company_name,
              business_id,
              vat_number,
              street_address,
              postal_code,
              city,
              email,
              phone,
              website,
              email_delivery_provider,
              email_sender_name,
              email_sender_address,
              email_smtp_host,
              email_smtp_port,
              email_smtp_security,
              email_username,
              email_test_recipient_override,
              iban,
              bic,
              bank_name,
              default_hourly_rate_cents,
              hourly_rate_shortcut,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(company_id) DO UPDATE SET
              company_name = excluded.company_name,
              business_id = excluded.business_id,
              vat_number = excluded.vat_number,
              street_address = excluded.street_address,
              postal_code = excluded.postal_code,
              city = excluded.city,
              email = excluded.email,
              phone = excluded.phone,
              website = excluded.website,
              email_delivery_provider = excluded.email_delivery_provider,
              email_sender_name = excluded.email_sender_name,
              email_sender_address = excluded.email_sender_address,
              email_smtp_host = excluded.email_smtp_host,
              email_smtp_port = excluded.email_smtp_port,
              email_smtp_security = excluded.email_smtp_security,
              email_username = excluded.email_username,
              email_test_recipient_override = excluded.email_test_recipient_override,
              iban = excluded.iban,
              bic = excluded.bic,
              bank_name = excluded.bank_name,
              default_hourly_rate_cents = excluded.default_hourly_rate_cents,
              hourly_rate_shortcut = excluded.hourly_rate_shortcut,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          row.id,
          row.company_id,
          row.company_name,
          row.business_id,
          row.vat_number,
          row.street_address,
          row.postal_code,
          row.city,
          row.email,
          row.phone,
          row.website,
          row.email_delivery_provider,
          row.email_sender_name,
          row.email_sender_address,
          row.email_smtp_host,
          row.email_smtp_port,
          row.email_smtp_security,
          row.email_username,
          row.email_test_recipient_override,
          row.iban,
          row.bic,
          row.bank_name,
          row.default_hourly_rate_cents,
          row.hourly_rate_shortcut,
          row.created_at,
          row.updated_at,
        );

      this.insertAuditEvent(auditEvent);
    })();

    const savedSettings = await this.findByCompanyId(settings.companyId);

    if (savedSettings === null) {
      throw new Error('Company settings were not saved.');
    }

    return savedSettings;
  }

  private insertAuditEvent(auditEvent: CompanySettingsAuditEvent): void {
    if (
      auditEvent.changedFieldCategories.some(
        (category) => !companySettingsAuditCategories.has(category),
      )
    ) {
      throw new CompanySettingsAuditWriteError();
    }

    try {
      this.database
        .prepare(
          `
            INSERT INTO company_settings_audit_events (
              id,
              company_id,
              actor_user_id,
              action,
              changed_field_categories,
              outcome,
              occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          auditEvent.id,
          auditEvent.companyId,
          auditEvent.actorUserId,
          auditEvent.action,
          JSON.stringify(auditEvent.changedFieldCategories),
          auditEvent.outcome,
          auditEvent.occurredAt,
        );
    } catch {
      throw new CompanySettingsAuditWriteError();
    }
  }
}
