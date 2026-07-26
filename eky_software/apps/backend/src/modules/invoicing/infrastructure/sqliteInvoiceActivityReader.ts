import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceActivityAction,
  InvoiceActivityEntry,
} from '../domain/invoiceActivityEntry.js';
import type { InvoiceActivityReader } from '../ports/invoiceActivityReader.js';

interface InvoiceActivityRow {
  action: InvoiceActivityAction;
  id: string;
  invoice_number: string;
  occurred_at: string;
}

export class SqliteInvoiceActivityReader implements InvoiceActivityReader {
  constructor(private readonly database: DatabaseConnection) {}

  async listInvoiceActivity(
    companyId: string,
    limit: number,
  ): Promise<InvoiceActivityEntry[]> {
    return this.database
      .prepare<[string, string, number], InvoiceActivityRow>(
        `
          SELECT id, action, invoice_number, created_at AS occurred_at
          FROM invoice_audit_events
          WHERE
            company_id = ?
            AND action IN (
              'invoice.approved',
              'invoice.reopened_for_edit',
              'invoice.reapproved',
              'invoice.cancelled',
              'invoice.credit_draft_created',
              'invoice.credit_approved',
              'invoice.credit_reapproved'
            )

          UNION ALL

          SELECT
            delivery.id,
            'invoice.delivered' AS action,
            invoices.invoice_number,
            delivery.created_at AS occurred_at
          FROM invoice_delivery_events AS delivery
          INNER JOIN invoices
            ON invoices.id = delivery.invoice_id
            AND invoices.company_id = delivery.company_id
          WHERE
            delivery.company_id = ?
            AND delivery.status = 'succeeded'
            AND delivery.provider <> 'dryRun'

          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(companyId, companyId, limit)
      .map((row) => ({
        action: row.action,
        id: row.id,
        invoiceNumber: row.invoice_number,
        occurredAt: row.occurred_at,
      }));
  }
}
