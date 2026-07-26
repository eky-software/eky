import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteSystemDiagnosticSummaryReader } from './sqliteSystemDiagnosticSummaryReader.js';

describe('SqliteSystemDiagnosticSummaryReader', () => {
  let database: Database.Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('returns health and migration metadata without database paths or rows', async () => {
    database = new Database(':memory:');
    database.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        run_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (name, run_at)
      VALUES
        ('001_initial.sql', '2026-01-01T00:00:00.000Z'),
        ('002_next.sql', '2026-01-02T00:00:00.000Z');
    `);
    const reader = new SqliteSystemDiagnosticSummaryReader(database);

    await expect(reader.readDatabaseSummary()).resolves.toEqual({
      appliedMigrationCount: 2,
      health: 'ok',
      latestMigrationName: '002_next.sql',
    });
  });
});
