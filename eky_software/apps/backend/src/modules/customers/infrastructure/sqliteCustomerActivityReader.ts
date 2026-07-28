import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  CustomerActivityEntry,
} from '../domain/customerActivityEntry.js';
import type {
  CustomerAuditAction,
  CustomerChangedFieldCategory,
} from '../domain/customerAuditEvent.js';
import type {
  CustomerActivityCriteria,
  CustomerActivityReader,
} from '../ports/customerActivityReader.js';

interface CustomerActivityRow {
  action: CustomerAuditAction;
  changed_field_categories: string;
  customer_number: string | null;
  id: string;
  occurred_at: string;
}

const customerChangeCategories =
  new Set<CustomerChangedFieldCategory>([
    'billing',
    'contact',
    'identity',
    'pricing',
    'status',
  ]);

export class SqliteCustomerActivityReader implements CustomerActivityReader {
  constructor(private readonly database: DatabaseConnection) {}

  async listCustomerActivity(
    criteria: CustomerActivityCriteria,
  ): Promise<CustomerActivityEntry[]> {
    return this.database
      .prepare<[string, string, string, number], CustomerActivityRow>(
        `
          SELECT
            audit.id,
            audit.action,
            audit.changed_field_categories,
            audit.occurred_at,
            customers.customer_number
          FROM customer_audit_events AS audit
          LEFT JOIN customers
            ON customers.id = audit.customer_id
            AND customers.company_id = audit.company_id
          WHERE
            audit.company_id = ?
            AND audit.occurred_at >= ?
            AND audit.occurred_at < ?
          ORDER BY audit.occurred_at DESC, audit.id DESC
          LIMIT ?
        `,
      )
      .all(
        criteria.companyId,
        criteria.occurredAtFrom,
        criteria.occurredAtTo,
        criteria.limit,
      )
      .map((row) => ({
        action: row.action,
        changeCategories: readCustomerChangeCategories(
          row.changed_field_categories,
        ),
        customerNumber: row.customer_number,
        id: row.id,
        occurredAt: row.occurred_at,
      }));
  }
}

function readCustomerChangeCategories(
  value: string,
): readonly CustomerChangedFieldCategory[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('CUSTOMER_ACTIVITY_CHANGE_CATEGORIES_INVALID');
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length > customerChangeCategories.size ||
    !parsed.every(
      (category): category is CustomerChangedFieldCategory =>
        typeof category === 'string' &&
        customerChangeCategories.has(category as CustomerChangedFieldCategory),
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error('CUSTOMER_ACTIVITY_CHANGE_CATEGORIES_INVALID');
  }

  return Object.freeze([...parsed]);
}
