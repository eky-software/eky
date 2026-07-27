import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CompanySettingsAuditRetentionPort } from '../ports/companySettingsAuditRetentionPort.js';

export class SqliteCompanySettingsAuditRetention
  implements CompanySettingsAuditRetentionPort
{
  constructor(private readonly database: DatabaseConnection) {}

  async deleteCompanySettingsAuditEventsBefore(cutoff: string): Promise<number> {
    const remove = this.database.transaction(() => {
      const settingsChanges = this.database
        .prepare<[string]>(
          'DELETE FROM company_settings_audit_events WHERE occurred_at < ?',
        )
        .run(cutoff).changes;
      const secretChanges = this.database
        .prepare<[string]>(
          `
            DELETE FROM company_email_secret_audit_events
            WHERE
              status <> 'pending'
              AND completed_at IS NOT NULL
              AND completed_at < ?
          `,
        )
        .run(cutoff).changes;

      return settingsChanges + secretChanges;
    });

    return remove();
  }
}
