import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../connection/createDatabaseConnection.js';
import { runMigrations } from '../migration/runMigrations.js';
import { verifySqliteUpgradeCopy } from './verifySqliteUpgradeCopy.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('verifySqliteUpgradeCopy', () => {
  it('verifies migrations, integrity, foreign keys and rollback on a copy only', async () => {
    const directory = await createTemporaryDirectory();
    const sourceDatabaseFilePath = join(directory, 'source.sqlite');
    const database = createDatabaseConnection({
      databaseFilePath: sourceDatabaseFilePath,
    });
    await runMigrations(database);
    database
      .prepare(
        `
          INSERT INTO customers (
            id,
            company_id,
            customer_number,
            name,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'synthetic-customer',
        'synthetic-company',
        'SYN-1',
        'Synthetic Customer Oy',
        '2026-08-03T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z',
      );
    database.close();
    const sourceHashBefore = await sha256(sourceDatabaseFilePath);

    const result = await verifySqliteUpgradeCopy(sourceDatabaseFilePath);

    expect(result).toEqual({
      foreignKeyCheckPassed: true,
      integrityCheckPassed: true,
      migrationCount: 38,
      originalHashUnchanged: true,
      sqliteVersion: '3.53.4',
      tableCount: expect.any(Number),
      totalRowCount: expect.any(Number),
      transactionRollbackPassed: true,
    });
    expect(result.tableCount).toBeGreaterThan(20);
    expect(result.totalRowCount).toBeGreaterThan(38);
    expect(await sha256(sourceDatabaseFilePath)).toBe(sourceHashBefore);

    const reopenedSource = createDatabaseConnection({
      databaseFilePath: sourceDatabaseFilePath,
    });
    expect(
      reopenedSource
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM customers
            WHERE id = 'synthetic-customer'
          `,
        )
        .get(),
    ).toEqual({ count: 1 });
    reopenedSource.close();
  });

  it('fails safely when the source has an active WAL sidecar', async () => {
    const directory = await createTemporaryDirectory();
    const sourceDatabaseFilePath = join(directory, 'source.sqlite');
    const database = createDatabaseConnection({
      databaseFilePath: sourceDatabaseFilePath,
    });
    await runMigrations(database);
    database.pragma('journal_mode = WAL');
    database
      .prepare(
        `
          INSERT INTO customers (
            id,
            company_id,
            customer_number,
            name,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'wal-customer',
        'synthetic-company',
        'WAL-1',
        'Synthetic WAL Customer Oy',
        '2026-08-03T00:00:00.000Z',
        '2026-08-03T00:00:00.000Z',
      );

    await expect(
      verifySqliteUpgradeCopy(sourceDatabaseFilePath),
    ).rejects.toThrow('active sidecar');
    database.close();
  });

  it('anchors legacy metadata on the copy without changing the source', async () => {
    const directory = await createTemporaryDirectory();
    const sourceDatabaseFilePath = join(directory, 'legacy.sqlite');
    const database = createDatabaseConnection({
      databaseFilePath: sourceDatabaseFilePath,
    });
    await runMigrations(database);
    database.exec('DROP TABLE schema_migration_metadata;');
    database.close();
    const sourceHashBefore = await sha256(sourceDatabaseFilePath);

    await expect(
      verifySqliteUpgradeCopy(sourceDatabaseFilePath),
    ).resolves.toMatchObject({
      migrationCount: 38,
      originalHashUnchanged: true,
    });

    expect(await sha256(sourceDatabaseFilePath)).toBe(sourceHashBefore);
    const reopenedSource = createDatabaseConnection({
      databaseFilePath: sourceDatabaseFilePath,
    });
    expect(
      reopenedSource
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name = 'schema_migration_metadata'
          `,
        )
        .get(),
    ).toBeUndefined();
    reopenedSource.close();
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'eky-sqlite-copy-verifier-test-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}
