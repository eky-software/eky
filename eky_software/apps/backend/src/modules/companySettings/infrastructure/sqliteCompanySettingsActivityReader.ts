import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CompanySettingsActivityEntry } from '../domain/companySettingsActivityEntry.js';
import type { CompanySettingsActivityReader } from '../ports/companySettingsActivityReader.js';

interface CompanySettingsActivityRow {
  action: 'companySettings.updated';
  id: string;
  occurred_at: string;
}

export class SqliteCompanySettingsActivityReader
  implements CompanySettingsActivityReader
{
  constructor(private readonly database: DatabaseConnection) {}

  async listCompanySettingsActivity(
    companyId: string,
    limit: number,
  ): Promise<CompanySettingsActivityEntry[]> {
    return this.database
      .prepare<[string, number], CompanySettingsActivityRow>(
        `
          SELECT id, action, occurred_at
          FROM company_settings_audit_events
          WHERE company_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(companyId, limit)
      .map((row) => ({
        action: row.action,
        id: row.id,
        occurredAt: row.occurred_at,
      }));
  }
}
