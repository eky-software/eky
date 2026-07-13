import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from './runMigrations.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('runMigrations', () => {
  it('uses an explicitly configured migration directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eky-migrations-'));
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, '001_create_spike_table.sql'),
      'CREATE TABLE desktop_spike (id TEXT PRIMARY KEY);',
      'utf8',
    );
    const database = new Database(':memory:');

    await runMigrations(database, { migrationsDirectory: directory });

    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('desktop_spike');
    expect(table).toBeDefined();
    database.close();
  });
});
