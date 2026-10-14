import Database from 'better-sqlite3';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as connections from '../database/connection/createDatabaseConnection.js';
import * as readOnlyConnections from '../database/connection/openReadOnlyDatabaseConnection.js';
import { interruptSqliteTransaction } from '../database/connection/hotJournal.fixture.js';
import { runMigrations } from '../database/migration/runMigrations.js';
import type { BackendOperationalEvent } from '../observability/operationalEvent.js';
import { createApp } from './app.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('createApp database admission', () => {
  it('recovers an authorized local interrupted transaction before schema admission', async () => {
    const fixture = await createHotJournalFixture();
    const assertOwnedDatabase = vi.fn(async (path: string) => {
      expect(path).toBe(fixture.databaseFilePath);
    });
    const gate = vi.fn(async () => { throw new Error('synthetic gate stop'); });
    const recoveryOptions = {
      ownedLocalDatabaseRecovery: {
        assertOwnedDatabase, signal: new AbortController().signal,
      },
    };

    await expect(createApp({ ...fixture, ...recoveryOptions, beforeMigrations: gate }))
      .rejects.toThrow('Database migration startup gate could not be completed.');
    expect(gate).toHaveBeenCalledOnce();
    expect(assertOwnedDatabase).toHaveBeenCalled();
    expect((await readFile(fixture.databaseFilePath)).equals(fixture.committedBytes)).toBe(true);
    const database = new Database(fixture.databaseFilePath, { readonly: true });
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM startup_probe WHERE id LIKE ?')
        .get('uncommitted-%')).toEqual({ count: 0 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM startup_probe').get())
        .toEqual({ count: 200 });
    } finally { database.close(); }
  });

  it('retains the interrupted database and journal without local recovery authority', async () => {
    const fixture = await createHotJournalFixture();
    const before = await readFile(fixture.databaseFilePath);
    const journalBefore = await readFile(fixture.databaseFilePath + '-journal');
    const gate = vi.fn();
    await expect(createApp({ ...fixture, beforeMigrations: gate })).rejects.toThrow();
    expect(gate).not.toHaveBeenCalled();
    expect((await readFile(fixture.databaseFilePath)).equals(before)).toBe(true);
    expect((await readFile(fixture.databaseFilePath + '-journal')).equals(journalBefore)).toBe(true);
  });

  it('retains the first ownership failure and reports unknown effects after native recovery', async () => {
    const fixture = await createHotJournalFixture();
    const failure = new Error('synthetic ownership lost');
    let assertions = 0;
    const gate = vi.fn();
    const register = vi.fn();
    const events: BackendOperationalEvent[] = [];
    const result = await createApp({
      ...fixture, beforeMigrations: gate,
      ownedLocalDatabaseRecovery: {
        signal: new AbortController().signal,
        async assertOwnedDatabase() { if (++assertions === 3) throw failure; },
      },
      invoiceDocumentStorageRoot: fixture.root,
      profileSnapshotServiceRegistration: { stagingRoot: fixture.root, register },
      operationalLogger: { write: event => { events.push(event); } },
    }).then(() => undefined, (error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).cause).toBe(failure);
    expect(gate).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      eventName: 'database.openFailed', errorCode: 'DATABASE_OPEN_FAILED', sideEffectState: 'unknown',
    }));
    expect(JSON.stringify(events)).not.toMatch(/synthetic|ownership lost|startup_probe|SELECT|profile\.sqlite|stack/i);
  });

  it('does not admit an untrusted committed schema after local journal recovery', async () => {
    const fixture = await createHotJournalFixture(true);
    const openWritable = vi.spyOn(connections, 'createDatabaseConnection');
    const gate = vi.fn();
    const register = vi.fn();
    const events: BackendOperationalEvent[] = [];
    await expect(createApp({
      ...fixture, beforeMigrations: gate,
      ownedLocalDatabaseRecovery: {
        signal: new AbortController().signal, assertOwnedDatabase: async () => {},
      },
      invoiceDocumentStorageRoot: fixture.root,
      profileSnapshotServiceRegistration: { stagingRoot: fixture.root, register },
      operationalLogger: { write: event => { events.push(event); } },
    })).rejects.toThrow('Database migrations could not be completed.');
    expect(openWritable).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      eventName: 'migration.failed', completedMigrationCount: 0,
      failureStage: 'historyPreparation', sideEffectState: 'unknown',
    }));
    expect((await readFile(fixture.databaseFilePath)).equals(fixture.committedBytes)).toBe(true);
    await expect(access(fixture.databaseFilePath + '-journal')).rejects.toMatchObject({ code: 'ENOENT' });
    const recovered = new Database(fixture.databaseFilePath, { readonly: true });
    try {
      expect(recovered.prepare('SELECT COUNT(*) AS count FROM startup_probe').get()).toEqual({ count: 200 });
      expect(recovered.prepare('SELECT COUNT(*) AS count FROM startup_probe WHERE id LIKE ?')
        .get('uncommitted-%')).toEqual({ count: 0 });
      expect(recovered.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 1 });
    } finally { recovered.close(); }
  });

  it.each(['extraTrigger', 'historyView', 'viewOnly'] as const)(
    'rejects %s before opening a writable connection or registering services',
    async (mutation) => {
      const fixture = await createFixture(mutation !== 'viewOnly');
      const database = new Database(fixture.databaseFilePath);
      try {
        if (mutation === 'extraTrigger') {
          database.exec('CREATE TRIGGER unexpected AFTER INSERT ON startup_probe BEGIN SELECT 1; END');
        } else if (mutation === 'historyView') {
          database.exec('DROP TABLE schema_migration_metadata; DROP TABLE schema_migrations; CREATE VIEW schema_migrations AS SELECT 1 AS name');
        } else {
          database.exec('CREATE VIEW unexpected AS SELECT 1 AS value');
        }
      } finally { database.close(); }
      const before = await readFile(fixture.databaseFilePath);
      const openWritable = vi.spyOn(connections, 'createDatabaseConnection');
      const register = vi.fn();
      const gate = vi.fn();
      const events: BackendOperationalEvent[] = [];

      await expect(createApp({
        ...fixture,
        beforeMigrations: gate,
        invoiceDocumentStorageRoot: fixture.root,
        profileSnapshotServiceRegistration: { stagingRoot: fixture.root, register },
        operationalLogger: { write: event => { events.push(event); } },
      })).rejects.toThrow();

      expect(openWritable).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(gate).not.toHaveBeenCalled();
      expect(await readFile(fixture.databaseFilePath)).toEqual(before);
      expect(events).toContainEqual(expect.objectContaining({
        eventName: 'migration.failed', errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED',
        failureStage: 'historyPreparation', completedMigrationCount: 0,
      }));
      expect(events.some(event => event.eventName === 'database.opened' || event.eventName === 'database.openFailed')).toBe(false);
      expect(JSON.stringify(events)).not.toMatch(/startup_probe|unexpected|SELECT|CREATE|profile\.sqlite|stack/i);
    },
  );

  it('closes the readonly check before the writable open and retains the startup gate', async () => {
    const fixture = await createFixture(true);
    const order: string[] = [];
    let readOnlyDatabase: connections.DatabaseConnection | undefined;
    const originalReadOnly = readOnlyConnections.withReadOnlyDatabaseConnection;
    vi.spyOn(readOnlyConnections, 'withReadOnlyDatabaseConnection').mockImplementation((path, inspect) => {
      order.push('readonly');
      return originalReadOnly(path, database => {
        readOnlyDatabase = database;
        expect(database.readonly).toBe(true);
        return inspect(database);
      });
    });
    const originalWritable = connections.createDatabaseConnection;
    vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
      order.push('writable');
      expect(readOnlyDatabase?.open).toBe(false);
      return originalWritable(options);
    });

    await expect(createApp({
      ...fixture,
      beforeMigrations: async inspection => {
        order.push('gate');
        expect(inspection).toMatchObject({ appliedMigrationCount: 1, pendingMigrationCount: 0, profileState: 'existing' });
        throw new Error('synthetic gate stop');
      },
    })).rejects.toThrow('Database migration startup gate could not be completed.');
    expect(order).toEqual(['readonly', 'writable', 'gate']);
  });

  it('keeps new empty database creation separate from existing-file inspection', async () => {
    const fixture = await createFixture(false);
    const gate = vi.fn(async inspection => {
      expect(inspection).toMatchObject({ appliedMigrationCount: 0, pendingMigrationCount: 1, profileState: 'empty' });
      throw new Error('synthetic gate stop');
    });
    await expect(createApp({ ...fixture, beforeMigrations: gate }))
      .rejects.toThrow('Database migration startup gate could not be completed.');
    expect(gate).toHaveBeenCalledOnce();
  });
});

async function createFixture(existing: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'eky-app-admission-'));
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
  return { root, databaseFilePath, migrationsDirectory };
}

async function createHotJournalFixture(withUnexpectedView = false) {
  const fixture = await createFixture(true);
  const database = new Database(fixture.databaseFilePath);
  try {
    const insert = database.prepare('INSERT INTO startup_probe (id) VALUES (?)');
    database.transaction(() => {
      for (let index = 0; index < 200; index++) insert.run(`${index}-${'x'.repeat(4096)}`);
    })();
    if (withUnexpectedView) database.exec('CREATE VIEW unexpected_workspace_view AS SELECT 1');
  } finally { database.close(); }
  const committedBytes = await readFile(fixture.databaseFilePath);
  await interruptSqliteTransaction(fixture.databaseFilePath,
    "UPDATE startup_probe SET id = 'uncommitted-' || rowid");
  const journal = await readFile(fixture.databaseFilePath + '-journal');
  expect(journal.length).toBeGreaterThan(512);
  expect((await readFile(fixture.databaseFilePath)).equals(committedBytes)).toBe(false);
  return { ...fixture, committedBytes };
}
