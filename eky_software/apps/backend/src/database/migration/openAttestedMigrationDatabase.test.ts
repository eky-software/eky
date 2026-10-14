import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as connections from '../connection/createDatabaseConnection.js';
import * as readOnlyConnections from '../connection/openReadOnlyDatabaseConnection.js';
import { readMigrationManifest } from './migrationManifest.js';
import { createHistorical038Schema } from './migrationSchemaHistory.fixture.js';
import { openAttestedMigrationDatabase } from './openAttestedMigrationDatabase.js';
import { resolveMigrationsDirectory, runMigrations } from './runMigrations.js';

const roots: string[] = [];
const connectionsToClose: connections.DatabaseConnection[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const database of connectionsToClose.splice(0)) if (database.open) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('openAttestedMigrationDatabase', () => {
  it('does not create a missing file or directory without creation authority', async () => {
    const fixture = await createFixture();
    const path = join(fixture.root, 'absent', 'profile.sqlite');
    expect(() => openAttestedMigrationDatabase({ ...fixture, databaseFilePath: path, allowCreate: false }))
      .toThrow('MIGRATION_DATABASE_MISSING');
    expect(await readdir(fixture.root)).toEqual(['migrations']);
  });

  it('accepts a new empty database only when empty schema is allowed', async () => {
    const fixture = await createFixture();
    expect(() => openAttestedMigrationDatabase({ ...fixture, allowCreate: true, allowEmpty: false }))
      .toThrow('Database migration run failed.');
    const database = open(fixture);
    expect(database.prepare('SELECT name FROM sqlite_schema').all()).toEqual([]);
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('trusted_schema', { simple: true })).toBe(0);
    expect(database.pragma('query_only', { simple: true })).toBe(0);
  });

  it('retains normal writing after both checks without running pending migrations', async () => {
    const fixture = await createFixture(true);
    await writeFile(join(fixture.migrationsDirectory, '002_later.sql'), 'CREATE TABLE later (id TEXT PRIMARY KEY);');
    const before = await readFile(fixture.databaseFilePath);
    const database = open(fixture);
    expect(await readFile(fixture.databaseFilePath)).toEqual(before);
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'later'").get()).toBeUndefined();
    database.prepare('INSERT INTO startup_probe VALUES (?)').run('allowed');
    expect(database.prepare('SELECT id FROM startup_probe').pluck().get()).toBe('allowed');
  });

  it('resolves configured, environment and blank paths with the existing policy', async () => {
    const fixture = await createFixture(true);
    vi.stubEnv('DATABASE_FILE_PATH', fixture.databaseFilePath);
    expect(connections.resolveDatabaseFilePath()).toBe(fixture.databaseFilePath);
    expect(connections.resolveDatabaseFilePath('  ')).toBe(resolve('data/eky-dev.sqlite'));
    const path = relative(process.cwd(), fixture.databaseFilePath);
    expect(open({ ...fixture, databaseFilePath: ` ${path} ` }).name).toBe(fixture.databaseFilePath);
    const { databaseFilePath: _omitted, ...withoutPath } = fixture;
    expect(open(withoutPath).name).toBe(fixture.databaseFilePath);
  });

  it('does not treat a non-file as absent', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.databaseFilePath);
    expect(() => open(fixture)).toThrow('MIGRATION_DATABASE_FILE_INVALID');
  });

  it('never recreates a preflighted database that disappears before writable open', async () => {
    const fixture = await createFixture(true);
    const readOnly = readOnlyConnections.withReadOnlyDatabaseConnection;
    vi.spyOn(readOnlyConnections, 'withReadOnlyDatabaseConnection').mockImplementation((path, inspect) => {
      const result = readOnly(path, inspect);
      rmSync(path);
      return result;
    });
    expect(() => open(fixture)).toThrow();
    expect(await readdir(fixture.root)).toEqual(['migrations']);
  });

  it('reattests and closes the writable connection if the schema changed after readonly inspection', async () => {
    const fixture = await createFixture(true);
    const original = connections.createDatabaseConnection;
    let writable: connections.DatabaseConnection | undefined;
    vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
      writable = original(options);
      connectionsToClose.push(writable);
      writable.exec('CREATE VIEW changed_after_preflight AS SELECT 1');
      return writable;
    });
    expect(() => open(fixture)).toThrow('Database migration run failed.');
    expect(writable?.open).toBe(false);
  });

  it('preserves first failure separately when closing the rejected connection also fails', async () => {
    const fixture = await createFixture(true);
    const original = connections.createDatabaseConnection;
    vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
      const database = original(options);
      connectionsToClose.push(database);
      database.exec('CREATE VIEW rejected AS SELECT 1');
      const close = database.close.bind(database);
      vi.spyOn(database, 'close').mockImplementation(() => {
        close();
        throw new Error('synthetic close failure');
      });
      return database;
    });
    try {
      open(fixture);
      throw new Error('expected admission failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) throw error;
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0]).toMatchObject({ errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED' });
      expect(error.errors[1]).toMatchObject({ message: 'synthetic close failure' });
    }
  });

  it('keeps runner baselining internal and never grants it to the restore policy', async () => {
    const fixture = await createFixture(true);
    mutate(fixture.databaseFilePath, database => database.exec('DROP TABLE schema_migration_metadata'));
    const before = await readFile(fixture.databaseFilePath);
    expect(() => open(fixture)).toThrow('Database migration run failed.');
    expect(() => open({ ...fixture, policy: 'restoreCompatible' })).toThrow('Database migration run failed.');
    const database = open({ ...fixture, policy: 'runnerBaseline' });
    expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'schema_migration_metadata'").get()).toBeUndefined();
    expect(await readFile(fixture.databaseFilePath)).toEqual(before);
    await runMigrations(database, { migrationsDirectory: fixture.migrationsDirectory });
    expect(database.prepare('SELECT metadata_origin FROM schema_migration_metadata').pluck().get()).toBe('legacy_baseline');
  });

  it('admits only the known metadata-less restore anchor', async () => {
    const fixture = await createFixture();
    const migrationsDirectory = resolveMigrationsDirectory();
    mutate(fixture.databaseFilePath, database => {
      createHistorical038Schema(database, readMigrationManifest(migrationsDirectory), false);
    });
    expect(() => open({ ...fixture, migrationsDirectory })).toThrow('Database migration run failed.');
    const database = open({ ...fixture, migrationsDirectory, policy: 'restoreCompatible' });
    expect(database.prepare('SELECT count(*) FROM schema_migrations').pluck().get()).toBe(38);
  });

  it.each(['runnerBaseline', 'restoreCompatible'] as const)('does not fall back from corrupt metadata using %s', async policy => {
    const fixture = await createFixture(true);
    mutate(fixture.databaseFilePath, database => {
      database.prepare('UPDATE schema_migration_metadata SET source_sha256 = ?').run('f'.repeat(64));
    });
    const writable = vi.spyOn(connections, 'createDatabaseConnection');
    expect(() => open({ ...fixture, policy })).toThrow('Database migration run failed.');
    expect(writable).not.toHaveBeenCalled();
  });
});

function open(options: Parameters<typeof openAttestedMigrationDatabase>[0]) {
  const database = openAttestedMigrationDatabase(options);
  connectionsToClose.push(database);
  return database;
}

function mutate(path: string, action: (database: Database.Database) => unknown): void {
  const database = new Database(path);
  try { action(database); }
  finally { database.close(); }
}

async function createFixture(existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-migration-admission-'));
  roots.push(root);
  const databaseFilePath = join(root, 'profile.sqlite');
  const migrationsDirectory = join(root, 'migrations');
  await mkdir(migrationsDirectory);
  await writeFile(join(migrationsDirectory, '001_probe.sql'), 'CREATE TABLE startup_probe (id TEXT PRIMARY KEY);');
  if (existing) {
    const database = new Database(databaseFilePath);
    try { await runMigrations(database, { migrationsDirectory }); }
    finally { database.close(); }
  }
  return { root, databaseFilePath, migrationsDirectory, allowCreate: true, allowEmpty: true, policy: 'exactCurrentManifest' as const };
}
