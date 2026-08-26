import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { invalidateW6b2MigrationHistoryDatabase } from './w6b2PackagedWorkspaceMigrationHistory.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('W6B.2 invalid migration history fixture', () => {
  it('changes only one migration metadata row and keeps SQLite business data healthy', async () => {
    const databaseFilePath = await createDatabaseFixture(true);

    invalidateW6b2MigrationHistoryDatabase(databaseFilePath);

    const database = new DatabaseSync(databaseFilePath, {
      open: true,
      readOnly: true,
    });
    try {
      const metadata = database
        .prepare(
          `
            SELECT migration_name, source_sha256
            FROM schema_migration_metadata
            ORDER BY migration_name
          `,
        )
        .all();
      expect(metadata).toEqual([
        {
          migration_name: '001_first.sql',
          source_sha256: 'b'.repeat(64),
        },
        {
          migration_name: '002_second.sql',
          source_sha256: 'a'.repeat(64),
        },
      ]);
      expect(
        database.prepare('SELECT value FROM business_probe').get(),
      ).toEqual({ value: 'preserved' });
      expect(database.prepare('PRAGMA integrity_check;').get()).toEqual({
        integrity_check: 'ok',
      });
      expect(database.prepare('PRAGMA foreign_key_check;').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('fails closed when the earliest migration has no metadata row', async () => {
    const databaseFilePath = await createDatabaseFixture(false);

    expect(() =>
      invalidateW6b2MigrationHistoryDatabase(databaseFilePath),
    ).toThrowError('W6B2_MIGRATION_HISTORY_NOT_CHANGED');

    const database = new DatabaseSync(databaseFilePath, {
      open: true,
      readOnly: true,
    });
    try {
      expect(
        database.prepare('SELECT value FROM business_probe').get(),
      ).toEqual({ value: 'preserved' });
      expect(database.prepare('PRAGMA integrity_check;').get()).toEqual({
        integrity_check: 'ok',
      });
    } finally {
      database.close();
    }
  });
});

async function createDatabaseFixture(
  includeEarliestMetadata: boolean,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-history-'));
  temporaryRoots.push(root);
  const databaseFilePath = join(root, 'workspace.sqlite');
  const database = new DatabaseSync(databaseFilePath);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY
      );
      CREATE TABLE schema_migration_metadata (
        migration_name TEXT PRIMARY KEY,
        source_sha256 TEXT NOT NULL,
        FOREIGN KEY (migration_name) REFERENCES schema_migrations(name)
      );
      CREATE TABLE business_probe (
        value TEXT NOT NULL
      );
      INSERT INTO schema_migrations (name)
      VALUES ('001_first.sql'), ('002_second.sql');
      INSERT INTO business_probe (value) VALUES ('preserved');
    `);
    if (includeEarliestMetadata) {
      database
        .prepare(
          `
            INSERT INTO schema_migration_metadata (
              migration_name,
              source_sha256
            ) VALUES (?, ?)
          `,
        )
        .run('001_first.sql', 'a'.repeat(64));
    }
    database
      .prepare(
        `
          INSERT INTO schema_migration_metadata (
            migration_name,
            source_sha256
          ) VALUES (?, ?)
        `,
      )
      .run('002_second.sql', 'a'.repeat(64));
  } finally {
    database.close();
  }
  return databaseFilePath;
}
