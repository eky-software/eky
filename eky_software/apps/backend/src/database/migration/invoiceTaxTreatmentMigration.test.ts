import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface MigratedDraftRow {
  tax_treatment: string;
  performance_date: string | null;
  performance_period_start: string | null;
  performance_period_end: string | null;
}

interface MigratedLineRow {
  vat_rate_basis_points: number | null;
}

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const migrationNames = readdirSync(migrationsDirectory)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort();

describe('invoice tax treatment migration', () => {
  it('backfills old data as normal VAT without reinterpreting a zero rate', () => {
    const database = createDatabaseBeforeTaxTreatments();

    insertLegacyDraft(database, {
      id: 'old-draft',
      netTotalCents: 1000,
      vatTotalCents: 0,
      grossTotalCents: 1000,
    });
    insertDraftLine(database, {
      id: 'old-line',
      invoiceDraftId: 'old-draft',
      position: 1,
      vatRateBasisPoints: 0,
    });

    runMigration(database, '033_add_invoice_tax_treatments.sql');

    expect(
      database
        .prepare<[], MigratedDraftRow>(
          `
            SELECT
              tax_treatment,
              performance_date,
              performance_period_start,
              performance_period_end
            FROM invoice_drafts
            WHERE id = 'old-draft'
          `,
        )
        .get(),
    ).toEqual({
      tax_treatment: 'normalVat',
      performance_date: null,
      performance_period_start: null,
      performance_period_end: null,
    });
    expect(
      database
        .prepare<[], MigratedLineRow>(
          `
            SELECT vat_rate_basis_points
            FROM invoice_draft_lines
            WHERE id = 'old-line'
          `,
        )
        .get(),
    ).toEqual({
      vat_rate_basis_points: 0,
    });
    expect(database.pragma('foreign_key_check')).toEqual([]);

    database.close();
  });

  it('preserves existing credit line references while replacing line tables', () => {
    const database = createDatabaseBeforeTaxTreatments();

    insertLegacyDraft(database, {
      id: 'source-draft',
      netTotalCents: 1000,
      vatTotalCents: 255,
      grossTotalCents: 1255,
    });
    insertLegacyInvoice(database);
    insertLegacyInvoiceLine(database);
    insertLegacyCreditDraft(database);
    insertDraftLine(database, {
      id: 'credit-draft-line',
      invoiceDraftId: 'credit-draft',
      position: 1,
      vatRateBasisPoints: 2550,
      sourceInvoiceLineId: 'source-invoice-line',
    });

    runMigration(database, '033_add_invoice_tax_treatments.sql');

    expect(
      database
        .prepare<
          [],
          {
            source_invoice_line_id: string | null;
            vat_rate_basis_points: number | null;
          }
        >(
          `
            SELECT source_invoice_line_id, vat_rate_basis_points
            FROM invoice_draft_lines
            WHERE id = 'credit-draft-line'
          `,
        )
        .get(),
    ).toEqual({
      source_invoice_line_id: 'source-invoice-line',
      vat_rate_basis_points: 2550,
    });
    expect(
      database
        .prepare<[], { id: string }>(
          `
            SELECT id
            FROM invoice_lines
            WHERE id = 'source-invoice-line'
          `,
        )
        .get(),
    ).toEqual({
      id: 'source-invoice-line',
    });
    expect(database.pragma('foreign_key_check')).toEqual([]);

    database.close();
  });

  it('enforces nullable VAT rates according to the parent tax treatment', () => {
    const database = createDatabaseBeforeTaxTreatments();
    runMigration(database, '033_add_invoice_tax_treatments.sql');

    insertDraft(database, {
      id: 'normal-draft',
      netTotalCents: 1000,
      vatTotalCents: 255,
      grossTotalCents: 1255,
      taxTreatment: 'normalVat',
    });
    expect(() =>
      insertDraftLine(database, {
        id: 'normal-line',
        invoiceDraftId: 'normal-draft',
        position: 1,
        vatRateBasisPoints: null,
      }),
    ).toThrow(/normal VAT draft line requires a VAT rate/);
    insertDraftLine(database, {
      id: 'normal-line-with-rate',
      invoiceDraftId: 'normal-draft',
      position: 1,
      vatRateBasisPoints: 2550,
    });

    insertDraft(database, {
      id: 'reverse-draft',
      netTotalCents: 1000,
      vatTotalCents: 0,
      grossTotalCents: 1000,
      taxTreatment: 'reverseChargeConstruction',
    });
    insertDraftLine(database, {
      id: 'reverse-line',
      invoiceDraftId: 'reverse-draft',
      position: 1,
      vatRateBasisPoints: null,
    });
    expect(() =>
      insertDraftLine(database, {
        id: 'reverse-line-with-rate',
        invoiceDraftId: 'reverse-draft',
        position: 2,
        vatRateBasisPoints: 0,
      }),
    ).toThrow(/reverse charge draft line cannot contain a VAT rate/);
    expect(() =>
      database
        .prepare(
          `
            UPDATE invoice_drafts
            SET
              tax_treatment = 'reverseChargeConstruction',
              vat_total_cents = 0,
              gross_total_cents = net_total_cents
            WHERE id = 'normal-draft'
          `,
        )
        .run(),
    ).toThrow(/invoice draft lines do not match tax treatment/);

    database.close();
  });

  it('enforces valid and mutually exclusive performance dates', () => {
    const database = createDatabaseBeforeTaxTreatments();
    runMigration(database, '033_add_invoice_tax_treatments.sql');

    expect(() =>
      insertDraft(database, {
        id: 'invalid-period-draft',
        netTotalCents: 1000,
        vatTotalCents: 255,
        grossTotalCents: 1255,
        performancePeriodStart: '2026-07-27',
        performancePeriodEnd: '2026-07-26',
      }),
    ).toThrow();
    expect(() =>
      insertDraft(database, {
        id: 'mixed-period-draft',
        netTotalCents: 1000,
        vatTotalCents: 255,
        grossTotalCents: 1255,
        performanceDate: '2026-07-26',
        performancePeriodStart: '2026-07-01',
        performancePeriodEnd: '2026-07-26',
      }),
    ).toThrow();

    insertDraft(database, {
      id: 'valid-period-draft',
      netTotalCents: 1000,
      vatTotalCents: 255,
      grossTotalCents: 1255,
      performancePeriodStart: '2026-07-01',
      performancePeriodEnd: '2026-07-26',
    });

    database.close();
  });
});

function createDatabaseBeforeTaxTreatments(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');

  for (const migrationName of migrationNames) {
    if (migrationName === '033_add_invoice_tax_treatments.sql') {
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
      throw new Error(
        `Migration left foreign key violations: ${JSON.stringify(foreignKeyViolations)}`,
      );
    }
  })();
}

function insertDraft(
  database: Database.Database,
  input: {
    id: string;
    netTotalCents: number;
    vatTotalCents: number;
    grossTotalCents: number;
    taxTreatment?: string;
    performanceDate?: string | null;
    performancePeriodStart?: string | null;
    performancePeriodEnd?: string | null;
  },
): void {
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
          subject,
          order_number,
          note,
          net_total_cents,
          vat_total_cents,
          gross_total_cents,
          created_at,
          updated_at,
          tax_treatment,
          performance_date,
          performance_period_start,
          performance_period_end
        )
        VALUES (
          @id,
          'company-1',
          'customer-1',
          'draft',
          '2026-07-26',
          '2026-08-09',
          14,
          'net',
          '',
          '',
          '',
          @netTotalCents,
          @vatTotalCents,
          @grossTotalCents,
          '2026-07-26T10:00:00.000Z',
          '2026-07-26T10:00:00.000Z',
          @taxTreatment,
          @performanceDate,
          @performancePeriodStart,
          @performancePeriodEnd
        )
      `,
    )
    .run({
      id: input.id,
      netTotalCents: input.netTotalCents,
      vatTotalCents: input.vatTotalCents,
      grossTotalCents: input.grossTotalCents,
      taxTreatment: input.taxTreatment ?? 'normalVat',
      performanceDate: input.performanceDate ?? null,
      performancePeriodStart: input.performancePeriodStart ?? null,
      performancePeriodEnd: input.performancePeriodEnd ?? null,
    });
}

function insertLegacyDraft(
  database: Database.Database,
  input: {
    id: string;
    netTotalCents: number;
    vatTotalCents: number;
    grossTotalCents: number;
  },
): void {
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
          subject,
          order_number,
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
          'customer-1',
          'draft',
          '2026-07-26',
          '2026-08-09',
          14,
          'net',
          '',
          '',
          '',
          @netTotalCents,
          @vatTotalCents,
          @grossTotalCents,
          '2026-07-26T10:00:00.000Z',
          '2026-07-26T10:00:00.000Z'
        )
      `,
    )
    .run(input);
}

function insertDraftLine(
  database: Database.Database,
  input: {
    id: string;
    invoiceDraftId: string;
    position: number;
    vatRateBasisPoints: number | null;
    sourceInvoiceLineId?: string | null;
  },
): void {
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
          @id,
          @invoiceDraftId,
          @sourceInvoiceLineId,
          @position,
          '',
          'Work',
          100,
          'h',
          1000,
          @vatRateBasisPoints,
          'none',
          0,
          1000,
          0,
          1000,
          0,
          1000
        )
      `,
    )
    .run({
      ...input,
      sourceInvoiceLineId: input.sourceInvoiceLineId ?? null,
    });
}

function insertLegacyInvoice(database: Database.Database): void {
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
          'source-invoice',
          'company-1',
          'source-draft',
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
          1000,
          255,
          1255,
          '2026-07-01T10:00:00.000Z',
          '2026-07-01T10:00:00.000Z',
          '2026-07-01T10:00:00.000Z'
        )
      `,
    )
    .run();
}

function insertLegacyInvoiceLine(database: Database.Database): void {
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
          'source-invoice-line',
          'source-invoice',
          1,
          '',
          'Work',
          100,
          'h',
          1000,
          2550,
          'none',
          0,
          1000,
          0,
          1000,
          255,
          1255,
          '2026-07-01T10:00:00.000Z'
        )
      `,
    )
    .run();
}

function insertLegacyCreditDraft(database: Database.Database): void {
  insertLegacyDraft(database, {
    id: 'credit-draft',
    netTotalCents: 1000,
    vatTotalCents: 255,
    grossTotalCents: 1255,
  });
  database
    .prepare(
      `
        UPDATE invoice_drafts
        SET
          invoice_kind = 'credit',
          credited_invoice_id = 'source-invoice'
        WHERE id = 'credit-draft'
      `,
    )
    .run();
}
