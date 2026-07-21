import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';
import {
  type InvoiceDeliveryEventSummaryRow,
  toInvoiceDeliveryEventSummary,
} from './invoiceDeliveryEventPersistenceRows.js';

export interface SuccessfulEmailDeliveryInvoiceRow {
  status: 'approved' | 'sent';
  updated_at: string;
}

export interface ManualDeliveryInvoiceRow {
  invoice_number: string;
  source_draft_id: string;
  status: 'approved' | 'sent';
  updated_at: string;
}

export class SqliteInvoiceDeliveryEventQueries {
  constructor(private readonly database: DatabaseConnection) {}

  getSuccessfulEmailDeliveryInvoice(
    companyId: string,
    invoiceId: string,
  ): SuccessfulEmailDeliveryInvoiceRow | undefined {
    return this.database
      .prepare<
        { company_id: string; id: string },
        SuccessfulEmailDeliveryInvoiceRow
      >(
        `
          SELECT status, updated_at
          FROM invoices
          WHERE
            company_id = @company_id
            AND id = @id
            AND status IN ('approved', 'sent')
        `,
      )
      .get({ company_id: companyId, id: invoiceId });
  }

  getManualDeliveryInvoice(
    companyId: string,
    invoiceId: string,
  ): ManualDeliveryInvoiceRow | undefined {
    return this.database
      .prepare<
        { company_id: string; id: string },
        ManualDeliveryInvoiceRow
      >(
        `
          SELECT status, source_draft_id, invoice_number, updated_at
          FROM invoices
          WHERE
            company_id = @company_id
            AND id = @id
            AND status IN ('approved', 'sent')
        `,
      )
      .get({ company_id: companyId, id: invoiceId });
  }

  hasUnresolvedDeliveryEvent(companyId: string, invoiceId: string): boolean {
    const row = this.database
      .prepare<
        { company_id: string; invoice_id: string },
        { present: number }
      >(
        `
          SELECT 1 AS present
          FROM invoice_delivery_events
          WHERE
            company_id = @company_id
            AND invoice_id = @invoice_id
            AND status IN ('attempted', 'outcomeUnknown')
          LIMIT 1
        `,
      )
      .get({ company_id: companyId, invoice_id: invoiceId });

    return row !== undefined;
  }

  listDeliveryEvents(
    companyId: string,
    invoiceId: string,
  ): InvoiceDeliveryEventSummary[] {
    const rows = this.database
      .prepare<
        { company_id: string; invoice_id: string },
        InvoiceDeliveryEventSummaryRow
      >(
        `
          SELECT
            id,
            created_at,
            delivery_method,
            provider,
            recipient_email,
            cc_email,
            safe_error_message,
            status
          FROM invoice_delivery_events
          WHERE company_id = @company_id AND invoice_id = @invoice_id
          ORDER BY created_at DESC, id DESC
        `,
      )
      .all({ company_id: companyId, invoice_id: invoiceId });

    return rows.map(toInvoiceDeliveryEventSummary);
  }
}
