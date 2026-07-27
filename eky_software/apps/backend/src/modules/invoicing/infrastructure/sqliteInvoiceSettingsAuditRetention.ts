import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceSettingsAuditRetentionPort } from '../ports/invoiceSettingsAuditRetentionPort.js';

export class SqliteInvoiceSettingsAuditRetention
  implements InvoiceSettingsAuditRetentionPort
{
  constructor(private readonly database: DatabaseConnection) {}

  async deleteInvoiceSettingsAuditEventsBefore(cutoff: string): Promise<number> {
    const remove = this.database.transaction(() =>
      this.database
        .prepare<[string]>(
          'DELETE FROM invoice_settings_audit_events WHERE occurred_at < ?',
        )
        .run(cutoff).changes,
    );

    return remove();
  }
}
