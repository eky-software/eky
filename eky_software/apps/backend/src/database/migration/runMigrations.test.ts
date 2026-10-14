import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from './runMigrations.js';
import { MigrationRunError } from './migrationRunError.js';
import { failMigrationWrite } from './migrationWriteFailure.fixture.js';
import { createMigrationMetadataTable, createMigrationTable } from './migrationMetadata.js';

const temporaryDirectories: string[] = [];
const releaseIdentity = {
  appVersion: '0.1.0-alpha.1',
  buildRevision: '1234567abcdef',
};
const recordedAt = new Date('2026-08-10T12:00:00.000Z');

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('runMigrations', () => {
  it.each([false, true])('bounds observation to five phase pairs for fresh and current history (observer throws: %s)', async throws => {
    const directory = await createMigrationDirectory({
      '001_create_observation.sql': 'CREATE TABLE observation_probe (id TEXT PRIMARY KEY);',
      '002_alter_observation.sql': 'ALTER TABLE observation_probe ADD COLUMN value TEXT;',
    });
    const database = new Database(':memory:');
    const observer = vi.fn(() => { if (throws) throw new Error('synthetic observer'); });
    try {
      for (const current of [false, true]) {
        observer.mockClear();
        await runMigrations(database, { migrationsDirectory: directory, observeStartup: observer });
        expect(observer.mock.calls).toEqual([
          ['manifestRead', 'entered'], ['manifestRead', 'returned'],
          ['initialAttestation', 'entered'], ['initialAttestation', 'returned'],
          ['historyPreparation', 'entered'], ['historyPreparation', 'returned'],
          ['migrationExecution', 'entered'], ['migrationExecution', 'returned'],
          ['finalAttestation', 'entered'], ['finalAttestation', 'returned'],
        ]);
        expect(readAppliedMigrationNames(database)).toHaveLength(2);
        expect(readMetadataRows(database)).toHaveLength(2);
        expect(tableExists(database, 'observation_probe')).toBe(true);
        if (!current) database.prepare('INSERT INTO observation_probe (id, value) VALUES (?, ?)').run('one', 'preserved');
        else expect(database.prepare('SELECT value FROM observation_probe').get()).toEqual({ value: 'preserved' });
      }
    } finally { database.close(); }
  });

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
    createMigrationTable(database);
    database.exec(migrationSql);
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
    ).rejects.toMatchObject({
      completedMigrationCount: 0,
      errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED',
      failureStage: 'historyPreparation',
      sideEffectState: 'unknown',
    });

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
    ).rejects.toMatchObject({
      completedMigrationCount: 0,
      errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED',
      failureStage: 'historyPreparation',
      sideEffectState: 'unknown',
    });

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
    createMigrationTable(database);
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
    ).rejects.toMatchObject({
      completedMigrationCount: 0,
      errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED',
      failureStage: 'historyPreparation',
      sideEffectState: 'unknown',
    });

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
    ).rejects.toMatchObject({
      completedMigrationCount: 0,
      errorCode: 'MIGRATION_MANIFEST_FAILED',
      failureStage: 'manifest',
      sideEffectState: 'unknown',
    });

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
    ).rejects.toMatchObject({
      completedMigrationCount: 0,
      errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED',
      failureStage: 'historyPreparation',
      sideEffectState: 'unknown',
    });

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
    const failure = failMigrationWrite(
      database, 'schema_migration_metadata', '002_create_pending_table.sql',
      () => tableExists(database, 'pending_table'),
    );

    await expect(
      runMigrations(database, {
        migrationsDirectory: directory,
        now: () => recordedAt,
        releaseIdentity,
      }),
    ).rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });

    expect(failure).toHaveBeenCalledOnce();
    expect(failure).toHaveReturnedWith(true);
    expect(tableExists(database, 'pending_table')).toBe(false);
    expect(readAppliedMigrationNames(database)).toEqual([
      '001_create_spike_table.sql',
    ]);
    expect(readMetadataRows(database)).toHaveLength(1);
    database.close();
  });

  it.each([false, true])('initializes an empty history with metadata=%s', async (withMetadata) => {
    const directory = await createMigrationDirectory({
      '001_create_probe.sql': 'CREATE TABLE probe (id TEXT PRIMARY KEY);',
    });
    const database = new Database(':memory:');
    try {
      createMigrationTable(database);
      if (withMetadata) createMigrationMetadataTable(database);
      await runMigrations(database, { migrationsDirectory: directory });
      expect(tableExists(database, 'probe')).toBe(true);
      expect(readMetadataRows(database)).toHaveLength(1);
      expect(database.pragma('query_only', { simple: true })).toBe(0);
    } finally { database.close(); }
  });

  it.each(['view', 'trigger', 'legacyExtraTable'] as const)(
    'rejects %s before preparing or executing any migration write', async (mutation) => {
      const directory = await createMigrationDirectory({
        '001_create_probe.sql': 'CREATE TABLE probe (id TEXT PRIMARY KEY);',
      });
      const database = new Database(':memory:');
      try {
        if (mutation === 'view') {
          database.exec('CREATE VIEW unexpected_view AS SELECT 1 AS id;');
        } else {
          await runMigrations(database, { migrationsDirectory: directory });
          if (mutation === 'trigger') {
            database.exec(`CREATE TRIGGER unexpected_trigger BEFORE INSERT ON probe
              BEGIN SELECT RAISE(ABORT, 'untrusted trigger'); END;`);
          } else {
            database.exec('DROP TABLE schema_migration_metadata; CREATE TABLE unexpected (id TEXT);');
          }
        }
        await writeFile(join(directory, '002_create_pending.sql'), 'CREATE TABLE pending (id TEXT);');
        const writes = vi.spyOn(database, 'exec');
        const statements = vi.spyOn(database, 'prepare');
        const observer = vi.fn(() => { throw new Error('synthetic observer failure'); });

        await expect(runMigrations(database, { migrationsDirectory: directory, observeStartup: observer }))
          .rejects.toMatchObject({ completedMigrationCount: 0, errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED' });
        expect(observer.mock.calls).toEqual([
          ['manifestRead', 'entered'], ['manifestRead', 'returned'], ['initialAttestation', 'entered'],
        ]);
        expect(writes).not.toHaveBeenCalled();
        expect(statements.mock.calls.map(([sql]) => sql).join('\n'))
          .not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
        expect(tableExists(database, 'pending')).toBe(false);
        if (mutation !== 'trigger') expect(tableExists(database, 'schema_migration_metadata')).toBe(false);
        expect(database.pragma('query_only', { simple: true })).toBe(0);
      } finally { database.close(); }
    },
  );

  it('reports committed migrations when final schema attestation fails', async () => {
    const sql = 'CREATE TABLE probe (id TEXT PRIMARY KEY);';
    const directory = await createMigrationDirectory({ '001_create_probe.sql': sql });
    const database = new Database(':memory:');
    try {
      const exec = database.exec.bind(database);
      vi.spyOn(database, 'exec').mockImplementation((statement) => {
        const result = exec(statement);
        if (statement === sql) exec('CREATE TABLE unexpected_after_migration (id TEXT);');
        return result;
      });

      await expect(runMigrations(database, { migrationsDirectory: directory }))
        .rejects.toMatchObject({
          completedMigrationCount: 1, errorCode: 'MIGRATION_EXECUTION_FAILED',
          failureStage: 'migrationExecution', sideEffectState: 'unknown',
        });
      expect(readAppliedMigrationNames(database)).toEqual(['001_create_probe.sql']);
      expect(tableExists(database, 'probe')).toBe(true);
    } finally { database.close(); }
  });

  it('reports completed migrations conservatively when a later migration fails', async () => {
    const directory = await createMigrationDirectory({
      '001_create_completed_table.sql':
        'CREATE TABLE completed_table (id TEXT PRIMARY KEY);',
      '002_create_broken_table.sql': 'CREATE TABLE broken syntax;',
    });
    const database = new Database(':memory:');

    const observer = vi.fn(() => { throw new Error('synthetic observer failure'); });
    const failure = await runMigrations(database, {
      migrationsDirectory: directory,
      now: () => recordedAt,
      releaseIdentity,
      observeStartup: observer,
    }).catch((error: unknown) => error);

    expect(observer.mock.calls.at(-1)).toEqual(['migrationExecution', 'entered']);
    expect(observer).toHaveBeenCalledTimes(7);
    expect(failure).toBeInstanceOf(MigrationRunError);
    expect(failure).toMatchObject({
      completedMigrationCount: 1,
      errorCode: 'MIGRATION_EXECUTION_FAILED',
      failureStage: 'migrationExecution',
      message: 'Database migration run failed.',
      sideEffectState: 'unknown',
    });
    expect(tableExists(database, 'completed_table')).toBe(true);
    expect(tableExists(database, 'broken')).toBe(false);
    expect(readAppliedMigrationNames(database)).toEqual([
      '001_create_completed_table.sql',
    ]);
    expect(JSON.stringify(failure)).not.toContain(
      '002_create_broken_table.sql',
    );
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
