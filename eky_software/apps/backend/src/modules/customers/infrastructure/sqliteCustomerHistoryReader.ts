import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CustomerHistoryEntry } from '../domain/customerHistory.js';
import type {
  CustomerAuditAction,
} from '../domain/customerAuditEvent.js';
import type {
  CustomerHistoryCriteria,
  CustomerHistoryReader,
} from '../ports/customerHistoryReader.js';
import { readCustomerChangeCategories } from './customerActivityMapping.js';

interface CustomerHistoryRow {
  action: CustomerAuditAction;
  changed_field_categories: string;
  id: string;
  occurred_at: string;
}

export class SqliteCustomerHistoryReader implements CustomerHistoryReader {
  constructor(private readonly database: DatabaseConnection) {}

  async listCustomerHistory(
    criteria: CustomerHistoryCriteria,
  ): Promise<CustomerHistoryEntry[]> {
    return this.database
      .prepare<
        [string, string, number, number],
        CustomerHistoryRow
      >(
        `
          SELECT
            id,
            action,
            changed_field_categories,
            occurred_at
          FROM customer_audit_events
          WHERE company_id = ? AND customer_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT ? OFFSET ?
        `,
      )
      .all(
        criteria.companyId,
        criteria.customerId,
        criteria.limit,
        criteria.offset,
      )
      .map((row) => ({
        action: row.action,
        changeCategories: readCustomerChangeCategories(
          row.changed_field_categories,
        ),
        id: row.id,
        occurredAt: row.occurred_at,
      }));
  }
}
