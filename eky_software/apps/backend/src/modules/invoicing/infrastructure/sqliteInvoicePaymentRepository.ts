import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoicePaymentSource,
  InvoicePaymentState,
  InvoicePaymentSummary,
} from '../domain/invoicePayment.js';
import type {
  InvoicePaymentRepository,
  MarkInvoicePaidPersistenceInput,
  MarkInvoicePaidPersistenceResult,
  RevertInvoicePaidMarkPersistenceInput,
  RevertInvoicePaidMarkPersistenceResult,
} from '../ports/invoicePaymentRepository.js';

interface PaymentInvoiceRow {
  invoice_kind: string;
  invoice_number: string;
  paid_amount_cents: number | null;
  paid_on: string | null;
  payment_source: InvoicePaymentSource | null;
  payment_state: InvoicePaymentState;
  status: string;
  total_gross_cents: number;
}

interface CreditedGrossRow {
  credited_gross_cents: number;
}

export class SqliteInvoicePaymentRepository
  implements InvoicePaymentRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async markInvoicePaid(
    input: MarkInvoicePaidPersistenceInput,
  ): Promise<MarkInvoicePaidPersistenceResult> {
    return this.database.transaction(() =>
      this.markInvoicePaidWithinTransaction(input),
    )();
  }

  async revertInvoicePaidMark(
    input: RevertInvoicePaidMarkPersistenceInput,
  ): Promise<RevertInvoicePaidMarkPersistenceResult> {
    return this.database.transaction(() =>
      this.revertInvoicePaidMarkWithinTransaction(input),
    )();
  }

  private markInvoicePaidWithinTransaction(
    input: MarkInvoicePaidPersistenceInput,
  ): MarkInvoicePaidPersistenceResult {
    const invoice = this.getInvoice(input.companyId, input.invoiceId);

    if (invoice === undefined) {
      return { outcome: 'notFound' };
    }

    if (invoice.invoice_kind !== 'standard' || invoice.status !== 'sent') {
      return { outcome: 'conflict' };
    }

    if (invoice.payment_state === 'paid') {
      return invoice.paid_on === input.paidOn
        ? {
            outcome: 'idempotent',
            payment: toPaymentSummary(input.invoiceId, invoice),
          }
        : { outcome: 'conflict' };
    }

    const paidAmountCents =
      invoice.total_gross_cents -
      this.getCreditedGrossCents(input.companyId, input.invoiceId);

    if (paidAmountCents <= 0) {
      return { outcome: 'notPayable' };
    }

    const updateResult = this.database
      .prepare(
        `
          UPDATE invoices
          SET
            payment_state = 'paid',
            paid_on = @paid_on,
            paid_amount_cents = @paid_amount_cents,
            payment_source = 'manual',
            payment_recorded_at = @payment_recorded_at,
            payment_recorded_by = @payment_recorded_by
          WHERE
            company_id = @company_id
            AND id = @id
            AND invoice_kind = 'standard'
            AND status = 'sent'
            AND payment_state = 'unpaid'
        `,
      )
      .run({
        company_id: input.companyId,
        id: input.invoiceId,
        paid_amount_cents: paidAmountCents,
        paid_on: input.paidOn,
        payment_recorded_at: input.recordedAt,
        payment_recorded_by: input.actorUserId,
      });

    if (updateResult.changes !== 1) {
      return { outcome: 'conflict' };
    }

    this.insertPaymentEvent({
      action: 'paymentMarkedPaid',
      actorUserId: input.actorUserId,
      amountCents: paidAmountCents,
      companyId: input.companyId,
      eventId: input.eventId,
      invoiceId: input.invoiceId,
      occurredAt: input.recordedAt,
      paidOn: input.paidOn,
    });

    return {
      outcome: 'markedPaid',
      payment: {
        invoiceId: input.invoiceId,
        invoiceNumber: invoice.invoice_number,
        paidAmountCents,
        paidOn: input.paidOn,
        paymentSource: 'manual',
        paymentState: 'paid',
      },
    };
  }

  private revertInvoicePaidMarkWithinTransaction(
    input: RevertInvoicePaidMarkPersistenceInput,
  ): RevertInvoicePaidMarkPersistenceResult {
    const invoice = this.getInvoice(input.companyId, input.invoiceId);

    if (invoice === undefined) {
      return { outcome: 'notFound' };
    }

    if (invoice.invoice_kind !== 'standard' || invoice.status !== 'sent') {
      return { outcome: 'conflict' };
    }

    if (invoice.payment_state === 'unpaid') {
      return {
        outcome: 'idempotent',
        payment: toPaymentSummary(input.invoiceId, invoice),
      };
    }

    if (
      invoice.paid_on === null ||
      invoice.paid_amount_cents === null ||
      invoice.payment_source === null
    ) {
      throw new Error('Stored invoice payment state is inconsistent.');
    }

    const updateResult = this.database
      .prepare(
        `
          UPDATE invoices
          SET
            payment_state = 'unpaid',
            paid_on = NULL,
            paid_amount_cents = NULL,
            payment_source = NULL,
            payment_recorded_at = NULL,
            payment_recorded_by = NULL
          WHERE
            company_id = @company_id
            AND id = @id
            AND invoice_kind = 'standard'
            AND status = 'sent'
            AND payment_state = 'paid'
        `,
      )
      .run({ company_id: input.companyId, id: input.invoiceId });

    if (updateResult.changes !== 1) {
      return { outcome: 'conflict' };
    }

    this.insertPaymentEvent({
      action: 'paymentMarkReverted',
      actorUserId: input.actorUserId,
      amountCents: invoice.paid_amount_cents,
      companyId: input.companyId,
      eventId: input.eventId,
      invoiceId: input.invoiceId,
      occurredAt: input.recordedAt,
      paidOn: invoice.paid_on,
    });

    return {
      outcome: 'reverted',
      payment: {
        invoiceId: input.invoiceId,
        invoiceNumber: invoice.invoice_number,
        paidAmountCents: null,
        paidOn: null,
        paymentSource: null,
        paymentState: 'unpaid',
      },
    };
  }

  private getInvoice(
    companyId: string,
    invoiceId: string,
  ): PaymentInvoiceRow | undefined {
    return this.database
      .prepare<
        { company_id: string; id: string },
        PaymentInvoiceRow
      >(
        `
          SELECT
            invoice_kind,
            invoice_number,
            paid_amount_cents,
            paid_on,
            payment_source,
            payment_state,
            status,
            total_gross_cents
          FROM invoices
          WHERE company_id = @company_id AND id = @id
        `,
      )
      .get({ company_id: companyId, id: invoiceId });
  }

  private getCreditedGrossCents(companyId: string, invoiceId: string): number {
    const row = this.database
      .prepare<
        { company_id: string; invoice_id: string },
        CreditedGrossRow
      >(
        `
          SELECT
            COALESCE(SUM(total_gross_cents), 0) AS credited_gross_cents
          FROM invoices
          WHERE
            company_id = @company_id
            AND credited_invoice_id = @invoice_id
            AND invoice_kind = 'credit'
            AND status IN ('approved', 'sent')
        `,
      )
      .get({ company_id: companyId, invoice_id: invoiceId });

    return row?.credited_gross_cents ?? 0;
  }

  private insertPaymentEvent(input: {
    action: 'paymentMarkedPaid' | 'paymentMarkReverted';
    actorUserId: string;
    amountCents: number;
    companyId: string;
    eventId: string;
    invoiceId: string;
    occurredAt: string;
    paidOn: string;
  }): void {
    this.database
      .prepare(
        `
          INSERT INTO invoice_payment_events (
            id,
            company_id,
            invoice_id,
            actor_user_id,
            action,
            payment_source,
            paid_on,
            amount_cents,
            occurred_at
          )
          VALUES (
            @id,
            @company_id,
            @invoice_id,
            @actor_user_id,
            @action,
            'manual',
            @paid_on,
            @amount_cents,
            @occurred_at
          )
        `,
      )
      .run({
        action: input.action,
        actor_user_id: input.actorUserId,
        amount_cents: input.amountCents,
        company_id: input.companyId,
        id: input.eventId,
        invoice_id: input.invoiceId,
        occurred_at: input.occurredAt,
        paid_on: input.paidOn,
      });
  }
}

function toPaymentSummary(
  invoiceId: string,
  invoice: PaymentInvoiceRow,
): InvoicePaymentSummary {
  return {
    invoiceId,
    invoiceNumber: invoice.invoice_number,
    paidAmountCents: invoice.paid_amount_cents,
    paidOn: invoice.paid_on,
    paymentSource: invoice.payment_source,
    paymentState: invoice.payment_state,
  };
}
