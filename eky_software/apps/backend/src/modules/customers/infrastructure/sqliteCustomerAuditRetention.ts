import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { CustomerAuditRetentionPort } from '../ports/customerAuditRetentionPort.js';

export class SqliteCustomerAuditRetention
  implements CustomerAuditRetentionPort
{
  constructor(private readonly database: DatabaseConnection) {}

  async deleteCustomerAuditEventsBefore(cutoff: string): Promise<number> {
    const remove = this.database.transaction(() =>
      this.database
        .prepare<[string]>(
          'DELETE FROM customer_audit_events WHERE occurred_at < ?',
        )
        .run(cutoff).changes,
    );

    return remove();
  }
}
