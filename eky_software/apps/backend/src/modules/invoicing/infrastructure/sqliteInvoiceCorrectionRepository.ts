import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceKind } from '../domain/invoiceKind.js';
import type {
  CancelApprovedInvoicePersistenceInput,
  CancelApprovedInvoicePersistenceResult,
  InvoiceCorrectionRepository,
} from '../ports/invoiceCorrectionRepository.js';

interface CancellableInvoiceRow {
  invoice_kind: InvoiceKind;
  invoice_number: string;
  source_draft_id: string;
  status: string;
}

export class SqliteInvoiceCorrectionRepository
  implements InvoiceCorrectionRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async cancelApprovedInvoice(
    input: CancelApprovedInvoicePersistenceInput,
  ): Promise<CancelApprovedInvoicePersistenceResult> {
    const cancelTransaction = this.database.transaction(() =>
      this.cancelApprovedInvoiceWithinTransaction(input),
    );

    return cancelTransaction();
  }

  private cancelApprovedInvoiceWithinTransaction(
    input: CancelApprovedInvoicePersistenceInput,
  ): CancelApprovedInvoicePersistenceResult {
    const invoice = this.getInvoice(input.companyId, input.invoiceId);

    if (invoice === undefined) {
      return { outcome: 'notFound' };
    }

    if (invoice.status !== 'approved') {
      return { outcome: 'notCancellable' };
    }

    if (invoice.invoice_number !== input.confirmationInvoiceNumber) {
      return { outcome: 'confirmationMismatch' };
    }

    if (this.hasBlockingDeliveryEvent(input.companyId, input.invoiceId)) {
      return { outcome: 'deliveryConflict' };
    }

    const updateResult = this.database
      .prepare<
        {
          cancellation_reason: string;
          cancelled_at: string;
          cancelled_by: string;
          company_id: string;
          id: string;
          invoice_number: string;
        }
      >(
        `
          UPDATE invoices
          SET
            status = 'cancelled',
            cancelled_at = @cancelled_at,
            cancelled_by = @cancelled_by,
            cancellation_reason = @cancellation_reason,
            updated_at = @cancelled_at
          WHERE
            company_id = @company_id
            AND id = @id
            AND invoice_number = @invoice_number
            AND status = 'approved'
        `,
      )
      .run({
        cancellation_reason: input.cancellationReason,
        cancelled_at: input.cancelledAt,
        cancelled_by: input.actorUserId,
        company_id: input.companyId,
        id: input.invoiceId,
        invoice_number: input.confirmationInvoiceNumber,
      });

    if (updateResult.changes !== 1) {
      return { outcome: 'notCancellable' };
    }

    this.database
      .prepare<
        {
          action: 'invoice.cancelled';
          actor_user_id: string;
          company_id: string;
          created_at: string;
          draft_id: string;
          id: string;
          invoice_id: string;
          invoice_number: string;
        }
      >(
        `
          INSERT INTO invoice_audit_events (
            id,
            company_id,
            actor_user_id,
            action,
            draft_id,
            invoice_id,
            invoice_number,
            created_at
          )
          VALUES (
            @id,
            @company_id,
            @actor_user_id,
            @action,
            @draft_id,
            @invoice_id,
            @invoice_number,
            @created_at
          )
        `,
      )
      .run({
        action: 'invoice.cancelled',
        actor_user_id: input.actorUserId,
        company_id: input.companyId,
        created_at: input.cancelledAt,
        draft_id: invoice.source_draft_id,
        id: input.auditEventId,
        invoice_id: input.invoiceId,
        invoice_number: invoice.invoice_number,
      });

    return {
      outcome: 'cancelled',
      invoice: {
        cancellationReason: input.cancellationReason,
        cancelledAt: input.cancelledAt,
        cancelledBy: input.actorUserId,
        invoiceId: input.invoiceId,
        invoiceKind: invoice.invoice_kind,
        invoiceNumber: invoice.invoice_number,
        status: 'cancelled',
      },
    };
  }

  private getInvoice(
    companyId: string,
    invoiceId: string,
  ): CancellableInvoiceRow | undefined {
    return this.database
      .prepare<
        { company_id: string; id: string },
        CancellableInvoiceRow
      >(
        `
          SELECT invoice_kind, invoice_number, source_draft_id, status
          FROM invoices
          WHERE company_id = @company_id AND id = @id
        `,
      )
      .get({ company_id: companyId, id: invoiceId });
  }

  private hasBlockingDeliveryEvent(
    companyId: string,
    invoiceId: string,
  ): boolean {
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
            AND status IN ('attempted', 'outcomeUnknown', 'succeeded')
          LIMIT 1
        `,
      )
      .get({ company_id: companyId, invoice_id: invoiceId });

    return row !== undefined;
  }
}
