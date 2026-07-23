import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import type { ApproveCreditInvoiceDraftPersistenceInput } from '../ports/invoiceCreditApprovalRepository.js';
import { SqliteInvoiceCreditApprovalRepository } from './sqliteInvoiceCreditApprovalRepository.js';

describe('SqliteInvoiceCreditApprovalRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await runMigrations(database);
    insertFixture(database);
  });

  afterEach(() => {
    database.close();
  });

  it('approves a credit draft with numbering, source links, and audit atomically', async () => {
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).resolves.toEqual({
      outcome: 'approved',
      invoice: {
        invoiceId: 'credit-invoice-1',
        draftId: 'credit-draft-1',
        invoiceNumber: '20260002',
        sequenceNumber: 2,
        sequenceScope: 'calendar-year:2026',
        numberingMode: 'calendarYearSequence',
        status: 'approved',
      },
    });

    expect(getCreditInvoice(database)).toMatchObject({
      invoice_kind: 'credit',
      credited_invoice_id: 'source-invoice-1',
      reference_number: null,
      customer_name_snapshot: 'Snapshot Customer Oy',
      total_net_cents: 5_000,
      total_vat_cents: 1_275,
      total_gross_cents: 6_275,
    });
    expect(getCreditLine(database)).toMatchObject({
      source_invoice_line_id: 'source-line-1',
      description: 'Partial credit',
      quantity_hundredths: 50,
      net_cents: 5_000,
      vat_cents: 1_275,
      gross_cents: 6_275,
    });
    expect(getAudit(database)).toMatchObject({
      action: 'invoice.credit_approved',
      actor_user_id: 'user-1',
      invoice_number: '20260002',
    });
    expect(getCreditDraft(database)).toMatchObject({
      approved_invoice_id: 'credit-invoice-1',
      approved_at: '2026-07-23T12:00:00.000Z',
    });
  });

  it('rechecks cumulative credit capacity inside the transaction', async () => {
    insertPreviousCredit(database, 60);
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).rejects.toBeInstanceOf(
      InvoiceCreditError,
    );

    expect(getCreditInvoice(database)).toBeUndefined();
    expect(getCreditDraft(database)?.approved_invoice_id).toBeNull();
    expect(getSequence(database)?.last_sequence_number).toBe(1);
  });

  it('approves a manual credit and snapshots the optional refund account', async () => {
    replaceDraftLineWithManualCredit(database);
    database
      .prepare(
        `
          UPDATE invoice_drafts
          SET refund_iban = 'FI2112345600000785'
          WHERE id = 'credit-draft-1'
        `,
      )
      .run();
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).resolves.toMatchObject({
      outcome: 'approved',
    });

    expect(getCreditInvoice(database)).toMatchObject({
      refund_iban_snapshot: 'FI2112345600000785',
      total_net_cents: 2_500,
      total_vat_cents: 638,
      total_gross_cents: 3_138,
    });
    expect(getCreditLine(database)).toMatchObject({
      source_invoice_line_id: null,
      description: 'Manual customer credit',
      quantity_hundredths: 100,
      unit: 'kpl',
      unit_price_cents: 2_500,
      vat_rate_basis_points: 2_550,
      net_cents: 2_500,
      vat_cents: 638,
      gross_cents: 3_138,
    });
  });

  it('returns a conflict if the source invoice is no longer sent', async () => {
    database
      .prepare(
        "UPDATE invoices SET status = 'approved' WHERE id = 'source-invoice-1'",
      )
      .run();
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).resolves.toEqual({
      outcome: 'conflict',
    });
    expect(getCreditInvoice(database)).toBeUndefined();
  });

  it('rolls back all approval writes when audit persistence fails', async () => {
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
            'audit-credit-approval-1',
            'company-1',
            'user-1',
            'invoice.credit_draft_created',
            'credit-draft-1',
            'source-invoice-1',
            '20260001',
            '2026-07-23T11:00:00.000Z'
          )
        `,
      )
      .run();
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).rejects.toThrow();

    expect(getCreditInvoice(database)).toBeUndefined();
    expect(getCreditDraft(database)?.approved_invoice_id).toBeNull();
    expect(getSequence(database)?.last_sequence_number).toBe(1);
  });
});

function createInput(): ApproveCreditInvoiceDraftPersistenceInput {
  return {
    actorUserId: 'user-1',
    approvedAt: '2026-07-23T12:00:00.000Z',
    auditEventId: 'audit-credit-approval-1',
    companyId: 'company-1',
    draftId: 'credit-draft-1',
    invoiceId: 'credit-invoice-1',
    seriesKey: 'default',
  };
}

function insertFixture(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO invoice_numbering_settings (
          company_id,
          series_key,
          mode,
          fiscal_year_start_month,
          sequence_padding,
          first_sequence_number,
          created_at,
          updated_at
        )
        VALUES (
          'company-1',
          'default',
          'calendarYearSequence',
          1,
          4,
          1,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        )
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoice_number_sequences (
          company_id,
          series_key,
          sequence_scope,
          last_sequence_number,
          created_at,
          updated_at
        )
        VALUES (
          'company-1',
          'default',
          'calendar-year:2026',
          1,
          '2026-01-01T00:00:00.000Z',
          '2026-07-01T00:00:00.000Z'
        )
      `,
    )
    .run();
  insertDraft(database, 'source-draft-1', 'standard', null, 100);
  database
    .prepare(
      `
        INSERT INTO invoices (
          id,
          company_id,
          source_draft_id,
          invoice_number,
          reference_number,
          reference_number_type,
          series_key,
          sequence_scope,
          sequence_number,
          numbering_mode,
          status,
          customer_id,
          customer_name_snapshot,
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
          'source-invoice-1',
          'company-1',
          'source-draft-1',
          '20260001',
          '202600017',
          'finnishDomestic',
          'default',
          'calendar-year:2026',
          1,
          'calendarYearSequence',
          'sent',
          'customer-1',
          'Snapshot Customer Oy',
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
          'source-invoice-1',
          1,
          'WORK',
          'Source work',
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
  insertDraft(database, 'credit-draft-1', 'credit', 'source-invoice-1', 50);
  database
    .prepare(
      `
        INSERT INTO invoice_draft_lines (
          id,
          invoice_draft_id,
          source_invoice_line_id,
          position,
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
          gross_cents
        )
        VALUES (
          'credit-draft-line-1',
          'credit-draft-1',
          'source-line-1',
          1,
          'WORK',
          'Partial credit',
          50,
          'h',
          10000,
          2550,
          'none',
          0,
          5000,
          0,
          5000,
          1275,
          6275
        )
      `,
    )
    .run();
}

function insertDraft(
  database: DatabaseConnection,
  id: string,
  invoiceKind: 'credit' | 'standard',
  creditedInvoiceId: string | null,
  quantityHundredths: number,
): void {
  const factor = quantityHundredths / 100;
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
          reminder_period_days,
          late_payment_interest_basis_points,
          price_input_mode,
          subject,
          note,
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
          '2026-07-23',
          '2026-07-23',
          0,
          0,
          0,
          'net',
          'Credit invoice',
          'Credit note',
          @netTotalCents,
          @vatTotalCents,
          @grossTotalCents,
          '2026-07-23T10:00:00.000Z',
          '2026-07-23T10:00:00.000Z'
        )
      `,
    )
    .run({
      id,
      invoiceKind,
      creditedInvoiceId,
      netTotalCents: Math.round(10_000 * factor),
      vatTotalCents: Math.round(2_550 * factor),
      grossTotalCents: Math.round(12_550 * factor),
    });
}

function insertPreviousCredit(
  database: DatabaseConnection,
  quantityHundredths: number,
): void {
  database
    .prepare(
      "UPDATE invoice_drafts SET credited_invoice_id = NULL WHERE id = 'credit-draft-1'",
    )
    .run();
  insertDraft(
    database,
    'previous-credit-draft',
    'credit',
    'source-invoice-1',
    quantityHundredths,
  );
  database
    .prepare(
      `
        UPDATE invoice_drafts
        SET
          approved_invoice_id = 'previous-credit-invoice',
          approved_at = '2026-07-20T10:00:00.000Z'
        WHERE id = 'previous-credit-draft'
      `,
    )
    .run();
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
          updated_at
        )
        VALUES (
          'previous-credit-invoice',
          'company-1',
          'previous-credit-draft',
          'credit',
          'source-invoice-1',
          '20260002',
          'default',
          'calendar-year:2026',
          2,
          'calendarYearSequence',
          'sent',
          'customer-1',
          '2026-07-20',
          '2026-07-20',
          0,
          'net',
          6000,
          1530,
          7530,
          '2026-07-20T10:00:00.000Z',
          '2026-07-20T10:00:00.000Z',
          '2026-07-20T10:00:00.000Z'
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
          source_invoice_line_id,
          line_order,
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
          'previous-credit-line',
          'previous-credit-invoice',
          'source-line-1',
          1,
          'Previous credit',
          @quantityHundredths,
          'h',
          10000,
          2550,
          'none',
          0,
          6000,
          0,
          6000,
          1530,
          7530,
          '2026-07-20T10:00:00.000Z'
        )
      `,
    )
    .run({ quantityHundredths });
  database
    .prepare(
      `
        UPDATE invoice_drafts
        SET credited_invoice_id = 'source-invoice-1'
        WHERE id = 'credit-draft-1'
      `,
    )
    .run();
}

function replaceDraftLineWithManualCredit(
  database: DatabaseConnection,
): void {
  database
    .prepare(
      `
        DELETE FROM invoice_draft_lines
        WHERE invoice_draft_id = 'credit-draft-1'
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoice_draft_lines (
          id,
          invoice_draft_id,
          source_invoice_line_id,
          position,
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
          gross_cents
        )
        VALUES (
          'manual-credit-draft-line',
          'credit-draft-1',
          NULL,
          1,
          '',
          'Manual customer credit',
          100,
          'kpl',
          2500,
          2550,
          'none',
          0,
          1,
          0,
          1,
          0,
          1
        )
      `,
    )
    .run();
}

function getCreditInvoice(database: DatabaseConnection) {
  return database
    .prepare("SELECT * FROM invoices WHERE id = 'credit-invoice-1'")
    .get();
}

function getCreditLine(database: DatabaseConnection) {
  return database
    .prepare(
      "SELECT * FROM invoice_lines WHERE invoice_id = 'credit-invoice-1'",
    )
    .get();
}

function getAudit(database: DatabaseConnection) {
  return database
    .prepare(
      "SELECT * FROM invoice_audit_events WHERE action = 'invoice.credit_approved'",
    )
    .get();
}

function getCreditDraft(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT approved_invoice_id, approved_at
        FROM invoice_drafts
        WHERE id = 'credit-draft-1'
      `,
    )
    .get() as
    | { approved_at: string | null; approved_invoice_id: string | null }
    | undefined;
}

function getSequence(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT last_sequence_number
        FROM invoice_number_sequences
        WHERE
          company_id = 'company-1'
          AND series_key = 'default'
          AND sequence_scope = 'calendar-year:2026'
      `,
    )
    .get() as { last_sequence_number: number } | undefined;
}
