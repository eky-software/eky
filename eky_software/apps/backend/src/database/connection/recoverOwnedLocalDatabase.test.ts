import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { link, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { interruptSqliteTransaction } from './hotJournal.fixture.js';
import { recoverOwnedLocalDatabase } from './recoverOwnedLocalDatabase.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('recoverOwnedLocalDatabase', () => {
  it('uses native rollback before any schema/business query and closes its only connection', async () => {
    const fixture = await createFixture();
    const assertOwnedDatabase = vi.fn(async () => {});
    const close = vi.spyOn(Database.prototype, 'close');
    expect(await recoverOwnedLocalDatabase(fixture.path, {
      assertOwnedDatabase, signal: new AbortController().signal,
    })).toBe(true);
    expect(assertOwnedDatabase).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
    expect((close.mock.contexts[0] as Database.Database).open).toBe(false);
    const database = new Database(fixture.path, { readonly: true });
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM recovery_probe WHERE payload = ?')
        .get('uncommitted')).toEqual({ count: 0 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM recovery_probe').get()).toEqual({ count: 200 });
    } finally { database.close(); }
  });

  it('attempts close and keeps a native failure before a later close failure', async () => {
    const fixture = await createFixture();
    const first = new Error('synthetic native recovery failure');
    const cleanup = new Error('synthetic close failure');
    const originalPragma = Database.prototype.pragma;
    const originalClose = Database.prototype.close;
    let recoveryDatabase: Database.Database | undefined;
    vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (this: Database.Database, ...args) {
      recoveryDatabase = this;
      if (args[0] === 'main.schema_version') throw first;
      return originalPragma.apply(this, args);
    });
    const close = vi.spyOn(Database.prototype, 'close').mockImplementation(function (this: Database.Database) {
      originalClose.call(this);
      throw cleanup;
    });
    const failure = await recoverOwnedLocalDatabase(fixture.path, {
      assertOwnedDatabase: async () => {}, signal: new AbortController().signal,
    }).then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('LOCAL_DATABASE_RECOVERY_FAILED');
    expect((failure as Error).cause).toBeInstanceOf(AggregateError);
    const aggregate = (failure as Error).cause as AggregateError;
    expect(aggregate.errors).toEqual([first, cleanup]);
    expect(aggregate.cause).toBe(first);
    expect(close).toHaveBeenCalledOnce();
    expect(recoveryDatabase?.open).toBe(false);
  });

  it.each(['cancelled', 'lost', 'changedDatabase', 'changedJournal'] as const)(
    'retains interrupted bytes before recovery when %s', async reason => {
      const fixture = await createFixture();
      const before = await snapshot(fixture.path);
      const controller = new AbortController();
      let assertion = 0;
      const assertOwnedDatabase = async () => {
        assertion++;
        if (assertion !== 2) return;
        if (reason === 'cancelled') controller.abort();
        if (reason === 'lost') throw new Error('synthetic ownership lost');
        if (reason === 'changedDatabase' || reason === 'changedJournal') {
          const path = reason === 'changedDatabase' ? fixture.path : fixture.path + '-journal';
          const content = await readFile(path);
          await rename(path, path + '.retained');
          await writeFile(path, content);
        }
      };
      await expect(recoverOwnedLocalDatabase(fixture.path, {
        assertOwnedDatabase, signal: controller.signal,
      })).rejects.toThrow();
      expect(await snapshot(fixture.path)).toEqual(before);
    },
  );

  it.each(['database', 'journal'] as const)('rejects a hard-linked %s without modifying either name', async item => {
    const fixture = await createFixture();
    const path = item === 'database' ? fixture.path : fixture.path + '-journal';
    await link(path, path + '.alias');
    const before = await snapshot(fixture.path);
    await expect(recoverOwnedLocalDatabase(fixture.path, {
      assertOwnedDatabase: async () => {}, signal: new AbortController().signal,
    })).rejects.toThrow('LOCAL_DATABASE_RECOVERY_FAILED');
    expect(await snapshot(fixture.path)).toEqual(before);
    expect(await readFile(path + '.alias')).toEqual(await readFile(path));
  });

  it('retains a mixed WAL/rollback installation rather than selecting a recovery mode', async () => {
    const fixture = await createFixture();
    const before = await snapshot(fixture.path);
    await writeFile(fixture.path + '-wal', 'synthetic conflicting sidecar');
    await expect(recoverOwnedLocalDatabase(fixture.path, {
      assertOwnedDatabase: async () => {}, signal: new AbortController().signal,
    })).rejects.toThrow('LOCAL_DATABASE_RECOVERY_FAILED');
    expect(await snapshot(fixture.path)).toEqual(before);
    expect(await readFile(fixture.path + '-wal', 'utf8')).toBe('synthetic conflicting sidecar');
  });

  it('does not claim success or run later work if ownership is lost after native rollback', async () => {
    const fixture = await createFixture();
    let assertion = 0;
    await expect(recoverOwnedLocalDatabase(fixture.path, {
      assertOwnedDatabase: async () => {
        if (++assertion === 3) throw new Error('synthetic ownership lost');
      },
      signal: new AbortController().signal,
    })).rejects.toThrow('synthetic ownership lost');
    const database = new Database(fixture.path, { readonly: true });
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM recovery_probe WHERE payload = ?')
        .get('uncommitted')).toEqual({ count: 0 });
    } finally { database.close(); }
  });

  it('leaves a healthy database without a journal byte-for-byte unchanged', async () => {
    const fixture = await createFixture(false);
    const before = await readFile(fixture.path);
    expect(await recoverOwnedLocalDatabase(fixture.path, {
      assertOwnedDatabase: async () => {}, signal: new AbortController().signal,
    })).toBe(false);
    expect(await readFile(fixture.path)).toEqual(before);
  });

  it('keeps a healthy truncated journal compatible without business writes', async () => {
    const fixture = await createFixture(false);
    await writeFile(fixture.path + '-journal', '');
    const before = await readFile(fixture.path);
    expect(await recoverOwnedLocalDatabase(fixture.path, {
      assertOwnedDatabase: async () => {}, signal: new AbortController().signal,
    })).toBe(true);
    expect(await readFile(fixture.path)).toEqual(before);
  });
});

async function createFixture(interrupted = true) {
  const root = await mkdtemp(join(tmpdir(), 'eky-local-journal-'));
  roots.push(root);
  const path = join(root, 'profile.sqlite');
  const database = new Database(path);
  try {
    database.exec('CREATE TABLE recovery_probe (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    const insert = database.prepare('INSERT INTO recovery_probe (payload) VALUES (?)');
    database.transaction(() => {
      for (let index = 0; index < 200; index++) insert.run('committed-' + 'x'.repeat(4096));
    })();
  } finally { database.close(); }
  if (interrupted) await interruptSqliteTransaction(path, "UPDATE recovery_probe SET payload = 'uncommitted'");
  return { path, root };
}

async function snapshot(path: string) {
  return {
    database: createHash('sha256').update(await readFile(path)).digest('hex'),
    journal: createHash('sha256').update(await readFile(path + '-journal')).digest('hex'),
  };
}
