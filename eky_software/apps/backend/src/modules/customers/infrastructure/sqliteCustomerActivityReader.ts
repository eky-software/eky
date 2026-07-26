import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  CustomerActivityEntry,
} from '../domain/customerActivityEntry.js';
import type { CustomerAuditAction } from '../domain/customerAuditEvent.js';
import type { CustomerActivityReader } from '../ports/customerActivityReader.js';

interface CustomerActivityRow {
  action: CustomerAuditAction;
  customer_number: string | null;
  id: string;
  occurred_at: string;
}

export class SqliteCustomerActivityReader implements CustomerActivityReader {
  constructor(private readonly database: DatabaseConnection) {}

  async listCustomerActivity(
    companyId: string,
    limit: number,
  ): Promise<CustomerActivityEntry[]> {
    return this.database
      .prepare<[string, number], CustomerActivityRow>(
        `
          SELECT
            audit.id,
            audit.action,
            audit.occurred_at,
            customers.customer_number
          FROM customer_audit_events AS audit
          LEFT JOIN customers
            ON customers.id = audit.customer_id
            AND customers.company_id = audit.company_id
          WHERE audit.company_id = ?
          ORDER BY audit.occurred_at DESC, audit.id DESC
          LIMIT ?
        `,
      )
      .all(companyId, limit)
      .map((row) => ({
        action: row.action,
        customerNumber: row.customer_number,
        id: row.id,
        occurredAt: row.occurred_at,
      }));
  }
}
