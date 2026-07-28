import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CompanySettingsActivityEntry } from '../domain/companySettingsActivityEntry.js';
import type { CompanySettingsChangedFieldCategory } from '../domain/companySettingsAuditEvent.js';
import type {
  CompanySettingsActivityCriteria,
  CompanySettingsActivityReader,
} from '../ports/companySettingsActivityReader.js';

interface CompanySettingsActivityRow {
  action: CompanySettingsActivityEntry['action'];
  changed_field_categories: string | null;
  id: string;
  occurred_at: string;
}

const companySettingsChangeCategories =
  new Set<CompanySettingsChangedFieldCategory>([
    'address',
    'banking',
    'contact',
    'emailConfiguration',
    'identity',
    'invoicingDefaults',
  ]);

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
          SELECT id, action, changed_field_categories, occurred_at
          FROM (
            SELECT
              'settings:' || id AS id,
              action,
              changed_field_categories,
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
              NULL AS changed_field_categories,
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
        changeCategories: readCompanySettingsChangeCategories(
          row.changed_field_categories,
        ),
        id: row.id,
        occurredAt: row.occurred_at,
      }));
  }
}

function readCompanySettingsChangeCategories(
  value: string | null,
): readonly CompanySettingsChangedFieldCategory[] {
  if (value === null) {
    return Object.freeze([]);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('COMPANY_SETTINGS_ACTIVITY_CHANGE_CATEGORIES_INVALID');
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length > companySettingsChangeCategories.size ||
    !parsed.every(
      (category): category is CompanySettingsChangedFieldCategory =>
        typeof category === 'string' &&
        companySettingsChangeCategories.has(
          category as CompanySettingsChangedFieldCategory,
        ),
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error('COMPANY_SETTINGS_ACTIVITY_CHANGE_CATEGORIES_INVALID');
  }

  return Object.freeze([...parsed]);
}
