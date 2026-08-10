import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from './runMigrations.js';

const temporaryDirectories: string[] = [];
const releaseIdentity = {
  appVersion: '0.1.0-alpha.1',
  buildRevision: '1234567abcdef',
};
const recordedAt = new Date('2026-08-10T12:00:00.000Z');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('runMigrations', () => {
  it('stores source and chain metadata with the applying release identity', async () => {
    const directory = await createMigrationDirectory({
      '001_create_spike_table.sql':
        'CREATE TABLE desktop_spike (id TEXT PRIMARY KEY);',
      '002_add_spike_name.sql':
        'ALTER TABLE desktop_spike ADD COLUMN name TEXT NOT NULL DEFAULT \'\';',
    });
    const database = new Database(':memory:');

    await runMigrations(database, {
      migrationsDirectory: directory,
      now: () => recordedAt,
      releaseIdentity,
    });

    const rows = readMetadataRows(database);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({
        metadata_origin: 'applied',
        migration_name: '001_create_spike_table.sql',
        recorded_app_version: releaseIdentity.appVersion,
        recorded_at: recordedAt.toISOString(),
        recorded_build_revision: releaseIdentity.buildRevision,
      }),
      expect.objectContaining({
        metadata_origin: 'applied',
        migration_name: '002_add_spike_name.sql',
      }),
    ]);
    expect(rows[0]?.source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.chain_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1]?.chain_sha256).not.toBe(rows[0]?.chain_sha256);
    database.close();
  });

  it('anchors an exact legacy migration prefix without claiming its original build', async () => {
    const migrationSql = 'CREATE TABLE desktop_spike (id TEXT PRIMARY KEY);';
    const directory = await createMigrationDirectory({
      '001_create_spike_table.sql': migrationSql,
    });
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        run_at TEXT NOT NULL
      );
      ${migrationSql}
    `);
    database
      .prepare(
        'INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)',
      )
      .run('001_create_spike_table.sql', '2026-01-01T00:00:00.000Z');

    await runMigrations(database, {
      migrationsDirectory: directory,
      now: () => recordedAt,
      releaseIdentity,
    });

    expect(readMetadataRows(database)).toEqual([
      expect.objectContaining({
        metadata_origin: 'legacy_baseline',
        migration_name: '001_create_spike_table.sql',
        recorded_app_version: releaseIdentity.appVersion,
        recorded_build_revision: releaseIdentity.buildRevision,
      }),
    ]);
    database.close();
  });

  it('rejects changed historical SQL before applying a pending migration', async () => {
    const directory = await createMigrationDirectory({
      '001_create_spike_table.sql':
        'CREATE TABLE desktop_spike (id TEXT PRIMARY KEY);',
    });
    const database = new Database(':memory:');
    await runMigrations(database, {
      migrationsDirectory: directory,
      now: () => recordedAt,
      releaseIdentity,
    });
    await writeFile(
      join(directory, '001_create_spike_table.sql'),
      'CREATE TABLE desktop_spike (id TEXT PRIMARY KEY, changed TEXT);',
      'utf8',
    );
    await writeFile(
      join(directory, '002_create_pending_table.sql'),
      'CREATE TABLE pending_table (id TEXT PRIMARY KEY);',
      'utf8',
    );

    await expect(
      runMigrations(database, {
        migrationsDirectory: directory,
        now: () => recordedAt,
        releaseIdentity,
      }),
    ).rejects.toThrow('MIGRATION_HISTORY_INVALID');

    expect(tableExists(database, 'pending_table')).toBe(false);
    expect(readAppliedMigrationNames(database)).toEqual([
      '001_create_spike_table.sql',
    ]);
    database.close();
  });

  it.each([
    ['missing metadata row', (database: Database.Database) => {
      database.exec('DELETE FROM schema_migration_metadata;');
    }],
    ['broken chain', (database: Database.Database) => {
      database.exec(
        `UPDATE schema_migration_metadata SET chain_sha256 = '${'f'.repeat(64)}';`,
      );
    }],
    ['wrong source checksum', (database: Database.Database) => {
      database.exec(
        `UPDATE schema_migration_metadata SET source_sha256 = '${'e'.repeat(64)}';`,
      );
    }],
  ])('rejects %s before migration writes', async (_name, corruptHistory) => {
    const directory = await createMigrationDirectory({
      '001_create_spike_table.sql':
        'CREATE TABLE desktop_spike (id TEXT PRIMARY KEY);',
    });
    const database = new Database(':memory:');
    await runMigrations(database, {
      migrationsDirectory: directory,
      now: () => recordedAt,
      releaseIdentity,
    });
    corruptHistory(database);
    await writeFile(
      join(directory, '002_create_pending_table.sql'),
      'CREATE TABLE pending_table (id TEXT PRIMARY KEY);',
      'utf8',
    );

    await expect(
      runMigrations(database, {
        migrationsDirectory: directory,
        now: () => recordedAt,
        releaseIdentity,
      }),
    ).rejects.toThrow('MIGRATION_HISTORY_INVALID');

    expect(tableExists(database, 'pending_table')).toBe(false);
    database.close();
  });

  it('rejects a non-prefix legacy history before creating metadata', async () => {
    const directory = await createMigrationDirectory({
      '001_create_first_table.sql':
        'CREATE TABLE first_table (id TEXT PRIMARY KEY);',
      '002_create_second_table.sql':
        'CREATE TABLE second_table (id TEXT PRIMARY KEY);',
    });
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        run_at TEXT NOT NULL
      );
    `);
    database
      .prepare(
        'INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)',
      )
      .run('002_create_second_table.sql', recordedAt.toISOString());

    await expect(
      runMigrations(database, {
        migrationsDirectory: directory,
        now: () => recordedAt,
        releaseIdentity,
      }),
    ).rejects.toThrow('MIGRATION_HISTORY_INVALID');

    expect(tableExists(database, 'schema_migration_metadata')).toBe(false);
    expect(tableExists(database, 'first_table')).toBe(false);
    expect(tableExists(database, 'second_table')).toBe(false);
    database.close();
  });

  it('rejects duplicate migration ordinals before creating history tables', async () => {
    const directory = await createMigrationDirectory({
      '001_create_first_table.sql':
        'CREATE TABLE first_table (id TEXT PRIMARY KEY);',
      '001_create_second_table.sql':
        'CREATE TABLE second_table (id TEXT PRIMARY KEY);',
    });
    const database = new Database(':memory:');

    await expect(
      runMigrations(database, {
        migrationsDirectory: directory,
        now: () => recordedAt,
        releaseIdentity,
      }),
    ).rejects.toThrow('MIGRATION_MANIFEST_INVALID');

    expect(tableExists(database, 'schema_migrations')).toBe(false);
    expect(tableExists(database, 'first_table')).toBe(false);
    expect(tableExists(database, 'second_table')).toBe(false);
    database.close();
  });

  it('rejects an invalid release identity before creating history tables', async () => {
    const directory = await createMigrationDirectory({
      '001_create_spike_table.sql':
        'CREATE TABLE desktop_spike (id TEXT PRIMARY KEY);',
    });
    const database = new Database(':memory:');

    await expect(
      runMigrations(database, {
        migrationsDirectory: directory,
        now: () => recordedAt,
        releaseIdentity: {
          appVersion: 'invalid version',
          buildRevision: releaseIdentity.buildRevision,
        },
      }),
    ).rejects.toThrow('MIGRATION_RELEASE_IDENTITY_INVALID');

    expect(tableExists(database, 'schema_migrations')).toBe(false);
    expect(tableExists(database, 'desktop_spike')).toBe(false);
    database.close();
  });

  it('rolls back SQL, history and metadata when metadata persistence fails', async () => {
    const directory = await createMigrationDirectory({
      '001_create_spike_table.sql':
        'CREATE TABLE desktop_spike (id TEXT PRIMARY KEY);',
    });
    const database = new Database(':memory:');
    await runMigrations(database, {
      migrationsDirectory: directory,
      now: () => recordedAt,
      releaseIdentity,
    });
    await writeFile(
      join(directory, '002_create_pending_table.sql'),
      'CREATE TABLE pending_table (id TEXT PRIMARY KEY);',
      'utf8',
    );
    database.exec(`
      CREATE TRIGGER reject_pending_migration_metadata
      BEFORE INSERT ON schema_migration_metadata
      WHEN NEW.migration_name = '002_create_pending_table.sql'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic metadata failure');
      END;
    `);

    await expect(
      runMigrations(database, {
        migrationsDirectory: directory,
        now: () => recordedAt,
        releaseIdentity,
      }),
    ).rejects.toThrow();

    expect(tableExists(database, 'pending_table')).toBe(false);
    expect(readAppliedMigrationNames(database)).toEqual([
      '001_create_spike_table.sql',
    ]);
    expect(readMetadataRows(database)).toHaveLength(1);
    database.close();
  });
});

async function createMigrationDirectory(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'eky-migrations-'));
  temporaryDirectories.push(directory);

  await Promise.all(
    Object.entries(files).map(([fileName, content]) =>
      writeFile(join(directory, fileName), content, 'utf8'),
    ),
  );

  return directory;
}

function readMetadataRows(database: Database.Database): Array<{
  chain_sha256: string;
  metadata_origin: string;
  migration_name: string;
  recorded_app_version: string;
  recorded_at: string;
  recorded_build_revision: string;
  source_sha256: string;
}> {
  return database
    .prepare(
      `
        SELECT
          migration_name,
          source_sha256,
          chain_sha256,
          metadata_origin,
          recorded_app_version,
          recorded_build_revision,
          recorded_at
        FROM schema_migration_metadata
        ORDER BY migration_name
      `,
    )
    .all() as Array<{
      chain_sha256: string;
      metadata_origin: string;
      migration_name: string;
      recorded_app_version: string;
      recorded_at: string;
      recorded_build_revision: string;
      source_sha256: string;
    }>;
}

function readAppliedMigrationNames(database: Database.Database): string[] {
  return (
    database
      .prepare('SELECT name FROM schema_migrations ORDER BY name')
      .all() as Array<{ name: string }>
  ).map(({ name }) => name);
}

function tableExists(database: Database.Database, tableName: string): boolean {
  return (
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(tableName) !== undefined
  );
}
