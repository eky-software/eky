import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceNumberingSettingsRow,
  InvoiceNumberSequenceRow,
} from '../../../database/schema.js';
import {
  type InvoiceNumberSequenceState,
  type StoredInvoiceNumberingSettings,
  resolveInvoiceNumberSequenceScope,
} from '../domain/invoiceNumbering.js';
import { InvoiceNumberingError } from '../domain/invoiceNumberingError.js';
import { SqliteInvoiceNumberingRepository } from './sqliteInvoiceNumberingRepository.js';

const migrationSql = readFileSync(
  new URL(
    '../../../database/migrations/008_create_invoice_numbering.sql',
    import.meta.url,
  ),
  'utf8',
);

function createSettings(
  overrides: Partial<StoredInvoiceNumberingSettings> = {},
): StoredInvoiceNumberingSettings {
  return {
    companyId: 'dev-company',
    seriesKey: 'default',
    mode: 'calendarYearSequence',
    fiscalYearStartMonth: 1,
    sequencePadding: 4,
    firstSequenceNumber: 1,
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    ...overrides,
  };
}

function createSequence(
  overrides: Partial<InvoiceNumberSequenceState> = {},
): InvoiceNumberSequenceState {
  return {
    companyId: 'dev-company',
    seriesKey: 'default',
    sequenceScope: 'calendar-year:2027',
    lastSequenceNumber: 42,
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteInvoiceNumberingRepository', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(migrationSql);
  });

  afterEach(() => {
    database.close();
  });

  it('creates numbering settings and sequence tables with scoped unique keys', () => {
    const settingsTable = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get('invoice_numbering_settings');
    const sequencesTable = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get('invoice_number_sequences');

    expect(settingsTable?.name).toBe('invoice_numbering_settings');
    expect(sequencesTable?.name).toBe('invoice_number_sequences');

    const insertSettings = database.prepare<
      [string, string],
      InvoiceNumberingSettingsRow
    >(
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
        VALUES (?, ?, 'calendarYearSequence', 1, 4, 1, 'created', 'updated')
      `,
    );

    insertSettings.run('dev-company', 'default');
    expect(() => insertSettings.run('dev-company', 'default')).toThrow();
    expect(() => insertSettings.run('other-company', 'default')).not.toThrow();
    expect(() => insertSettings.run('dev-company', 'secondary')).not.toThrow();
  });

  it('saves and reads company-scoped numbering settings', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);
    const settings = createSettings();

    await expect(repository.saveSettings(settings)).resolves.toEqual(settings);
    await expect(
      repository.getSettings('dev-company', 'default'),
    ).resolves.toEqual(settings);
    await expect(
      repository.getSettings('other-company', 'default'),
    ).resolves.toBeUndefined();
    await expect(
      repository.getSettings('dev-company', "default' OR 1=1 --"),
    ).resolves.toBeUndefined();
  });

  it('stores all supported numbering modes through the settings repository', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);

    await repository.saveSettings(
      createSettings({ seriesKey: 'plain', mode: 'plainSequence' }),
    );
    await repository.saveSettings(
      createSettings({ seriesKey: 'calendar', mode: 'calendarYearSequence' }),
    );
    await repository.saveSettings(
      createSettings({
        seriesKey: 'fiscal',
        mode: 'fiscalYearSequence',
        fiscalYearStartMonth: 2,
      }),
    );

    await expect(
      repository.getSettings('dev-company', 'plain'),
    ).resolves.toMatchObject({ mode: 'plainSequence' });
    await expect(
      repository.getSettings('dev-company', 'calendar'),
    ).resolves.toMatchObject({ mode: 'calendarYearSequence' });
    await expect(
      repository.getSettings('dev-company', 'fiscal'),
    ).resolves.toMatchObject({
      mode: 'fiscalYearSequence',
      fiscalYearStartMonth: 2,
    });
  });

  it('rejects invalid settings before writing them', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);

    await expect(
      repository.saveSettings(
        createSettings({ sequencePadding: 13 }),
      ),
    ).rejects.toThrow(InvoiceNumberingError);
    await expect(
      repository.saveSettings(
        createSettings({ seriesKey: 'default;drop' }),
      ),
    ).rejects.toThrow(InvoiceNumberingError);

    const count = database
      .prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM invoice_numbering_settings',
      )
      .get();

    expect(count?.count).toBe(0);
  });

  it('updates numbering settings while preserving their createdAt timestamp', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);

    await repository.saveSettings(createSettings());
    await expect(
      repository.saveSettings(
        createSettings({
          sequencePadding: 6,
          createdAt: '2026-06-26T10:00:00.000Z',
          updatedAt: '2026-06-26T10:00:00.000Z',
        }),
      ),
    ).resolves.toEqual(
      createSettings({
        sequencePadding: 6,
        createdAt: '2026-06-25T10:00:00.000Z',
        updatedAt: '2026-06-26T10:00:00.000Z',
      }),
    );
  });

  it('saves and reads company-scoped sequence state', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);
    const settings = createSettings();
    const sequence = createSequence();

    await repository.saveSettings(settings);

    await expect(repository.hasUsedNumbering('dev-company', 'default')).resolves.toBe(
      false,
    );
    await expect(repository.saveSequence(sequence)).resolves.toEqual(sequence);
    await expect(
      repository.getSequence('dev-company', 'default', 'calendar-year:2027'),
    ).resolves.toEqual(sequence);
    await expect(
      repository.getSequence('other-company', 'default', 'calendar-year:2027'),
    ).resolves.toBeUndefined();
    await expect(
      repository.getSequence('dev-company', 'default', "calendar-year:2027' OR 1=1 --"),
    ).resolves.toBeUndefined();
    await expect(repository.hasUsedNumbering('dev-company', 'default')).resolves.toBe(
      true,
    );
  });

  it('requires an existing numbering settings row before saving sequence state', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);

    await expect(repository.saveSequence(createSequence())).rejects.toThrow();
  });

  it('allows the same sequence scope for different companies and series', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);

    await repository.saveSettings(createSettings());
    await repository.saveSettings(createSettings({ seriesKey: 'secondary' }));
    await repository.saveSettings(createSettings({ companyId: 'other-company' }));

    await repository.saveSequence(createSequence());
    await repository.saveSequence(
      createSequence({
        seriesKey: 'secondary',
        lastSequenceNumber: 10,
      }),
    );
    await repository.saveSequence(
      createSequence({
        companyId: 'other-company',
        lastSequenceNumber: 99,
      }),
    );

    const rows = database
      .prepare<[], InvoiceNumberSequenceRow>(
        `
          SELECT *
          FROM invoice_number_sequences
          ORDER BY company_id, series_key
        `,
      )
      .all();

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.sequence_scope)).toEqual([
      'calendar-year:2027',
      'calendar-year:2027',
      'calendar-year:2027',
    ]);
  });

  it('updates sequence state while preserving its createdAt timestamp', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);

    await repository.saveSettings(createSettings());
    await repository.saveSequence(createSequence());

    await expect(
      repository.saveSequence(
        createSequence({
          lastSequenceNumber: 43,
          createdAt: '2026-06-26T10:00:00.000Z',
          updatedAt: '2026-06-26T10:00:00.000Z',
        }),
      ),
    ).resolves.toEqual(
      createSequence({
        lastSequenceNumber: 43,
        createdAt: '2026-06-25T10:00:00.000Z',
        updatedAt: '2026-06-26T10:00:00.000Z',
      }),
    );
  });

  it('rejects invalid sequence state before writing it', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);

    await repository.saveSettings(createSettings());

    await expect(
      repository.saveSequence(
        createSequence({ lastSequenceNumber: 0 }),
      ),
    ).rejects.toThrow(InvoiceNumberingError);
    await expect(
      repository.saveSequence(
        createSequence({ sequenceScope: 'calendar year 2027' }),
      ),
    ).rejects.toThrow(InvoiceNumberingError);

    const count = database
      .prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM invoice_number_sequences',
      )
      .get();

    expect(count?.count).toBe(0);
  });

  it('uses domain sequence scope resolution for persisted sequence keys', async () => {
    const repository = new SqliteInvoiceNumberingRepository(database);
    const fiscalSettings = createSettings({
      mode: 'fiscalYearSequence',
      fiscalYearStartMonth: 2,
    });
    const calendarSettings = createSettings({
      seriesKey: 'calendar',
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 2,
    });

    await repository.saveSettings(fiscalSettings);
    await repository.saveSettings(calendarSettings);

    await repository.saveSequence(
      createSequence({
        sequenceScope: resolveInvoiceNumberSequenceScope(
          fiscalSettings,
          '2027-01-31',
        ),
      }),
    );
    await repository.saveSequence(
      createSequence({
        seriesKey: 'calendar',
        sequenceScope: resolveInvoiceNumberSequenceScope(
          calendarSettings,
          '2027-01-31',
        ),
      }),
    );

    await expect(
      repository.getSequence('dev-company', 'default', 'fiscal-year:2026'),
    ).resolves.toMatchObject({ lastSequenceNumber: 42 });
    await expect(
      repository.getSequence('dev-company', 'calendar', 'calendar-year:2027'),
    ).resolves.toMatchObject({ lastSequenceNumber: 42 });
  });
});
