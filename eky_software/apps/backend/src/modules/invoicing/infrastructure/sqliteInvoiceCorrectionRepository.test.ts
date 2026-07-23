import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import type { CancelApprovedInvoicePersistenceInput } from '../ports/invoiceCorrectionRepository.js';
import { SqliteInvoiceCorrectionRepository } from './sqliteInvoiceCorrectionRepository.js';

describe('SqliteInvoiceCorrectionRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await runMigrations(database);
    insertApprovedInvoice(database);
  });

  afterEach(() => {
    database.close();
  });

  it('cancels an approved invoice and records audit in one transaction', async () => {
    const repository = new SqliteInvoiceCorrectionRepository(database);

    await expect(
      repository.cancelApprovedInvoice(createInput()),
    ).resolves.toEqual({
      outcome: 'cancelled',
      invoice: {
        cancellationReason: 'Duplicate invoice',
        cancelledAt: '2026-07-23T10:00:00.000Z',
        cancelledBy: 'user-1',
        invoiceId: 'invoice-1',
        invoiceKind: 'standard',
        invoiceNumber: '20260001',
        status: 'cancelled',
      },
    });

    expect(getInvoiceState(database)).toEqual({
      cancellation_reason: 'Duplicate invoice',
      cancelled_at: '2026-07-23T10:00:00.000Z',
      cancelled_by: 'user-1',
      status: 'cancelled',
      updated_at: '2026-07-23T10:00:00.000Z',
    });
    expect(getCancellationAudit(database)).toEqual({
      action: 'invoice.cancelled',
      actor_user_id: 'user-1',
      company_id: 'company-1',
      created_at: '2026-07-23T10:00:00.000Z',
      draft_id: 'draft-1',
      invoice_id: 'invoice-1',
      invoice_number: '20260001',
    });
  });

  it('returns generic not-found outside the company scope', async () => {
    const repository = new SqliteInvoiceCorrectionRepository(database);

    await expect(
      repository.cancelApprovedInvoice(
        createInput({ companyId: 'other-company' }),
      ),
    ).resolves.toEqual({ outcome: 'notFound' });

    expect(getInvoiceState(database)?.status).toBe('approved');
    expect(getCancellationAudit(database)).toBeUndefined();
  });

  it('does not cancel when invoice-number confirmation differs', async () => {
    const repository = new SqliteInvoiceCorrectionRepository(database);

    await expect(
      repository.cancelApprovedInvoice(
        createInput({ confirmationInvoiceNumber: '20269999' }),
      ),
    ).resolves.toEqual({ outcome: 'confirmationMismatch' });

    expect(getInvoiceState(database)?.status).toBe('approved');
    expect(getCancellationAudit(database)).toBeUndefined();
  });

  it.each(['sent', 'cancelled', 'reopened_for_edit'])(
    'does not cancel an invoice in %s state',
    async (status) => {
      if (status === 'cancelled') {
        database
          .prepare(
            `
              UPDATE invoices
              SET
                status = 'cancelled',
                cancelled_at = '2026-07-22T10:00:00.000Z',
                cancelled_by = 'user-2',
                cancellation_reason = 'Already cancelled'
              WHERE id = 'invoice-1'
            `,
          )
          .run();
      } else {
        database
          .prepare('UPDATE invoices SET status = ? WHERE id = ?')
          .run(status, 'invoice-1');
      }
      const repository = new SqliteInvoiceCorrectionRepository(database);

      await expect(
        repository.cancelApprovedInvoice(createInput()),
      ).resolves.toEqual({ outcome: 'notCancellable' });

      expect(getCancellationAudit(database)).toBeUndefined();
    },
  );

  it.each(['attempted', 'outcomeUnknown', 'succeeded'])(
    'blocks cancellation when a %s delivery event exists',
    async (status) => {
      insertDeliveryEvent(database, status);
      const repository = new SqliteInvoiceCorrectionRepository(database);

      await expect(
        repository.cancelApprovedInvoice(createInput()),
      ).resolves.toEqual({ outcome: 'deliveryConflict' });

      expect(getInvoiceState(database)?.status).toBe('approved');
      expect(getCancellationAudit(database)).toBeUndefined();
    },
  );

  it.each(['prepared', 'failed'])(
    'allows cancellation when only a %s delivery event exists',
    async (status) => {
      insertDeliveryEvent(database, status);
      const repository = new SqliteInvoiceCorrectionRepository(database);

      await expect(
        repository.cancelApprovedInvoice(createInput()),
      ).resolves.toMatchObject({ outcome: 'cancelled' });
    },
  );

  it('rolls back the status update if audit insertion fails', async () => {
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
            'audit-cancel-1',
            'company-1',
            'user-1',
            'invoice.cancelled',
            'draft-1',
            'invoice-1',
            '20260001',
            '2026-07-22T10:00:00.000Z'
          )
        `,
      )
      .run();
    const repository = new SqliteInvoiceCorrectionRepository(database);

    await expect(
      repository.cancelApprovedInvoice(createInput()),
    ).rejects.toThrow();

    expect(getInvoiceState(database)).toMatchObject({
      cancellation_reason: null,
      cancelled_at: null,
      cancelled_by: null,
      status: 'approved',
      updated_at: '2026-07-01T10:00:00.000Z',
    });
  });
});

function createInput(
  overrides: Partial<CancelApprovedInvoicePersistenceInput> = {},
): CancelApprovedInvoicePersistenceInput {
  return {
    actorUserId: 'user-1',
    auditEventId: 'audit-cancel-1',
    cancellationReason: 'Duplicate invoice',
    cancelledAt: '2026-07-23T10:00:00.000Z',
    companyId: 'company-1',
    confirmationInvoiceNumber: '20260001',
    invoiceId: 'invoice-1',
    ...overrides,
  };
}

function insertApprovedInvoice(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO invoice_drafts (
          id,
          company_id,
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
          'draft-1',
          'company-1',
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
    .run();
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
          'approved',
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
}

function insertDeliveryEvent(
  database: DatabaseConnection,
  status: string,
): void {
  database
    .prepare(
      `
        INSERT INTO invoice_delivery_events (
          id,
          company_id,
          invoice_id,
          delivery_method,
          provider,
          status,
          created_at,
          created_by
        )
        VALUES (
          'delivery-1',
          'company-1',
          'invoice-1',
          'email',
          'smtp',
          ?,
          '2026-07-22T10:00:00.000Z',
          'user-1'
        )
      `,
    )
    .run(status);
}

function getInvoiceState(database: DatabaseConnection) {
  return database
    .prepare<
      [],
      {
        cancellation_reason: string | null;
        cancelled_at: string | null;
        cancelled_by: string | null;
        status: string;
        updated_at: string;
      }
    >(
      `
        SELECT
          cancellation_reason,
          cancelled_at,
          cancelled_by,
          status,
          updated_at
        FROM invoices
        WHERE id = 'invoice-1'
      `,
    )
    .get();
}

function getCancellationAudit(database: DatabaseConnection) {
  return database
    .prepare<
      [],
      {
        action: string;
        actor_user_id: string;
        company_id: string;
        created_at: string;
        draft_id: string;
        invoice_id: string;
        invoice_number: string;
      }
    >(
      `
        SELECT
          action,
          actor_user_id,
          company_id,
          created_at,
          draft_id,
          invoice_id,
          invoice_number
        FROM invoice_audit_events
        WHERE action = 'invoice.cancelled'
        ORDER BY created_at DESC
        LIMIT 1
      `,
    )
    .get();
}
