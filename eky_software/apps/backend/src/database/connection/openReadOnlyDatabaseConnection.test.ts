import Database from 'better-sqlite3';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from './createDatabaseConnection.js';
import { withReadOnlyDatabaseConnection } from './openReadOnlyDatabaseConnection.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('withReadOnlyDatabaseConnection', () => {
  it('opens an existing database read-only without sidecar files', async () => {
    const { databaseFilePath, root } = await createDatabase();

    expect(
      withReadOnlyDatabaseConnection(databaseFilePath, (database) =>
        database.prepare('SELECT value FROM example').pluck().get(),
      ),
    ).toBe('stored');
    expect(await readdir(root)).toEqual(['profile.sqlite']);
  });

  it('rejects writes through the read-only connection', async () => {
    const { databaseFilePath } = await createDatabase();

    expect(() =>
      withReadOnlyDatabaseConnection(databaseFilePath, (database) =>
        database.prepare('INSERT INTO example (value) VALUES (?)').run('x'),
      ),
    ).toThrow();
  });

  it('does not create a missing database or its parent directory', async () => {
    const root = await createTemporaryRoot();
    const missingParent = join(root, 'missing-parent');
    const missingDatabase = join(missingParent, 'profile.sqlite');

    expect(() =>
      withReadOnlyDatabaseConnection(missingDatabase, () => undefined),
    ).toThrow();
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('closes the connection after a successful inspection', async () => {
    const { databaseFilePath } = await createDatabase();
    let captured: DatabaseConnection | undefined;

    withReadOnlyDatabaseConnection(databaseFilePath, (database) => {
      captured = database;
    });

    expect(() => captured?.prepare('SELECT 1').get()).toThrow();
  });

  it('closes the connection when inspection fails', async () => {
    const { databaseFilePath } = await createDatabase();
    let captured: DatabaseConnection | undefined;

    expect(() =>
      withReadOnlyDatabaseConnection(databaseFilePath, (database) => {
        captured = database;
        throw new Error('fixture failure');
      }),
    ).toThrow('fixture failure');
    expect(() => captured?.prepare('SELECT 1').get()).toThrow();
  });
});

async function createDatabase(): Promise<{
  databaseFilePath: string;
  root: string;
}> {
  const root = await createTemporaryRoot();
  const databaseFilePath = join(root, 'profile.sqlite');
  const database = new Database(databaseFilePath);
  database.exec('CREATE TABLE example (value TEXT NOT NULL);');
  database.prepare('INSERT INTO example (value) VALUES (?)').run('stored');
  database.close();
  return { databaseFilePath, root };
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-read-only-database-'));
  temporaryRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
