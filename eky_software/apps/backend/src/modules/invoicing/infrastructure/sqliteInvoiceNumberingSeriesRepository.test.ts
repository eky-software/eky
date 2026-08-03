import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { ActivateInvoiceNumberingSeriesPersistenceInput } from '../ports/invoiceNumberingSeriesRepository.js';
import { SqliteInvoiceNumberingSeriesRepository } from './sqliteInvoiceNumberingSeriesRepository.js';

const numberingMigrationSql = readMigration(
  '008_create_invoice_numbering.sql',
);
const seriesMigrationSql = readMigration(
  '038_create_invoice_numbering_series_transitions.sql',
);

describe('SqliteInvoiceNumberingSeriesRepository', () => {
  let database: DatabaseConnection;
  let repository: SqliteInvoiceNumberingSeriesRepository;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(numberingMigrationSql);
    database.exec(`
      CREATE TABLE invoices (
        company_id TEXT NOT NULL,
        series_key TEXT NOT NULL,
        invoice_number TEXT NOT NULL
      );
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
      VALUES
        ('dev-company', 'default', 'calendarYearSequence', 1, 4, 1, 'created', 'updated'),
        ('other-company', 'default', 'plainSequence', 1, 4, 1, 'created', 'updated');
    `);
    database.exec(seriesMigrationSql);
    repository = new SqliteInvoiceNumberingSeriesRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('activates a new immutable series without consuming a number', async () => {
    const result = await repository.activate(createActivation());

    expect(result).toMatchObject({
      outcome: 'activated',
      overview: {
        activeSeries: {
          activeSeriesKey: 'series-2',
          revision: 2,
        },
        activeSettings: {
          firstSequenceNumber: 100,
          seriesKey: 'series-2',
        },
        history: [
          {
            event: {
              previousSeriesKey: 'default',
              nextSeriesKey: 'series-2',
            },
            settings: { seriesKey: 'default' },
          },
        ],
      },
    });
    expect(readCount(database, 'invoice_number_sequences')).toBe(0);
    expect(readCount(database, 'invoice_numbering_series_events')).toBe(1);
  });

  it('keeps reads and writes scoped to the trusted company', async () => {
    await repository.activate(createActivation());

    await expect(repository.getOverview('other-company')).resolves.toMatchObject({
      activeSeries: {
        activeSeriesKey: 'default',
        revision: 1,
      },
      history: [],
    });
    expect(
      database
        .prepare<[string], { count: number }>(
          `
            SELECT COUNT(*) AS count
            FROM invoice_numbering_settings
            WHERE company_id = ?
          `,
        )
        .get('other-company')?.count,
    ).toBe(1);
  });

  it('rejects stale state without creating settings, events or sequences', async () => {
    await expect(
      repository.activate(
        createActivation({
          activeSeries: {
            companyId: 'dev-company',
            activeSeriesKey: 'series-2',
            revision: 3,
            updatedAt: '2026-08-02T20:00:00.000Z',
            updatedBy: 'local-owner',
          },
          expectedRevision: 2,
        }),
      ),
    ).resolves.toEqual({ outcome: 'conflict' });

    expect(readCount(database, 'invoice_numbering_settings')).toBe(2);
    expect(readCount(database, 'invoice_numbering_series_events')).toBe(0);
    expect(readCount(database, 'invoice_number_sequences')).toBe(0);
  });

  it('recalculates the safe start inside the write transaction', async () => {
    database
      .prepare<[string, string, string]>(
        `
          INSERT INTO invoices (company_id, series_key, invoice_number)
          VALUES (?, ?, ?)
        `,
      )
      .run('dev-company', 'default', '0150');

    await expect(
      repository.activate(createActivation()),
    ).resolves.toEqual({ outcome: 'unsafeFirstSequenceNumber' });
    expect(readCount(database, 'invoice_numbering_settings')).toBe(2);
    expect(readCount(database, 'invoice_numbering_series_events')).toBe(0);
  });

  it.each([
    ['pointer', 'BEFORE UPDATE ON invoice_numbering_active_series'],
    ['event', 'BEFORE INSERT ON invoice_numbering_series_events'],
  ])('rolls back completely after a synthetic %s failure', async (_, target) => {
    database.exec(`
      CREATE TRIGGER synthetic_series_failure
      ${target}
      BEGIN
        SELECT RAISE(ABORT, 'synthetic series failure');
      END;
    `);

    await expect(repository.activate(createActivation())).rejects.toThrow(
      'synthetic series failure',
    );

    await expect(repository.getOverview('dev-company')).resolves.toMatchObject({
      activeSeries: { activeSeriesKey: 'default', revision: 1 },
      history: [],
    });
    expect(readCount(database, 'invoice_numbering_settings')).toBe(2);
    expect(readCount(database, 'invoice_numbering_series_events')).toBe(0);
    expect(readCount(database, 'invoice_number_sequences')).toBe(0);
  });

  it('enforces immutable series settings and append-only transition events', async () => {
    await repository.activate(createActivation());

    expect(() =>
      database
        .prepare<[number, string, string]>(
          `
            UPDATE invoice_numbering_settings
            SET first_sequence_number = ?
            WHERE company_id = ? AND series_key = ?
          `,
        )
        .run(200, 'dev-company', 'series-2'),
    ).toThrow('Used invoice numbering settings are immutable.');
    expect(() =>
      database
        .prepare<[string]>(
          'DELETE FROM invoice_numbering_series_events WHERE id = ?',
        )
        .run('event-2'),
    ).toThrow('Invoice numbering series events are append-only.');
  });
});

function createActivation(
  overrides: Partial<ActivateInvoiceNumberingSeriesPersistenceInput> = {},
): ActivateInvoiceNumberingSeriesPersistenceInput {
  return {
    activeSeries: {
      companyId: 'dev-company',
      activeSeriesKey: 'series-2',
      revision: 2,
      updatedAt: '2026-08-02T20:00:00.000Z',
      updatedBy: 'local-owner',
    },
    event: {
      id: 'event-2',
      companyId: 'dev-company',
      actorUserId: 'local-owner',
      previousSeriesKey: 'default',
      nextSeriesKey: 'series-2',
      reasonCode: 'accountingRequirement',
      reasonNote: null,
      occurredAt: '2026-08-02T20:00:00.000Z',
    },
    expectedActiveSeriesKey: 'default',
    expectedRevision: 1,
    nextSettings: {
      companyId: 'dev-company',
      seriesKey: 'series-2',
      mode: 'plainSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 4,
      firstSequenceNumber: 100,
      createdAt: '2026-08-02T20:00:00.000Z',
      updatedAt: '2026-08-02T20:00:00.000Z',
    },
    ...overrides,
  };
}

function readMigration(name: string): string {
  return readFileSync(
    new URL(`../../../database/migrations/${name}`, import.meta.url),
    'utf8',
  );
}

function readCount(database: DatabaseConnection, tableName: string): number {
  return (
    database
      .prepare<[], { count: number }>(
        `SELECT COUNT(*) AS count FROM ${tableName}`,
      )
      .get()?.count ?? 0
  );
}
