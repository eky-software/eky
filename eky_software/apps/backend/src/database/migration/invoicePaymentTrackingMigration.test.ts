import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const migrationNames = readdirSync(migrationsDirectory)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort();

describe('invoice payment tracking migration', () => {
  it('backfills an existing invoice as unpaid without foreign key damage', () => {
    const database = createDatabaseBeforePaymentTracking();
    insertInvoice(database);

    runMigration(database, '037_add_invoice_payment_tracking.sql');

    expect(
      database
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
        .get(),
    ).toEqual({
      paid_amount_cents: null,
      paid_on: null,
      payment_recorded_at: null,
      payment_recorded_by: null,
      payment_source: null,
      payment_state: 'unpaid',
    });
    expect(database.pragma('foreign_key_check')).toEqual([]);

    database.close();
  });

  it('enforces coherent current payment state and append-only events', () => {
    const database = createDatabaseBeforePaymentTracking();
    insertInvoice(database);
    runMigration(database, '037_add_invoice_payment_tracking.sql');

    expect(() =>
      database
        .prepare(
          "UPDATE invoices SET payment_state = 'paid' WHERE id = 'invoice-1'",
        )
        .run(),
    ).toThrow();

    database
      .prepare(
        `
          UPDATE invoices
          SET
            payment_state = 'paid',
            paid_on = '2026-07-31',
            paid_amount_cents = 12550,
            payment_source = 'manual',
            payment_recorded_at = '2026-07-31T10:00:00.000Z',
            payment_recorded_by = 'local-owner'
          WHERE id = 'invoice-1'
        `,
      )
      .run();

    expect(() =>
      database
        .prepare(
          "UPDATE invoices SET payment_state = 'unpaid' WHERE id = 'invoice-1'",
        )
        .run(),
    ).toThrow();

    insertPaymentEvent(database);
    expect(() =>
      database
        .prepare(
          `
            UPDATE invoice_payment_events
            SET amount_cents = 1
            WHERE id = 'payment-event-1'
          `,
        )
        .run(),
    ).toThrow(/append-only/);
    expect(() =>
      database
        .prepare(
          "DELETE FROM invoice_payment_events WHERE id = 'payment-event-1'",
        )
        .run(),
    ).toThrow(/append-only/);

    database.close();
  });
});

function createDatabaseBeforePaymentTracking(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');

  for (const migrationName of migrationNames) {
    if (migrationName === '037_add_invoice_payment_tracking.sql') {
      break;
    }

    runMigration(database, migrationName);
  }

  return database;
}

function runMigration(
  database: Database.Database,
  migrationName: string,
): void {
  database.transaction(() => {
    database.exec(
      readFileSync(new URL(migrationName, migrationsDirectory), 'utf8'),
    );
    const foreignKeyViolations = database.pragma(
      'foreign_key_check',
    ) as unknown[];

    if (foreignKeyViolations.length > 0) {
      throw new Error('Migration left foreign key violations.');
    }
  })();
}

function insertInvoice(database: Database.Database): void {
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
}

function insertPaymentEvent(database: Database.Database): void {
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
          'payment-event-1',
          'company-1',
          'invoice-1',
          'local-owner',
          'paymentMarkedPaid',
          'manual',
          '2026-07-31',
          12550,
          '2026-07-31T10:00:00.000Z'
        )
      `,
    )
    .run();
}
