import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CompanySettingsActivityEntry } from '../domain/companySettingsActivityEntry.js';
import type {
  CompanySettingsActivityCriteria,
  CompanySettingsActivityReader,
} from '../ports/companySettingsActivityReader.js';

interface CompanySettingsActivityRow {
  action: CompanySettingsActivityEntry['action'];
  id: string;
  occurred_at: string;
}

export class SqliteCompanySettingsActivityReader
  implements CompanySettingsActivityReader
{
  constructor(private readonly database: DatabaseConnection) {}

  async listCompanySettingsActivity(
    criteria: CompanySettingsActivityCriteria,
  ): Promise<CompanySettingsActivityEntry[]> {
    return this.database
      .prepare<
        [string, string, string, string, string, string, number],
        CompanySettingsActivityRow
      >(
        `
          SELECT id, action, occurred_at
          FROM (
            SELECT
              'settings:' || id AS id,
              action,
              occurred_at
            FROM company_settings_audit_events
            WHERE
              company_id = ?
              AND occurred_at >= ?
              AND occurred_at < ?

            UNION ALL

            SELECT
              'emailSecret:' || operation_id AS id,
              CASE action
                WHEN 'set' THEN 'companyEmailSecret.configured'
                ELSE 'companyEmailSecret.removed'
              END AS action,
              completed_at AS occurred_at
            FROM company_email_secret_audit_events
            WHERE
              company_id = ?
              AND status = 'succeeded'
              AND completed_at >= ?
              AND completed_at < ?
          )
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(
        criteria.companyId,
        criteria.occurredAtFrom,
        criteria.occurredAtTo,
        criteria.companyId,
        criteria.occurredAtFrom,
        criteria.occurredAtTo,
        criteria.limit,
      )
      .map((row) => ({
        action: row.action,
        id: row.id,
        occurredAt: row.occurred_at,
      }));
  }
}
