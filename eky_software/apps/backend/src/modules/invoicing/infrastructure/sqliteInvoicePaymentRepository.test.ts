import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import type {
  MarkInvoicePaidPersistenceInput,
  RevertInvoicePaidMarkPersistenceInput,
} from '../ports/invoicePaymentRepository.js';
import { SqliteInvoicePaymentRepository } from './sqliteInvoicePaymentRepository.js';

describe('SqliteInvoicePaymentRepository', () => {
  let database: DatabaseConnection;
  let repository: SqliteInvoicePaymentRepository;

  beforeEach(async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await runMigrations(database);
    insertInvoice(database);
    repository = new SqliteInvoicePaymentRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('marks a sent standard invoice paid and appends one event atomically', async () => {
    await expect(repository.markInvoicePaid(markInput())).resolves.toEqual({
      outcome: 'markedPaid',
      payment: {
        invoiceId: 'invoice-1',
        invoiceNumber: '20260001',
        paidAmountCents: 12_550,
        paidOn: '2026-07-31',
        paymentSource: 'manual',
        paymentState: 'paid',
      },
    });

    expect(getPaymentState(database)).toEqual({
      paid_amount_cents: 12_550,
      paid_on: '2026-07-31',
      payment_recorded_at: '2026-07-31T10:00:00.000Z',
      payment_recorded_by: 'local-owner',
      payment_source: 'manual',
      payment_state: 'paid',
    });
    expect(getEvents(database)).toEqual([
      {
        action: 'paymentMarkedPaid',
        actor_user_id: 'local-owner',
        amount_cents: 12_550,
        paid_on: '2026-07-31',
      },
    ]);
  });

  it('uses the remaining amount after active approved and sent credits', async () => {
    insertInvoice(database, {
      creditedInvoiceId: 'invoice-1',
      grossTotalCents: 2_000,
      id: 'credit-approved',
      invoiceKind: 'credit',
      invoiceNumber: '20260002',
      status: 'approved',
    });
    insertInvoice(database, {
      creditedInvoiceId: 'invoice-1',
      grossTotalCents: 550,
      id: 'credit-sent',
      invoiceKind: 'credit',
      invoiceNumber: '20260003',
      status: 'sent',
    });
    insertInvoice(database, {
      creditedInvoiceId: 'invoice-1',
      grossTotalCents: 5_000,
      id: 'credit-cancelled',
      invoiceKind: 'credit',
      invoiceNumber: '20260004',
      status: 'cancelled',
    });

    await expect(repository.markInvoicePaid(markInput())).resolves.toMatchObject({
      outcome: 'markedPaid',
      payment: { paidAmountCents: 10_000 },
    });
  });

  it('blocks fully credited, non-sent and credit invoices without writes', async () => {
    insertInvoice(database, {
      creditedInvoiceId: 'invoice-1',
      grossTotalCents: 12_550,
      id: 'credit-full',
      invoiceKind: 'credit',
      invoiceNumber: '20260002',
      status: 'approved',
    });

    await expect(repository.markInvoicePaid(markInput())).resolves.toEqual({
      outcome: 'notPayable',
    });

    database
      .prepare("UPDATE invoices SET status = 'approved' WHERE id = 'invoice-1'")
      .run();
    await expect(repository.markInvoicePaid(markInput())).resolves.toEqual({
      outcome: 'conflict',
    });
    await expect(
      repository.markInvoicePaid(
        markInput({ invoiceId: 'credit-full', eventId: 'event-credit' }),
      ),
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(getEvents(database)).toEqual([]);
  });

  it('returns generic not-found outside the company scope', async () => {
    await expect(
      repository.markInvoicePaid(markInput({ companyId: 'other-company' })),
    ).resolves.toEqual({ outcome: 'notFound' });

    expect(getPaymentState(database)?.payment_state).toBe('unpaid');
  });

  it('is idempotent for the same date and conflicts for a different date', async () => {
    await repository.markInvoicePaid(markInput());

    await expect(
      repository.markInvoicePaid(markInput({ eventId: 'event-2' })),
    ).resolves.toMatchObject({ outcome: 'idempotent' });
    await expect(
      repository.markInvoicePaid(
        markInput({
          eventId: 'event-3',
          paidOn: '2026-07-30',
        }),
      ),
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(getEvents(database)).toHaveLength(1);
  });

  it('handles concurrent duplicate requests with one event', async () => {
    const results = await Promise.all([
      repository.markInvoicePaid(markInput()),
      repository.markInvoicePaid(markInput({ eventId: 'event-2' })),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'idempotent',
      'markedPaid',
    ]);
    expect(getEvents(database)).toHaveLength(1);
  });

  it('reverts the current projection while preserving append-only history', async () => {
    await repository.markInvoicePaid(markInput());

    await expect(repository.revertInvoicePaidMark(revertInput())).resolves.toEqual({
      outcome: 'reverted',
      payment: {
        invoiceId: 'invoice-1',
        invoiceNumber: '20260001',
        paidAmountCents: null,
        paidOn: null,
        paymentSource: null,
        paymentState: 'unpaid',
      },
    });
    await expect(
      repository.revertInvoicePaidMark(
        revertInput({ eventId: 'event-revert-2' }),
      ),
    ).resolves.toMatchObject({ outcome: 'idempotent' });

    expect(getPaymentState(database)?.payment_state).toBe('unpaid');
    expect(getEvents(database)).toEqual([
      expect.objectContaining({ action: 'paymentMarkedPaid' }),
      expect.objectContaining({
        action: 'paymentMarkReverted',
        amount_cents: 12_550,
        paid_on: '2026-07-31',
      }),
    ]);
  });

  it('rolls back the current state if event insertion fails', async () => {
    database
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
            'event-1',
            'company-1',
            'invoice-1',
            'local-owner',
            'paymentMarkedPaid',
            'manual',
            '2026-07-30',
            1,
            '2026-07-30T10:00:00.000Z'
          )
        `,
      )
      .run();

    await expect(repository.markInvoicePaid(markInput())).rejects.toThrow();

    expect(getPaymentState(database)?.payment_state).toBe('unpaid');
    expect(getEvents(database)).toHaveLength(1);
  });

  it('does not append an event when the current state update fails', async () => {
    database.exec(`
      CREATE TRIGGER synthetic_payment_update_failure
      BEFORE UPDATE OF payment_state ON invoices
      WHEN NEW.payment_state = 'paid'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic payment update failure');
      END;
    `);

    await expect(repository.markInvoicePaid(markInput())).rejects.toThrow(
      /synthetic payment update failure/,
    );

    expect(getPaymentState(database)?.payment_state).toBe('unpaid');
    expect(getEvents(database)).toEqual([]);
  });
});

function markInput(
  overrides: Partial<MarkInvoicePaidPersistenceInput> = {},
): MarkInvoicePaidPersistenceInput {
  return {
    actorUserId: 'local-owner',
    companyId: 'company-1',
    eventId: 'event-1',
    invoiceId: 'invoice-1',
    paidOn: '2026-07-31',
    recordedAt: '2026-07-31T10:00:00.000Z',
    ...overrides,
  };
}

function revertInput(
  overrides: Partial<RevertInvoicePaidMarkPersistenceInput> = {},
): RevertInvoicePaidMarkPersistenceInput {
  return {
    actorUserId: 'local-owner',
    companyId: 'company-1',
    eventId: 'event-revert-1',
    invoiceId: 'invoice-1',
    recordedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function insertInvoice(
  database: DatabaseConnection,
  options: {
    creditedInvoiceId?: string | null;
    grossTotalCents?: number;
    id?: string;
    invoiceKind?: 'credit' | 'standard';
    invoiceNumber?: string;
    status?: 'approved' | 'cancelled' | 'sent';
  } = {},
): void {
  const id = options.id ?? 'invoice-1';
  const draftId = `draft-${id}`;
  const invoiceKind = options.invoiceKind ?? 'standard';
  const status = options.status ?? 'sent';
  const creditedInvoiceId = options.creditedInvoiceId ?? null;
  const grossTotalCents = options.grossTotalCents ?? 12_550;

  database
    .prepare(
      `
        INSERT INTO invoice_drafts (
          id,
          company_id,
          customer_id,
          invoice_kind,
          credited_invoice_id,
          status,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          net_total_cents,
          vat_total_cents,
          gross_total_cents,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          'company-1',
          'customer-1',
          @invoice_kind,
          @credited_invoice_id,
          'draft',
          '2026-07-01',
          '2026-07-15',
          14,
          'net',
          @net_total_cents,
          @vat_total_cents,
          @gross_total_cents,
          '2026-07-01T09:00:00.000Z',
          '2026-07-01T09:00:00.000Z'
        )
      `,
    )
    .run({
      credited_invoice_id: creditedInvoiceId,
      gross_total_cents: grossTotalCents,
      id: draftId,
      invoice_kind: invoiceKind,
      net_total_cents: grossTotalCents,
      vat_total_cents: 0,
    });

  database
    .prepare(
      `
        INSERT INTO invoices (
          id,
          company_id,
          source_draft_id,
          invoice_kind,
          credited_invoice_id,
          invoice_number,
          series_key,
          sequence_scope,
          sequence_number,
          numbering_mode,
          status,
          customer_id,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          total_net_cents,
          total_vat_cents,
          total_gross_cents,
          created_at,
          approved_at,
          updated_at,
          cancelled_at,
          cancelled_by,
          cancellation_reason
        )
        VALUES (
          @id,
          'company-1',
          @source_draft_id,
          @invoice_kind,
          @credited_invoice_id,
          @invoice_number,
          'default',
          'calendar-year:2026',
          @sequence_number,
          'calendarYearSequence',
          @status,
          'customer-1',
          '2026-07-01',
          '2026-07-15',
          14,
          'net',
          @total_net_cents,
          0,
          @total_gross_cents,
          '2026-07-01T10:00:00.000Z',
          '2026-07-01T10:00:00.000Z',
          '2026-07-01T10:00:00.000Z',
          @cancelled_at,
          @cancelled_by,
          @cancellation_reason
        )
      `,
    )
    .run({
      cancellation_reason: status === 'cancelled' ? 'Synthetic cancellation' : null,
      cancelled_at: status === 'cancelled' ? '2026-07-02T10:00:00.000Z' : null,
      cancelled_by: status === 'cancelled' ? 'local-owner' : null,
      credited_invoice_id: creditedInvoiceId,
      id,
      invoice_kind: invoiceKind,
      invoice_number: options.invoiceNumber ?? '20260001',
      sequence_number: Number.parseInt(
        (options.invoiceNumber ?? '20260001').slice(-2),
        10,
      ),
      source_draft_id: draftId,
      status,
      total_gross_cents: grossTotalCents,
      total_net_cents: grossTotalCents,
    });

  database
    .prepare(
      `
        UPDATE invoice_drafts
        SET
          approved_invoice_id = @approved_invoice_id,
          approved_at = '2026-07-01T10:00:00.000Z'
        WHERE id = @id
      `,
    )
    .run({ approved_invoice_id: id, id: draftId });
}

function getPaymentState(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT
          payment_state,
          paid_on,
          paid_amount_cents,
          payment_source,
          payment_recorded_at,
          payment_recorded_by
        FROM invoices
        WHERE id = 'invoice-1'
      `,
    )
    .get() as
    | {
        paid_amount_cents: number | null;
        paid_on: string | null;
        payment_recorded_at: string | null;
        payment_recorded_by: string | null;
        payment_source: string | null;
        payment_state: string;
      }
    | undefined;
}

function getEvents(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT action, actor_user_id, amount_cents, paid_on
        FROM invoice_payment_events
        WHERE invoice_id = 'invoice-1'
        ORDER BY occurred_at ASC, id ASC
      `,
    )
    .all() as Array<{
    action: string;
    actor_user_id: string;
    amount_cents: number;
    paid_on: string;
  }>;
}
