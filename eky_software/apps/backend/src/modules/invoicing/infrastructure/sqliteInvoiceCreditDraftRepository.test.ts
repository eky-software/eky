import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { SqliteInvoiceCreditDraftRepository } from './sqliteInvoiceCreditDraftRepository.js';

describe('SqliteInvoiceCreditDraftRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await runMigrations(database);
    insertSentSourceInvoice(database);
  });

  afterEach(() => {
    database.close();
  });

  it('creates the draft and audit event atomically', async () => {
    const repository = new SqliteInvoiceCreditDraftRepository(database);

    await expect(
      repository.createCreditDraft(createInput()),
    ).resolves.toEqual({
      outcome: 'created',
      draftId: 'credit-draft-1',
    });

    expect(getStoredCreditDraft(database)).toEqual({
      company_id: 'company-1',
      credited_invoice_id: 'invoice-1',
      invoice_kind: 'credit',
      status: 'draft',
    });
    expect(getStoredCreditLine(database)).toMatchObject({
      source_invoice_line_id: 'source-line-1',
      quantity_hundredths: 100,
      unit_price_cents: 10_000,
      vat_rate_basis_points: 2_550,
      gross_cents: 12_550,
    });
    expect(getCreditDraftAudit(database)).toEqual({
      action: 'invoice.credit_draft_created',
      actor_user_id: 'user-1',
      company_id: 'company-1',
      draft_id: 'credit-draft-1',
      invoice_id: 'invoice-1',
      invoice_number: '20260001',
    });
  });

  it('returns the existing active draft without inserting another audit event', async () => {
    const repository = new SqliteInvoiceCreditDraftRepository(database);

    await repository.createCreditDraft(createInput());
    const secondDraft = createDraft({ id: 'credit-draft-2' });

    await expect(
      repository.createCreditDraft({
        ...createInput(),
        auditEventId: 'audit-credit-draft-2',
        draft: secondDraft,
      }),
    ).resolves.toEqual({
      outcome: 'existing',
      draftId: 'credit-draft-1',
    });

    expect(
      database
        .prepare<[], { count: number }>(
          `
            SELECT COUNT(*) AS count
            FROM invoice_drafts
            WHERE invoice_kind = 'credit'
          `,
        )
        .get()?.count,
    ).toBe(1);
    expect(
      database
        .prepare<[], { count: number }>(
          `
            SELECT COUNT(*) AS count
            FROM invoice_audit_events
            WHERE action = 'invoice.credit_draft_created'
          `,
        )
        .get()?.count,
    ).toBe(1);
  });

  it('does not create a draft outside a sent standard source invoice', async () => {
    database
      .prepare("UPDATE invoices SET status = 'approved' WHERE id = 'invoice-1'")
      .run();
    const repository = new SqliteInvoiceCreditDraftRepository(database);

    await expect(
      repository.createCreditDraft(createInput()),
    ).resolves.toEqual({ outcome: 'notEligible' });

    expect(getStoredCreditDraft(database)).toBeUndefined();
  });

  it('rolls back draft and lines when audit insertion fails', async () => {
    database
      .prepare(
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
            'audit-credit-draft-1',
            'company-1',
            'user-1',
            'invoice.credit_draft_created',
            'other-draft',
            'invoice-1',
            '20260001',
            '2026-07-22T10:00:00.000Z'
          )
        `,
      )
      .run();
    const repository = new SqliteInvoiceCreditDraftRepository(database);

    await expect(
      repository.createCreditDraft(createInput()),
    ).rejects.toThrow();

    expect(getStoredCreditDraft(database)).toBeUndefined();
    expect(getStoredCreditLine(database)).toBeUndefined();
  });

  it('reads only non-cancelled previous credit allocations in company scope', async () => {
    insertApprovedCredit(database, {
      draftId: 'approved-credit-draft',
      invoiceId: 'credit-invoice-1',
      lineId: 'credit-line-1',
      status: 'sent',
      quantityHundredths: 40,
    });
    insertApprovedCredit(database, {
      draftId: 'cancelled-credit-draft',
      invoiceId: 'credit-invoice-2',
      lineId: 'credit-line-2',
      status: 'cancelled',
      quantityHundredths: 20,
    });
    const repository = new SqliteInvoiceCreditDraftRepository(database);

    await expect(
      repository.listPreviousCreditLineAllocations(
        'company-1',
        'invoice-1',
      ),
    ).resolves.toEqual([
      {
        sourceInvoiceLineId: 'source-line-1',
        quantityHundredths: 40,
        baseCents: 4_000,
        discountCents: 0,
        netCents: 4_000,
        vatCents: 1_020,
        grossCents: 5_020,
      },
    ]);

    await expect(
      repository.listPreviousCreditLineAllocations(
        'other-company',
        'invoice-1',
      ),
    ).resolves.toEqual([]);
  });
});

function createInput() {
  return {
    actorUserId: 'user-1',
    auditEventId: 'audit-credit-draft-1',
    draft: createDraft(),
    sourceInvoiceId: 'invoice-1',
  };
}

function createDraft(
  overrides: Partial<InvoiceDraft> = {},
): InvoiceDraft {
  return {
    id: 'credit-draft-1',
    companyId: 'company-1',
    invoiceKind: 'credit',
    creditedInvoiceId: 'invoice-1',
    customerId: 'customer-1',
    billingRecipientCustomerId: null,
    status: 'draft',
    invoiceDate: '2026-07-23',
    dueDate: '2026-07-23',
    paymentTermDays: 0,
    reminderPeriodDays: 0,
    latePaymentInterestBasisPoints: 0,
    priceInputMode: 'net',
    subject: 'Credit',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    lines: [
      {
        id: 'credit-draft-line-1',
        sourceInvoiceLineId: 'source-line-1',
        position: 1,
        code: 'WORK',
        description: 'Work credit',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2_550,
        priceInputMode: 'net',
        discount: { type: 'none' },
        baseCents: 10_000,
        discountCents: 0,
        netCents: 10_000,
        vatCents: 2_550,
        grossCents: 12_550,
      },
    ],
    totals: {
      netTotalCents: 10_000,
      vatTotalCents: 2_550,
      grossTotalCents: 12_550,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2_550,
          netCents: 10_000,
          vatCents: 2_550,
          grossCents: 12_550,
        },
      ],
    },
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

function insertSentSourceInvoice(database: DatabaseConnection): void {
  insertDraftRow(database, {
    id: 'draft-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
  });
  database
    .prepare(
      `
        INSERT INTO invoices (
          id,
          company_id,
          source_draft_id,
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
          updated_at
        )
        VALUES (
          'invoice-1',
          'company-1',
          'draft-1',
          '20260001',
          'default',
          'calendar-year:2026',
          1,
          'calendarYearSequence',
          'sent',
          'customer-1',
          '2026-07-01',
          '2026-07-15',
          14,
          'net',
          10000,
          2550,
          12550,
          '2026-07-01T10:00:00.000Z',
          '2026-07-01T10:00:00.000Z',
          '2026-07-01T10:00:00.000Z'
        )
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoice_lines (
          id,
          invoice_id,
          line_order,
          code,
          description,
          quantity_hundredths,
          unit,
          unit_price_cents,
          vat_rate_basis_points,
          discount_type,
          discount_value,
          base_cents,
          discount_cents,
          net_cents,
          vat_cents,
          gross_cents,
          created_at
        )
        VALUES (
          'source-line-1',
          'invoice-1',
          1,
          'WORK',
          'Work',
          100,
          'h',
          10000,
          2550,
          'none',
          0,
          10000,
          0,
          10000,
          2550,
          12550,
          '2026-07-01T10:00:00.000Z'
        )
      `,
    )
    .run();
}

function insertApprovedCredit(
  database: DatabaseConnection,
  input: {
    draftId: string;
    invoiceId: string;
    lineId: string;
    status: 'sent' | 'cancelled';
    quantityHundredths: number;
  },
): void {
  insertDraftRow(database, {
    id: input.draftId,
    invoiceKind: 'credit',
    creditedInvoiceId: 'invoice-1',
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
          @invoiceId,
          'company-1',
          @draftId,
          'credit',
          'invoice-1',
          @invoiceId,
          'default',
          'calendar-year:2026',
          @sequenceNumber,
          'calendarYearSequence',
          @status,
          'customer-1',
          '2026-07-10',
          '2026-07-10',
          0,
          'net',
          4000,
          1020,
          5020,
          '2026-07-10T10:00:00.000Z',
          '2026-07-10T10:00:00.000Z',
          '2026-07-10T10:00:00.000Z',
          @cancelledAt,
          @cancelledBy,
          @cancellationReason
        )
      `,
    )
    .run({
      invoiceId: input.invoiceId,
      draftId: input.draftId,
      sequenceNumber: input.invoiceId === 'credit-invoice-1' ? 2 : 3,
      status: input.status,
      cancelledAt:
        input.status === 'cancelled'
          ? '2026-07-11T10:00:00.000Z'
          : null,
      cancelledBy: input.status === 'cancelled' ? 'user-1' : null,
      cancellationReason:
        input.status === 'cancelled' ? 'Cancelled credit' : null,
    });
  database
    .prepare(
      `
        INSERT INTO invoice_lines (
          id,
          invoice_id,
          source_invoice_line_id,
          line_order,
          code,
          description,
          quantity_hundredths,
          unit,
          unit_price_cents,
          vat_rate_basis_points,
          discount_type,
          discount_value,
          base_cents,
          discount_cents,
          net_cents,
          vat_cents,
          gross_cents,
          created_at
        )
        VALUES (
          @lineId,
          @invoiceId,
          'source-line-1',
          1,
          'WORK',
          'Credit',
          @quantityHundredths,
          'h',
          10000,
          2550,
          'none',
          0,
          4000,
          0,
          4000,
          1020,
          5020,
          '2026-07-10T10:00:00.000Z'
        )
      `,
    )
    .run(input);
  database
    .prepare(
      `
        UPDATE invoice_drafts
        SET
          approved_invoice_id = ?,
          approved_at = '2026-07-10T10:00:00.000Z'
        WHERE id = ?
      `,
    )
    .run(input.invoiceId, input.draftId);
}

function insertDraftRow(
  database: DatabaseConnection,
  input: {
    id: string;
    invoiceKind: 'standard' | 'credit';
    creditedInvoiceId: string | null;
  },
): void {
  database
    .prepare(
      `
        INSERT INTO invoice_drafts (
          id,
          company_id,
          invoice_kind,
          credited_invoice_id,
          customer_id,
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
          @invoiceKind,
          @creditedInvoiceId,
          'customer-1',
          'draft',
          '2026-07-01',
          '2026-07-15',
          14,
          'net',
          10000,
          2550,
          12550,
          '2026-07-01T09:00:00.000Z',
          '2026-07-01T09:00:00.000Z'
        )
      `,
    )
    .run(input);
}

function getStoredCreditDraft(database: DatabaseConnection) {
  return database
    .prepare<
      [],
      {
        company_id: string;
        credited_invoice_id: string;
        invoice_kind: string;
        status: string;
      }
    >(
      `
        SELECT company_id, credited_invoice_id, invoice_kind, status
        FROM invoice_drafts
        WHERE id = 'credit-draft-1'
      `,
    )
    .get();
}

function getStoredCreditLine(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT *
        FROM invoice_draft_lines
        WHERE invoice_draft_id = 'credit-draft-1'
      `,
    )
    .get();
}

function getCreditDraftAudit(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT
          action,
          actor_user_id,
          company_id,
          draft_id,
          invoice_id,
          invoice_number
        FROM invoice_audit_events
        WHERE action = 'invoice.credit_draft_created'
      `,
    )
    .get();
}
