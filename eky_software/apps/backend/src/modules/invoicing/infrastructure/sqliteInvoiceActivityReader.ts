import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceActivityAction,
  InvoiceActivityEntry,
  InvoiceActivityOutcome,
} from '../domain/invoiceActivityEntry.js';
import type {
  InvoiceActivityCriteria,
  InvoiceActivityReader,
} from '../ports/invoiceActivityReader.js';

interface InvoiceActivityRow {
  action: InvoiceActivityAction;
  id: string;
  invoice_number: string | null;
  occurred_at: string;
  outcome: InvoiceActivityOutcome;
}

export class SqliteInvoiceActivityReader implements InvoiceActivityReader {
  constructor(private readonly database: DatabaseConnection) {}

  async listInvoiceActivity(
    criteria: InvoiceActivityCriteria,
  ): Promise<InvoiceActivityEntry[]> {
    return this.database
      .prepare<
        [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          number,
          number,
          number,
          number,
        ],
        InvoiceActivityRow
      >(
        `
          SELECT id, action, invoice_number, occurred_at, outcome
          FROM (
            SELECT
              id,
              action,
              invoice_number,
              created_at AS occurred_at,
              'success' AS outcome
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
              CASE delivery.status
                WHEN 'succeeded' THEN 'invoice.delivered'
                WHEN 'failed' THEN 'invoice.delivery_failed'
                WHEN 'outcomeUnknown' THEN 'invoice.delivery_outcome_unknown'
                ELSE 'invoice.delivery_pending'
              END AS action,
              invoices.invoice_number,
              delivery.created_at AS occurred_at,
              CASE delivery.status
                WHEN 'succeeded' THEN 'success'
                WHEN 'failed' THEN 'failure'
                ELSE 'unknown'
              END AS outcome
            FROM invoice_delivery_events AS delivery
            INNER JOIN invoices
              ON invoices.id = delivery.invoice_id
              AND invoices.company_id = delivery.company_id
            WHERE
              delivery.company_id = ?
              AND delivery.status IN (
                'attempted',
                'succeeded',
                'failed',
                'outcomeUnknown'
              )
              AND delivery.provider <> 'dryRun'

            UNION ALL

            SELECT
              id,
              action,
              NULL AS invoice_number,
              occurred_at,
              'success' AS outcome
            FROM invoice_settings_audit_events
            WHERE company_id = ?

            UNION ALL

            SELECT
              id,
              'invoiceNumberingSeries.activated' AS action,
              NULL AS invoice_number,
              occurred_at,
              'success' AS outcome
            FROM invoice_numbering_series_events
            WHERE company_id = ?

            UNION ALL

            SELECT
              payment.id,
              CASE payment.action
                WHEN 'paymentMarkedPaid' THEN 'invoice.payment_marked_paid'
                ELSE 'invoice.payment_mark_reverted'
              END AS action,
              invoices.invoice_number,
              payment.occurred_at,
              'success' AS outcome
            FROM invoice_payment_events AS payment
            INNER JOIN invoices
              ON invoices.id = payment.invoice_id
              AND invoices.company_id = payment.company_id
            WHERE payment.company_id = ?
          )
          WHERE
            occurred_at >= ?
            AND occurred_at < ?
            AND (
              (? = 1 AND outcome = 'success')
              OR (? = 1 AND outcome = 'failure')
              OR (? = 1 AND outcome = 'unknown')
            )
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(
        criteria.companyId,
        criteria.companyId,
        criteria.companyId,
        criteria.companyId,
        criteria.companyId,
        criteria.occurredAtFrom,
        criteria.occurredAtTo,
        toSqlBoolean(criteria.outcomes.includes('success')),
        toSqlBoolean(criteria.outcomes.includes('failure')),
        toSqlBoolean(criteria.outcomes.includes('unknown')),
        criteria.limit,
      )
      .map((row) => ({
        action: row.action,
        id: row.id,
        invoiceNumber: row.invoice_number,
        occurredAt: row.occurred_at,
        outcome: row.outcome,
      }));
  }
}

function toSqlBoolean(value: boolean): number {
  return value ? 1 : 0;
}
