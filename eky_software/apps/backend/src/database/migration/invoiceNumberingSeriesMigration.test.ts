import Database from 'better-sqlite3';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const migrationNames = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const seriesMigrationName =
  '038_create_invoice_numbering_series_transitions.sql';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('invoice numbering series migration', () => {
  it('backfills active pointers on a real database copy without changing settings or sequences', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eky-numbering-series-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'source.sqlite');
    const migratedPath = join(directory, 'migrated.sqlite');
    const source = new Database(sourcePath);
    source.pragma('foreign_keys = ON');
    runMigrationsBeforeSeries(source);
    source.exec(`
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
        'migration-company',
        'default',
        'calendarYearSequence',
        1,
        4,
        1,
        '2026-06-25T10:00:00.000Z',
        '2026-06-25T10:00:00.000Z'
      );

      INSERT INTO invoice_number_sequences (
        company_id,
        series_key,
        sequence_scope,
        last_sequence_number,
        created_at,
        updated_at
      )
      VALUES (
        'migration-company',
        'default',
        'calendar-year:2026',
        42,
        '2026-06-25T10:00:00.000Z',
        '2026-06-25T10:00:00.000Z'
      );
    `);
    const settingsBefore = readRows(
      source,
      'SELECT * FROM invoice_numbering_settings ORDER BY company_id, series_key',
    );
    const sequencesBefore = readRows(
      source,
      'SELECT * FROM invoice_number_sequences ORDER BY company_id, series_key, sequence_scope',
    );
    source.close();

    copyFileSync(sourcePath, migratedPath);
    const migrated = new Database(migratedPath);
    migrated.pragma('foreign_keys = ON');
    migrated.exec(readMigration(seriesMigrationName));

    expect(
      readRows(
        migrated,
        'SELECT * FROM invoice_numbering_settings ORDER BY company_id, series_key',
      ),
    ).toEqual(settingsBefore);
    expect(
      readRows(
        migrated,
        'SELECT * FROM invoice_number_sequences ORDER BY company_id, series_key, sequence_scope',
      ),
    ).toEqual(sequencesBefore);
    expect(
      migrated
        .prepare<
          [],
          {
            active_series_key: string;
            company_id: string;
            revision: number;
          }
        >(
          `
            SELECT company_id, active_series_key, revision
            FROM invoice_numbering_active_series
          `,
        )
        .all(),
    ).toEqual([
      {
        active_series_key: 'default',
        company_id: 'migration-company',
        revision: 1,
      },
    ]);
    expect(migrated.pragma('foreign_key_check')).toEqual([]);
    migrated.close();
  });

  it('supports an empty database and does not invent a settings row', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    runMigrationsBeforeSeries(database);

    expect(() => database.exec(readMigration(seriesMigrationName))).not.toThrow();
    expect(
      database
        .prepare<[], { count: number }>(
          'SELECT COUNT(*) AS count FROM invoice_numbering_active_series',
        )
        .get()?.count,
    ).toBe(0);
    expect(
      database
        .prepare<[], { count: number }>(
          'SELECT COUNT(*) AS count FROM invoice_numbering_settings',
        )
        .get()?.count,
    ).toBe(0);
    database.close();
  });
});

function runMigrationsBeforeSeries(database: Database.Database): void {
  for (const migrationName of migrationNames) {
    if (migrationName === seriesMigrationName) {
      break;
    }

    database.exec(readMigration(migrationName));
  }
}

function readMigration(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

function readRows(
  database: Database.Database,
  statement: string,
): unknown[] {
  return database.prepare(statement).all();
}
